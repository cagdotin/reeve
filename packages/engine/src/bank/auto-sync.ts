import { eq } from "drizzle-orm";
import { Duration, Effect, Schedule } from "effect";
import { readSettings } from "../book.ts";
import { Books } from "../books.ts";
import { bookIds } from "../home.ts";
import { bankConnections, bankLinks } from "./schema.ts";
import { syncAccounts } from "./sync.ts";

/** Four fetches a day, evenly, is what banks allow when no person is present. */
const SPACING_MS = 6 * 60 * 60 * 1000;
const TICK = Duration.minutes(15);

/** One pass over the books whose setting asks for it; a link's outcome lands on the link. */
export const syncDueBankAccounts = (now: number = Date.now()) =>
  Effect.gen(function* () {
    const books = yield* Books;
    for (const id of bookIds(books.home)) {
      const book = yield* books.open(id);
      if (!readSettings(book.db).bankAutoSync) continue;
      const due = book.db
        .select({ link: bankLinks, consent: bankConnections.status })
        .from(bankLinks)
        .innerJoin(bankConnections, eq(bankConnections.id, bankLinks.connectionId))
        .all()
        .filter(
          ({ link, consent }) =>
            consent === "active" &&
            (link.retryAfter === null || link.retryAfter <= now) &&
            (link.lastSyncedAt === null || now - link.lastSyncedAt >= SPACING_MS),
        );
      for (const { link } of due) yield* syncAccounts(book, books, { account: link.accountId });
    }
  });

/**
 * Runs for as long as the server does. Due times are read from the links, so sleep and restarts
 * catch up by themselves and cannot burst past a bank's allowance.
 */
export const bankAutoSync = syncDueBankAccounts().pipe(
  Effect.catchCause((cause) => Effect.logWarning("Bank sync pass failed", cause)),
  Effect.repeat(Schedule.spaced(TICK)),
  Effect.asVoid,
);
