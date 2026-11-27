import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { InvalidRequest } from "@reeve/contract";
import { makeApi, Validation } from "@reeve/contract/api";
import { availableCatalog } from "@reeve/contract/catalog";
import { FEATURES } from "@reeve/contract/features";
import { VERSION } from "@reeve/contract/api";
import { bankAutoSync, Books, removeServerInfo, writeServerInfo } from "@reeve/engine";
import { httpLayer } from "@reeve/mcp";
import { Cause, Effect, Exit, Layer, Scope } from "effect";
import {
  HttpMethod,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/http";
import { HttpApiBuilder, HttpApiMiddleware } from "effect/http-api";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { appLive } from "./app.ts";
import { claimHome } from "./home-claim.ts";

export { HomeTaken } from "./home-claim.ts";
import { operationsLive } from "./operations.ts";
import { receiptPhotoRoute } from "./receipt-photos.ts";

export interface ServerOptions {
  /** The reeve home, holding the books. */
  readonly home: string;
  readonly port?: number | undefined;
  /** Built web app to serve at `/`. Without it only the API and MCP endpoints are served. */
  readonly webDir?: string | undefined;
}

export interface RunningServer {
  readonly url: string;
  readonly mcpUrl: string;
  readonly close: () => Promise<void>;
}

export const DEFAULT_PORT = 4620;

/** The only address the server listens on: reeve has no authentication. */
const LOOPBACK = "127.0.0.1";

/** A request that does not match its schema is an `InvalidRequest` saying why. */
const ValidationLive = HttpApiMiddleware.layerSchemaErrorTransform(Validation, (error) =>
  error.kind === "Body" || error.kind === "ResponseHeaders"
    ? Effect.fail(error)
    : Effect.fail(new InvalidRequest({ message: error.cause.message })),
);

/** The API for the catalog's operations. */
const apiLive = () => {
  const api = makeApi(availableCatalog());
  return HttpApiBuilder.layer(api, { openapiPath: "/api/openapi.json" }).pipe(
    Layer.provide([operationsLive(api), appLive(api)]),
    Layer.provide(ValidationLive),
  );
};

/**
 * An `/api` path no endpoint has is a JSON 404, never the web app. `HEAD` is left out, so the
 * router answers it as the `GET` of the same path without the body.
 */
const UnknownApiRoute = HttpRouter.addAll(
  [...HttpMethod.all]
    .filter((method) => method !== "HEAD")
    .map((method) =>
      HttpRouter.route(
        method,
        "/api/*",
        Effect.map(HttpServerRequest.HttpServerRequest, (request) =>
          HttpServerResponse.jsonUnsafe(
            { _tag: "RouteNotFound", message: `No route ${request.method} ${request.url}` },
            { status: 404 },
          ),
        ),
      ),
    ),
);

/**
 * HttpApi answers a body of a content type its route does not take with a plain-text 415; this
 * sends it as the `{ _tag, message }` of every other error (docs/rules/boundaries.md).
 */
const UnsupportedMediaTypeAsJson = HttpRouter.middleware(
  (httpEffect) =>
    Effect.gen(function* () {
      const response = yield* httpEffect;
      if (response.status !== 415) return response;
      const request = yield* HttpServerRequest.HttpServerRequest;
      return HttpServerResponse.jsonUnsafe(
        {
          _tag: "InvalidRequest",
          message: `Unsupported content type ${request.headers["content-type"] ?? "(none)"}; send application/json`,
        },
        { status: 415 },
      );
    }),
  { global: true },
);

const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

/**
 * A page that rebinds its domain to 127.0.0.1 is same-origin to the browser, and only its Host
 * gives it away (docs/rules/boundaries.md).
 */
const LoopbackHostOnly = HttpRouter.middleware(
  (httpEffect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (LOOPBACK_HOST.test(request.headers["host"] ?? "")) return yield* httpEffect;
      return HttpServerResponse.jsonUnsafe(
        { _tag: "InvalidRequest", message: "reeve only answers requests to a loopback address" },
        { status: 403 },
      );
    }),
  { global: true },
);

/**
 * The built web app, with every path that is not a file answered by its `index.html`. A browser
 * revalidates each file, so after an update it never runs an `index.html` naming the old build's
 * scripts.
 */
const webApp = (webDir: string | undefined) =>
  webDir !== undefined && existsSync(join(webDir, "index.html"))
    ? HttpStaticServer.layer({ root: webDir, spa: true, cacheControl: "no-cache" })
    : Layer.empty;

const failure = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause);
  // Callers look for the listen error's code, as EADDRINUSE.
  return error instanceof Error && error.cause instanceof Error ? error.cause : error;
};

export const startServer = async (options: ServerOptions): Promise<RunningServer> => {
  const node = createServer();
  const routes = Layer.mergeAll(
    apiLive(),
    httpLayer({ path: "/mcp" }),
    FEATURES.purchases ? receiptPhotoRoute : Layer.empty,
    UnknownApiRoute,
    UnsupportedMediaTypeAsJson,
    LoopbackHostOnly,
    webApp(options.webDir),
    Layer.effectDiscard(Effect.forkScoped(bankAutoSync)),
  );
  const server = HttpRouter.serve(routes, {
    disableLogger: true,
    disableListenLog: true,
  }).pipe(
    Layer.provide(Books.layer({ home: options.home })),
    Layer.provide(NodeServices.layer),
    Layer.provide(
      NodeHttpServer.layer(() => node, { host: LOOPBACK, port: options.port ?? DEFAULT_PORT }),
    ),
  );
  const release = claimHome(options.home);
  const scope = Scope.makeUnsafe();
  const started = await Effect.runPromiseExit(Layer.buildWithScope(server, scope));
  if (Exit.isFailure(started)) {
    release();
    throw failure(started.cause);
  }

  const { port } = node.address() as AddressInfo;
  const url = `http://${LOOPBACK}:${port}`;
  const discovery = { url, pid: process.pid, version: VERSION };
  const onDisk = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.orDie(effect));
  const stop = async () => {
    // Open event streams never end on their own, so close every connection instead of waiting.
    node.close();
    node.closeAllConnections();
    await Effect.runPromise(Scope.close(scope, Exit.void));
    release();
  };
  await onDisk(writeServerInfo(options.home, discovery)).catch(async (error: unknown) => {
    await stop();
    throw error;
  });
  return {
    url,
    mcpUrl: `${url}/mcp`,
    close: async () => {
      await onDisk(removeServerInfo(options.home, discovery));
      await stop();
    },
  };
};
