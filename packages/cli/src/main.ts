import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Connection } from "@reeve/client";
import { VERSION } from "@reeve/contract/api";
import { Console, Effect, Layer } from "effect";
import { Command } from "effect/cli";
import { home, reeve } from "./reeve.ts";

const fail = (message: string) =>
  Effect.andThen(
    Console.error(message),
    Effect.sync(() => (process.exitCode = 1)),
  );

reeve.pipe(
  Command.run({ version: VERSION }),
  Effect.catchTags({
    NotFound: (error) => fail(error.message),
    BookNotFound: (error) => fail(`${error.message}. Run \`reeve books list\`.`),
    InvalidRequest: (error) => fail(error.message),
    ServerMismatch: (error) => fail(error.message),
    ServerUnavailable: (error) => fail(error.message),
    StorageError: (error) => fail(`${error.message}: ${String(error.cause)}`),
    PlatformError: (error) => fail(error.message),
  }),
  Effect.provide(Connection.layer({ home }).pipe(Layer.provideMerge(NodeServices.layer))),
  NodeRuntime.runMain,
);
