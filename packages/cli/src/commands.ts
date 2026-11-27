import type { CliCommand, Operation, OperationName } from "@reeve/contract/catalog";
import { Console, Effect, Schema } from "effect";
import { Command, Flag } from "effect/cli";
import { resolve } from "node:path";
import { renderers } from "./render.ts";
import { schemaFlags } from "./schema-flags.ts";

/** Runs an operation by name on its decoded input, without the `book` field. */
export type RunOperation<E, R> = (name: string, input: object) => Effect.Effect<unknown, E, R>;

/** A command generated from an operation, with the words that run it. */
export interface OperationCommand<E, R> {
  readonly words: CliCommand["command"];
  readonly command: Command.Command<string, unknown, {}, E, R>;
}

/**
 * A file path the engine reads or writes is resolved here, against the directory the command runs
 * in: a running server would read a relative one against its own.
 */
const PATH_FIELDS = ["path", "keyPath"];

/** A server runs in another folder than the command, so a path it reads has to be absolute. */
const withAbsolutePath = <I>(input: I): I => {
  if (typeof input !== "object" || input === null) return input;
  const entries = Object.entries(input).map(([field, value]) =>
    PATH_FIELDS.includes(field) && typeof value === "string"
      ? [field, resolve(value)]
      : [field, value],
  );
  return Object.fromEntries(entries) as I;
};

export const json = Flag.Boolean("json").pipe(
  Flag.withDescription("Print JSON"),
  Flag.withDefault(false),
);

type Render = (result: unknown) => ReadonlyArray<string>;

/** Prints a success: the renderer's lines, or JSON when there is none or `--json` asks for it. */
const print = (
  operation: Operation,
  render: Render | undefined,
  result: unknown,
  asJson: boolean,
) => {
  if (render === undefined || asJson)
    return Console.log(
      JSON.stringify(
        Schema.encodeUnknownSync(
          Schema.toCodecJson(operation.success as Schema.Top) as unknown as Schema.Codec<
            unknown,
            unknown
          >,
        )(result),
        null,
        2,
      ),
    );
  return Effect.forEach(render(result), (text) => Console.log(text), { discard: true });
};

const commandFor = <E, R>(
  name: string,
  operation: Operation,
  cli: CliCommand,
  run: RunOperation<E, R>,
) => {
  const { book: _book, ...fields } = operation.input.fields;
  const flags = schemaFlags(Schema.Struct(fields));
  const render = renderers[name as OperationName] as Render | undefined;
  const command = Command.make(
    cli.command.at(-1)!,
    { input: flags.params, json },
    Effect.fn(function* (parsed: {
      readonly input: Parameters<typeof flags.decode>[0];
      readonly json: boolean;
    }) {
      const input = withAbsolutePath(yield* flags.decode(parsed.input));
      const result = yield* run(name, input);
      yield* print(operation, render, result, parsed.json);
    }),
  ).pipe(
    Command.validate(({ input }) => Effect.asVoid(flags.decode(input))),
    Command.withDescription(cli.description),
  );
  const aliased = (cli.aliases ?? []).reduce(
    (self, alias) => Command.withAlias(self, alias),
    command,
  );
  return cli.examples === undefined ? aliased : Command.withExamples(aliased, [...cli.examples]);
};

/** One command for each operation with a `cli` entry. */
export const operationCommands = <E, R>(
  operations: Readonly<Record<string, Operation>>,
  run: RunOperation<E, R>,
): Array<OperationCommand<E, R>> =>
  Object.entries(operations).flatMap(([name, operation]) =>
    operation.cli === undefined
      ? []
      : [
          {
            words: operation.cli.command,
            command: commandFor(name, operation, operation.cli, run) as unknown as OperationCommand<
              E,
              R
            >["command"],
          },
        ],
  );
