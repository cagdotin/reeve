import type {
  BookNotFound,
  InvalidRequest,
  NotFound,
  ServerMismatch,
  ServerUnavailable,
  StorageError,
} from "@reeve/contract";
import type { Operation } from "@reeve/contract/catalog";
import type { Effect } from "effect";

/** Every way a call through a connection can fail, in either mode. */
export type ClientError =
  | BookNotFound
  | NotFound
  | InvalidRequest
  | StorageError
  | ServerMismatch
  | ServerUnavailable;

/** Where calls run: the server over HTTP, or the engine in this process. Both give the same. */
export interface Backend {
  readonly run: (
    name: string,
    operation: Operation,
    input: Record<string, unknown>,
  ) => Effect.Effect<unknown, ClientError>;
}
