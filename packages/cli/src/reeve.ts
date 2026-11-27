import { connect, Connection, findServer } from "@reeve/client";
import { InvalidRequest } from "@reeve/contract";
import { availableCatalog, inOneBook } from "@reeve/contract/catalog";
import { defaultHome } from "@reeve/engine";
import { stdioLayer } from "@reeve/mcp";
import { DEFAULT_PORT, HomeTaken, startServer } from "@reeve/server";
import { Console, Effect, FileSystem, Layer, Option, Path } from "effect";
import { Command, Flag } from "effect/cli";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { operationCommands } from "./commands.ts";
import { SKILL } from "./skill.ts";

export const home = defaultHome(process.env, homedir());

const operations = availableCatalog();

const root = Command.make("reeve").pipe(
  Command.withSharedFlags({
    book: Flag.String("book").pipe(
      Flag.withAlias("b"),
      Flag.withDescription("Book id; the default book when left out"),
      Flag.optional,
    ),
  }),
  Command.withDescription("A personal budget on a double-entry ledger, from the terminal"),
);

/** Runs an operation in the book `--book` names, or the default one. */
const runInBook = (name: string, input: object) =>
  Effect.gen(function* () {
    const connection = yield* Connection;
    const flags = yield* root;
    const book = Option.getOrUndefined(flags.book);
    return yield* connection.run(
      name,
      inOneBook(operations[name]!) && book !== undefined ? { ...input, book } : input,
    );
  });

const generated = operationCommands(operations, runInBook);

/** The generated commands run by `words`, which start with the group's name when it has one. */
const commandsIn = (...group: ReadonlyArray<string>) =>
  generated
    .filter(
      ({ words }) =>
        words.length === group.length + 1 && group.every((word, index) => words[index] === word),
    )
    .map(({ command }) => command);

const GROUPS: Record<string, string> = {
  books: "Manage books (budget files)",
  accounts: "Manage accounts",
  categories: "Manage categories and groups",
  payees: "Manage payees",
  transactions: "List, add and change transactions",
  budget: "Read and assign the budget",
  rules: "Manage rules",
  schedules: "Manage schedules",
  reports: "Run reports and manage custom reports",
  dashboard: "Manage the reports dashboard",
  tags: "Manage tags",
  templates: "Apply and check budget targets (goal templates)",
  targets: "Read, set and preview a category's budget targets",
  import: "Import transactions from bank files (CSV, OFX, QFX, QIF, CAMT)",
  export: "Export transactions as CSV, or the book as a backup",
  receipts: "Itemized receipts: add, match to transactions, apply as splits, photos",
  products: "Products bought, their receipt aliases and prices",
  items: "Item categories and spending by item",
};

const groups = [
  ...new Set(generated.filter(({ words }) => words.length === 2).map(({ words }) => words[0])),
].map((group) =>
  Command.make(group).pipe(
    Command.withDescription(GROUPS[group] ?? group),
    Command.withSubcommands(commandsIn(group)),
  ),
);

const serveCommand = Command.make(
  "serve",
  {
    port: Flag.Int("port").pipe(Flag.withDefault(DEFAULT_PORT)),
    webDir: Flag.String("web-dir").pipe(
      Flag.withDescription("Built web app to serve"),
      Flag.optional,
    ),
  },
  Effect.fn(function* (options) {
    const running = yield* findServer(home);
    if (Option.isSome(running))
      return yield* new InvalidRequest({
        message: `reeve already runs at ${running.value.url} (pid ${running.value.pid}). Use it, or stop it first.`,
      });
    // The reeve inside the desktop app names the web app the app ships.
    const defaultWeb =
      process.env["REEVE_WEB_DIR"] ??
      fileURLToPath(new URL("../../../apps/web/dist", import.meta.url));
    // Narrowed below: a busy port and a taken home become InvalidRequest, the rest a defect.
    // @effect-diagnostics-next-line globalErrorInEffectCatch:off
    const start = Effect.tryPromise({
      try: () =>
        startServer({
          home,
          port: options.port,
          webDir: Option.getOrElse(options.webDir, () => defaultWeb),
        }),
      catch: (error) => error as NodeJS.ErrnoException,
    }).pipe(
      Effect.catch((error) =>
        error.code === "EADDRINUSE"
          ? Effect.fail(
              new InvalidRequest({
                message: `Port ${options.port} is in use. Pass another with --port, or stop what listens there.`,
              }),
            )
          : error instanceof HomeTaken
            ? Effect.fail(new InvalidRequest({ message: error.message }))
            : Effect.die(error),
      ),
    );
    const server = yield* Effect.acquireRelease(start, (running) =>
      Effect.promise(() => running.close()),
    );
    yield* Console.log(`reeve on ${server.url}`);
    yield* Console.log(`MCP: ${server.mcpUrl}`);
    return yield* Effect.never;
  }, Effect.scoped),
).pipe(
  Command.withDescription(
    "Serve the web app, API and MCP endpoint, unless a reeve server already runs",
  ),
);

const mcpCommand = Command.make(
  "mcp",
  {},
  Effect.fn(function* () {
    const flags = yield* root;
    const connection = yield* connect({ home });
    const book = Option.getOrUndefined(flags.book);
    return yield* Layer.launch(
      stdioLayer({
        operations: connection.operations,
        run: (name, input) =>
          connection.run(
            name,
            book !== undefined && inOneBook(operations[name]!) && !("book" in input)
              ? { ...input, book }
              : input,
          ),
      }),
    );
  }, Effect.scoped),
).pipe(Command.withDescription("Run the MCP server over stdio, for agents"));

const skillsCommand = Command.make("skills").pipe(
  Command.withDescription("Agent skills"),
  Command.withSubcommands([
    Command.make(
      "export",
      {
        dir: Flag.String("dir").pipe(
          Flag.withDescription("Skills folder"),
          Flag.withDefault(".agents/skills"),
        ),
      },
      Effect.fn(function* ({ dir }) {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const folder = path.join(dir, "reeve");
        yield* fs.makeDirectory(folder, { recursive: true });
        yield* fs.writeFileString(path.join(folder, "SKILL.md"), SKILL);
        yield* Console.log(`Wrote ${path.join(folder, "SKILL.md")}`);
      }),
    ).pipe(Command.withDescription("Write the reeve skill so agents know how to use it")),
  ]),
);

export const reeve = root.pipe(
  Command.withSubcommands([...commandsIn(), ...groups, serveCommand, mcpCommand, skillsCommand]),
);
