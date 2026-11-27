/**
 * The promise of a fetch: whatever a person does between fetches, fetching again adds nothing
 * and each account's cleared balance stays what the book's own postings say.
 */
import { addDays, today } from "@reeve/contract/rules";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  line,
  startFakeBank,
  TEST_APP,
  TEST_KEY,
  type FakeAccount,
  type FakeBank,
} from "./fake-enable-banking.ts";
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
let fake: FakeBank;
let book: string;

const call = (name: string, input: Record<string, unknown> = {}) =>
  s.call(name, { book, ...input });
const REDIRECT = "https://localhost/reeve";

/** Mulberry32: a small seeded generator, so a failing run replays from its seed. */
const generator = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let mixed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
  return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
};

beforeEach(async () => {
  s = scratch();
  fake = await startFakeBank();
  process.env["REEVE_ENABLE_BANKING_URL"] = fake.url;
  book = (await s.call("create_book", { name: "Probe" })).id;
  await s.call("set_bank_credentials", {
    applicationId: TEST_APP,
    key: TEST_KEY,
    redirectUrl: REDIRECT,
  });
});

afterEach(async () => {
  delete process.env["REEVE_ENABLE_BANKING_URL"];
  await fake.close();
  await s.dispose();
});

const linkTwoAccounts = async () => {
  const accounts: Array<FakeAccount> = [
    { uid: "a", name: "A", identification_hash: "a", lines: [] },
    { uid: "b", name: "B", identification_hash: "b", lines: [] },
  ];
  fake.sessionAccounts = accounts;
  const begun = await call("begin_bank_link", { bank: "Erste Bank", country: "AT" });
  const state = new URL(begun.url).searchParams.get("state");
  const connection = await call("complete_bank_link", {
    redirectUrl: `${REDIRECT}?code=good-code&state=${state}`,
  });
  const ids: Array<string> = [];
  for (const account of accounts) {
    const link = await call("link_bank_account", {
      connection: connection.id,
      providerAccount: account.uid,
      name: account.name,
      historyStart: addDays(today(), -60),
    });
    ids.push(link.account);
  }
  return { accounts, ids };
};

const registerOf = async (account: string) => {
  const { rows } = await call("list_transactions", { account });
  return rows
    .map((row: any) => `${row.date} ${row.amount} ${row.cleared}`)
    .sort()
    .join("|");
};

describe("fetching converges", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])("under random activity, seed %i", async (seed) => {
    const random = generator(seed);
    const pick = (below: number) => Math.floor(random() * below);
    const { accounts, ids } = await linkTwoAccounts();
    let serial = 0;
    // Undo stops at the fetches: one step further would take back the accounts themselves.
    let undoable = 0;

    for (let round = 0; round < 12; round += 1) {
      const move = pick(5);
      const index = pick(accounts.length);
      const account = ids[index]!;
      if (move <= 1) {
        serial += 1;
        accounts[index]!.lines.push(
          line(
            `L${serial}`,
            addDays(today(), -1 - pick(40)),
            (pick(2) === 0 ? -1 : 1) * (100 + pick(5000)),
            `Party ${pick(4)}`,
          ),
        );
      } else if (move === 2) {
        const { rows } = await call("list_transactions", { account });
        const row = rows[pick(rows.length)];
        if (row !== undefined) {
          await call("delete_transactions", { ids: [row.transactionId] });
          undoable += 1;
        }
      } else if (move === 3 && undoable > 0) {
        await call("undo");
        undoable -= 1;
      }
      const [fetched] = await call("sync_bank_accounts", { account, force: true });
      if (fetched.added + fetched.updated > 0) undoable += 1;

      const before = await Promise.all(ids.map(registerOf));
      const again = await call("sync_bank_accounts", { force: true });
      expect(
        again.map((result: any) => result.added + result.updated),
        `round ${round}: a second fetch finds nothing to do`,
      ).toEqual([0, 0]);
      expect(await Promise.all(ids.map(registerOf)), `round ${round}: nor changes a line`).toEqual(
        before,
      );
    }

    const listed = await call("list_accounts");
    for (const id of ids) {
      const { rows } = await call("list_transactions", { account: id });
      const sum = rows.reduce((total: number, row: any) => total + row.amount, 0);
      expect(listed.find((each: any) => each.id === id).balance, "balance is its lines").toBe(sum);
    }
  });
});
