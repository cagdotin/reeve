/**
 * The reeve home: `<home>/books/<id>.sqlite` for each book, `<home>/receipts/<id>/` for its
 * receipt photos, `<home>/config.json` naming the default book, and `<home>/server.json` while a
 * server runs (docs/rules/boundaries.md and docs/rules/purchases.md).
 */
import { ServerInfo, StorageError } from "@reeve/contract";
import { Effect, Option, Schema } from "effect";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const defaultHome = (env: NodeJS.ProcessEnv, homedir: string): string =>
  env["REEVE_HOME"] ?? `${env["XDG_CONFIG_HOME"] ?? `${homedir}/.config`}/reeve`;

export const booksDir = (home: string) => join(home, "books");
export const bookFile = (home: string, id: string) => join(booksDir(home), `${id}.sqlite`);
/** A book's receipt photos: one folder per receipt. */
export const receiptsDir = (home: string, id: string) => join(home, "receipts", id);
/** The home a book's file lies in. */
export const homeOfBook = (file: string) => dirname(dirname(file));

/** Writes through a temporary sibling and a rename, so no reader sees half a file. */
export const writeFileAtomic = (file: string, content: string) => {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temp, content);
  renameSync(temp, file);
};

const HomeConfig = Schema.Struct({ defaultBook: Schema.optionalKey(Schema.String) });
type HomeConfig = typeof HomeConfig.Type;

export const readHomeConfig = (home: string): HomeConfig => {
  try {
    return Schema.decodeUnknownSync(Schema.fromJsonString(HomeConfig))(
      readFileSync(join(home, "config.json"), "utf8"),
    );
  } catch {
    return {};
  }
};

export const writeHomeConfig = (home: string, config: HomeConfig) => {
  mkdirSync(home, { recursive: true });
  writeFileAtomic(join(home, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
};

/** The ids of the books in `home`, by file name. */
export const bookIds = (home: string): Array<string> =>
  existsSync(booksDir(home))
    ? readdirSync(booksDir(home))
        .filter((name) => name.endsWith(".sqlite"))
        .map((name) => name.slice(0, -".sqlite".length))
        .toSorted()
    : [];

export const removeBookFiles = (home: string, id: string) => {
  const file = bookFile(home, id);
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${file}${suffix}`, { force: true });
  rmSync(receiptsDir(home, id), { recursive: true, force: true });
};

const serverFile = (home: string) => join(home, "server.json");

const fail = (message: string) => (cause: unknown) => new StorageError({ message, cause });

/** The server `<home>/server.json` names, or none when there is no file. */
export const readServerInfo = (
  home: string,
): Effect.Effect<Option.Option<ServerInfo>, StorageError> =>
  Effect.try({
    try: () => {
      const file = serverFile(home);
      if (!existsSync(file)) return Option.none<ServerInfo>();
      return Option.some(
        Schema.decodeUnknownSync(Schema.fromJsonString(ServerInfo))(readFileSync(file, "utf8")),
      );
    },
    catch: fail(`Could not read ${serverFile(home)}`),
  });

export const writeServerInfo = (
  home: string,
  info: ServerInfo,
): Effect.Effect<void, StorageError> =>
  Effect.try({
    try: () => {
      mkdirSync(home, { recursive: true });
      writeFileAtomic(serverFile(home), `${JSON.stringify(info, null, 2)}\n`);
    },
    catch: fail(`Could not write ${serverFile(home)}`),
  });

/** Removes `<home>/server.json` if it still names `info`, and not a server that started since. */
export const removeServerInfo = (
  home: string,
  info: ServerInfo,
): Effect.Effect<void, StorageError> =>
  Effect.gen(function* () {
    const named = yield* readServerInfo(home).pipe(Effect.orElseSucceed(Option.none));
    if (Option.isNone(named) || named.value.url !== info.url || named.value.pid !== info.pid)
      return;
    yield* Effect.try({
      try: () => rmSync(serverFile(home), { force: true }),
      catch: fail(`Could not remove ${serverFile(home)}`),
    });
  });
