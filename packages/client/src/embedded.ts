import { Books, runOperation } from "@reeve/engine";
import { Effect } from "effect";
import type { Backend, ClientError } from "./backend.ts";

/** The operations on the engine in this process, as the server runs them. */
export const embeddedBackend = (books: Books["Service"]): Backend => ({
  run: (name, _operation, input) =>
    runOperation(name, input).pipe(
      Effect.provideService(Books, books),
      Effect.mapError((error) => error as ClientError),
    ),
});
