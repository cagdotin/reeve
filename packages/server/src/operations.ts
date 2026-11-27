import type { ServedApi } from "@reeve/contract/api";
import { Books, runOperation } from "@reeve/engine";
import { Effect, type Layer } from "effect";
import { HttpApiBuilder, type HttpApiGroup } from "effect/http-api";

interface Request {
  readonly params?: Record<string, string>;
  readonly query?: object;
  readonly payload?: object;
}

interface Handlers {
  readonly handle: (
    name: string,
    handler: (request: Request) => Effect.Effect<unknown, unknown>,
  ) => Handlers;
}

const build = (api: ServedApi) =>
  Effect.fnUntraced(function* (handlers: Handlers) {
    const books = yield* Books;
    for (const endpoint of Object.values(api.groups.operations.endpoints)) {
      const name = endpoint.identifier;
      handlers = handlers.handle(name, ({ params, query, payload }) =>
        runOperation(name, { ...query, ...payload, ...params }).pipe(
          Effect.provideService(Books, books),
        ),
      );
    }
    return handlers;
  });

/**
 * Implements every endpoint of the `operations` group: an operation's input is its path
 * parameters, its query and its body together. The loop is untyped; `Api` types each endpoint.
 */
export const operationsLive = (
  api: ServedApi,
): Layer.Layer<HttpApiGroup.Service<"reeve", "operations">, never, Books> =>
  HttpApiBuilder.group(api, "operations", build(api) as never);
