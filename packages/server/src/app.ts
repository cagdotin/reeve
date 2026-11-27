import { VERSION, type ServedApi } from "@reeve/contract/api";
import { Books } from "@reeve/engine";
import { Effect, Stream } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

const ping = { event: "ping", data: "" } as const;

/** Implements the endpoints the apps need that are not catalog operations. */
export const appLive = (api: ServedApi) =>
  HttpApiBuilder.group(
    api,
    "app",
    Effect.fnUntraced(function* (handlers) {
      const books = yield* Books;
      const url = HttpServer.formatAddress((yield* HttpServer.HttpServer).address);
      return handlers
        .handle("health", () =>
          Effect.succeed({
            version: VERSION,
            capabilities: { operations: true, mcp: true, openapi: true },
          }),
        )
        .handle("connection", () => Effect.succeed({ url, mcpUrl: `${url}/mcp` }))
        .handle("events", () =>
          Effect.succeed(
            Stream.merge(
              Stream.tick("25 seconds").pipe(Stream.as(ping)),
              books.changes.pipe(
                Stream.map((change) => ({ event: "change", data: change }) as const),
              ),
            ),
          ),
        );
    }),
  );
