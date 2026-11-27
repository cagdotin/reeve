import {
  InvalidRequest,
  ServerMismatch,
  ServerUnavailable,
  type ServerInfo,
  type StorageError,
} from "@reeve/contract";
import { VERSION } from "@reeve/contract/api";
import {
  availableCatalog,
  inOneBook,
  isOperationEnabled,
  pathParams,
  type Operation,
} from "@reeve/contract/catalog";
import { pathParamProblem } from "@reeve/contract/client";
import { Books, DEFAULT_BOOK, readServerInfo } from "@reeve/engine";
import { Context, Effect, Layer, Option, type Scope } from "effect";
import type { Backend, ClientError } from "./backend.ts";
import { embeddedBackend } from "./embedded.ts";
import { remoteBackend } from "./remote.ts";

export interface ConnectOptions {
  /** The reeve home: the books, and `server.json` when a server runs. */
  readonly home: string;
}

/**
 * The operations and the workspace endpoints, run by the server `server.json` names when it
 * answers, and by the engine in this process when there is none (docs/rules/boundaries.md). Every call picks
 * again, so a long-running process follows a server that starts or stops.
 */
export class Connection extends Context.Service<
  Connection,
  {
    readonly operations: Readonly<Record<string, Operation>>;
    /** Runs an operation on its decoded input. */
    readonly run: (name: string, input: object) => Effect.Effect<unknown, ClientError>;
  }
>()("@reeve/client/Connection") {
  static readonly layer = (options: ConnectOptions) => Layer.effect(Connection, connect(options));
}

/** How long a server named in `server.json` has to answer `/api/health`. */
const PROBE_TIMEOUT_MS = 2000;

const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // The process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/**
 * How the server `info` names answers: `None` when nothing listens at its address any more, its
 * capability to run operations when it answers as this version does, and an error when it is there
 * but cannot be used.
 */
const probe = (
  info: ServerInfo,
): Effect.Effect<
  Option.Option<{ readonly operations: boolean }>,
  ServerMismatch | ServerUnavailable
> =>
  Effect.gen(function* () {
    const unavailable = (reason: string) =>
      new ServerUnavailable({ url: info.url, reason: `(pid ${info.pid}) ${reason}` });
    const answer = yield* Effect.tryPromise({
      try: async () => {
        const response = await fetch(`${info.url}/api/health`, {
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        return { status: response.status, body: await response.json().catch(() => null) };
      },
      catch: (error) => error as Error & { readonly cause?: { readonly code?: string } },
    }).pipe(
      Effect.catch((error) =>
        error.cause?.code === "ECONNREFUSED"
          ? Effect.succeed(null)
          : Effect.fail(
              unavailable(
                error.name === "TimeoutError"
                  ? `does not answer within ${PROBE_TIMEOUT_MS / 1000} s. Stop it, or wait for it to answer.`
                  : `cannot be reached (${error.cause?.code ?? error.message}). Stop it, or start it again.`,
              ),
            ),
      ),
    );
    if (answer === null) return Option.none();
    const body = answer.body as { readonly version?: unknown; readonly capabilities?: any } | null;
    if (answer.status !== 200 || typeof body?.version !== "string")
      return yield* unavailable(
        `answers /api/health with ${answer.status}, not as reeve does. Stop it, or free its port.`,
      );
    if (body.version !== VERSION)
      return yield* new ServerMismatch({ url: info.url, version: body.version, expected: VERSION });
    return Option.some({ operations: body.capabilities?.operations === true });
  });

/**
 * The server `<home>/server.json` names, when it runs and answers as this version does; `None`
 * when no server runs there; an error when one runs but cannot be used (docs/rules/boundaries.md).
 */
export const findServer = (
  home: string,
): Effect.Effect<Option.Option<ServerInfo>, ServerMismatch | ServerUnavailable | StorageError> =>
  Effect.gen(function* () {
    const named = yield* readServerInfo(home);
    if (Option.isNone(named) || !isRunning(named.value.pid)) return Option.none();
    const answer = yield* probe(named.value);
    return Option.map(answer, () => named.value);
  });

/**
 * Refuses a path parameter no URL can carry in both modes, so the engine in this process gives the
 * error a server's route would.
 */
const routable = (params: Record<string, unknown>) =>
  Effect.forEach(Object.entries(params), ([name, value]) => {
    const problem = typeof value === "string" ? pathParamProblem(name, value) : undefined;
    return problem === undefined
      ? Effect.void
      : Effect.fail(new InvalidRequest({ message: problem }));
  });

/** A `Connection`; nothing is read until the first call. */
export const connect = (
  options: ConnectOptions,
): Effect.Effect<Connection["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const operations = availableCatalog();

    const embedded = yield* Effect.cached(
      Layer.buildWithScope(Books.layer({ home: options.home }), scope).pipe(
        Effect.map((context) => embeddedBackend(Context.get(context, Books))),
      ),
    );

    let server: { readonly url: string; readonly pid: number; readonly backend: Backend } | null =
      null;

    const route: Effect.Effect<Backend, ClientError> = Effect.gen(function* () {
      const named = yield* readServerInfo(options.home);
      if (Option.isNone(named) || !isRunning(named.value.pid)) return yield* embedded;
      const { url, pid } = named.value;
      if (server?.url === url && server.pid === pid) return server.backend;
      const answer = yield* probe(named.value);
      if (Option.isNone(answer) || !answer.value.operations) return yield* embedded;
      server = { url, pid, backend: remoteBackend(url) };
      return server.backend;
    });

    const run = (name: string, input: object) =>
      Effect.gen(function* () {
        if (!isOperationEnabled(name))
          return yield* new InvalidRequest({ message: "Purchases is frozen and unavailable." });
        const operation = operations[name];
        if (operation === undefined) return yield* Effect.die(`No operation ${name}`);
        const given =
          inOneBook(operation) && (input as { book?: unknown }).book === undefined
            ? { ...input, book: DEFAULT_BOOK }
            : (input as Record<string, unknown>);
        yield* routable(
          Object.fromEntries(
            pathParams(operation.http)
              .filter((key) => given[key] !== undefined)
              .map((key) => [key, given[key]]),
          ),
        );
        const backend = yield* route;
        return yield* backend.run(name, operation, given);
      });

    return Connection.of({ operations, run });
  });
