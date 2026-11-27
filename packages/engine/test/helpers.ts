import { Effect, Layer, ManagedRuntime } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Books } from "../src/books.ts";
import { runOperation } from "../src/operations.ts";

/** Gives a saved rule these actions behind the operations, as a book from before they checked names. */
export const writeOlderRule = (file: string, rule: string, actions: ReadonlyArray<unknown>) => {
  const client = new DatabaseSync(file);
  client.prepare("UPDATE rules SET actions = ? WHERE id = ?").run(JSON.stringify(actions), rule);
  client.close();
};

/** A reeve home in a temporary folder with a runtime to call operations by name. */
export const scratch = () => {
  const home = mkdtempSync(join(tmpdir(), "reeve-test-"));
  const runtime = ManagedRuntime.make(Books.layer({ home }));
  const call = <A = any>(name: string, input: Record<string, unknown> = {}): Promise<A> =>
    runtime.runPromise(runOperation(name, input) as Effect.Effect<A, unknown, Books>);
  const fails = (name: string, input: Record<string, unknown> = {}) =>
    runtime.runPromise(
      Effect.flip(runOperation(name, input)) as Effect.Effect<any, unknown, Books>,
    );
  const dispose = async () => {
    await runtime.dispose();
    rmSync(home, { recursive: true, force: true });
  };
  return { home, call, fails, dispose, layer: Layer.empty };
};
