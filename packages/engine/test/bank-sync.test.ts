import { DatabaseSync } from "node:sqlite";
import { addDays, today } from "@reeve/contract/rules";
import { ManagedRuntime } from "effect";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  line,
  startFakeBank,
  TEST_APP,
  TEST_KEY,
  type FakeAccount,
  type FakeBank,
} from "./fake-enable-banking.ts";
import { syncDueBankAccounts } from "../src/bank/auto-sync.ts";
import { Books } from "../src/books.ts";
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
let fake: FakeBank;
let book: string;

const call = (name: string, input: Record<string, unknown> = {}) =>
  s.call(name, { book, ...input });
const day = (back: number) => addDays(today(), -back);
const REDIRECT = "https://localhost/reeve";

const erste: FakeAccount = {
  uid: "erste-1",
  name: "Giro",
  iban: "AT001",
  identification_hash: "hash-erste",
  lines: [],
};
const revolut: FakeAccount = {
  uid: "revolut-1",
  name: "Main",
  identification_hash: "hash-revolut",
  lines: [],
};

const setUp = () =>
  s.call("set_bank_credentials", { applicationId: TEST_APP, key: TEST_KEY, redirectUrl: REDIRECT });

/** Consent at a bank, as a person gives it, and a new ledger account fed by each given account. */
const connect = async (
  bank: string,
  accounts: ReadonlyArray<FakeAccount>,
  names: Array<string>,
) => {
  fake.sessionAccounts = [...accounts];
  const begun = await call("begin_bank_link", { bank, country: "AT" });
  const state = new URL(begun.url).searchParams.get("state");
  const connection = await call("complete_bank_link", {
    redirectUrl: `${REDIRECT}?code=good-code&state=${state}`,
  });
  const ids: Array<string> = [];
  for (const [index, account] of accounts.entries()) {
    const link = await call("link_bank_account", {
      connection: connection.id,
      providerAccount: account.uid,
      name: names[index],
      historyStart: day(60),
    });
    ids.push(link.account);
  }
  return ids;
};

const sync = async (account?: string, extra: Record<string, unknown> = {}) =>
  (
    await call("sync_bank_accounts", { ...(account === undefined ? {} : { account }), ...extra })
  )[0];

const balance = async (id: string) =>
  (await call("list_accounts")).find((each: any) => each.id === id).balance as number;

const rows = async (id: string) =>
  (await call("list_transactions", { account: id })).rows as Array<any>;

beforeEach(async () => {
  s = scratch();
  fake = await startFakeBank();
  process.env["REEVE_ENABLE_BANKING_URL"] = fake.url;
  book = (await s.call("create_book", { name: "Probe" })).id;
  erste.lines = [];
  revolut.lines = [];
  delete erste.balances;
  delete revolut.balances;
});

afterEach(async () => {
  delete process.env["REEVE_ENABLE_BANKING_URL"];
  await fake.close();
  await s.dispose();
});

describe("credentials", () => {
  it("keeps the key readable only by this user and never returns it", async () => {
    const answer = await setUp();
    expect(JSON.stringify(answer)).not.toContain("PRIVATE KEY");
    const status = await call("bank_status");
    expect(status).toMatchObject({
      configured: true,
      applicationId: TEST_APP,
      redirectUrl: REDIRECT,
    });
    expect(JSON.stringify(status)).not.toContain("PRIVATE KEY");
    const file = join(s.home, "bank", "enable-banking.pem");
    expect(readFileSync(file, "utf8")).toBe(TEST_KEY);
    expect(statSync(file).mode & 0o077).toBe(0);
    expect(statSync(join(s.home, "bank")).mode & 0o077).toBe(0);
  });

  it("takes the key from a file", async () => {
    const path = join(s.home, "downloaded.pem");
    writeFileSync(path, TEST_KEY);
    await s.call("set_bank_credentials", {
      applicationId: TEST_APP,
      keyPath: path,
      redirectUrl: REDIRECT,
    });
    expect((await call("bank_status")).configured).toBe(true);
  });

  it("refuses what is not an RSA key, without repeating it", async () => {
    const error = await s.fails("set_bank_credentials", {
      applicationId: TEST_APP,
      key: "my-secret-text",
      redirectUrl: REDIRECT,
    });
    expect(error._tag).toBe("InvalidRequest");
    expect(error.message).not.toContain("my-secret-text");
    expect((await call("bank_status")).configured).toBe(false);
  });

  it("refuses a redirect the provider would refuse", async () => {
    const error = await s.fails("set_bank_credentials", {
      applicationId: TEST_APP,
      key: TEST_KEY,
      redirectUrl: "http://127.0.0.1:4620",
    });
    expect(error.message).toContain("https://");
  });

  it("does not save a key the provider turns down", async () => {
    fake.failure = { status: 401, body: { error: "UNAUTHORIZED", message: "Unknown application" } };
    const error = await s.fails("set_bank_credentials", {
      applicationId: TEST_APP,
      key: TEST_KEY,
      redirectUrl: REDIRECT,
    });
    expect(error).toMatchObject({ _tag: "BankError", code: "UNAUTHORIZED" });
    expect((await call("bank_status")).configured).toBe(false);
  });

  it("forgets the key", async () => {
    await setUp();
    expect(await s.call("remove_bank_credentials")).toEqual({ removed: true });
    expect((await call("bank_status")).configured).toBe(false);
  });

  it("asks for a key before anything that reaches the provider", async () => {
    const error = await call("begin_bank_link", { bank: "Erste Bank", country: "AT" }).catch(
      (e: any) => e,
    );
    expect(error).toMatchObject({ _tag: "BankError" });
  });
});

describe("linking", () => {
  beforeEach(setUp);

  it("lists a country's banks with their longest consent in days", async () => {
    const banks = await s.call("list_banks", { country: "at" });
    expect(banks).toEqual([
      { name: "Erste Bank", country: "AT", maximumConsentDays: 180 },
      { name: "Revolut", country: "AT", maximumConsentDays: 90 },
    ]);
  });

  it("asks for the longest consent the bank gives, as a personal user", async () => {
    await call("begin_bank_link", { bank: "Erste Bank", country: "AT" });
    const auth = fake.auths[0]!;
    expect(auth["psu_type"]).toBe("personal");
    expect(auth["redirect_url"]).toBe(REDIRECT);
    const days = (Date.parse((auth["access"] as any).valid_until) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(179);
    expect(days).toBeLessThanOrEqual(180);
  });

  it("refuses a bank the provider does not know", async () => {
    const error = await s.fails("begin_bank_link", { book, bank: "Nope", country: "AT" });
    expect(error._tag).toBe("InvalidRequest");
  });

  it("refuses an address from another consent", async () => {
    await call("begin_bank_link", { bank: "Erste Bank", country: "AT" });
    const error = await s.fails("complete_bank_link", {
      book,
      redirectUrl: `${REDIRECT}?code=good-code&state=someone-elses`,
    });
    expect(error._tag).toBe("InvalidRequest");
    expect(fake.requests.some((each) => each.path === "/sessions")).toBe(false);
  });

  it("says what the bank said when consent was refused", async () => {
    await call("begin_bank_link", { bank: "Erste Bank", country: "AT" });
    const error = await s.fails("complete_bank_link", {
      book,
      redirectUrl: `${REDIRECT}?error=access_denied&error_description=Declined`,
    });
    expect(error.message).toContain("Declined");
  });

  it("takes a bare code when no address was kept", async () => {
    fake.sessionAccounts = [erste];
    await call("begin_bank_link", { bank: "Erste Bank", country: "AT" });
    const connection = await call("complete_bank_link", { redirectUrl: "good-code" });
    expect(connection.accounts.map((each: any) => each.id)).toEqual(["erste-1"]);
  });

  it("explains an empty consent, a restricted application's usual trap", async () => {
    fake.sessionAccounts = [];
    await call("begin_bank_link", { bank: "Erste Bank", country: "AT" });
    const error = await s.fails("complete_bank_link", { book, redirectUrl: "good-code" });
    expect(error.message).toContain("control panel");
  });

  it("starts a linked account after its latest transaction, so a file's rows are not taken twice", async () => {
    fake.sessionAccounts = [erste];
    await call("begin_bank_link", { bank: "Erste Bank", country: "AT" });
    const connection = await call("complete_bank_link", { redirectUrl: "good-code" });
    const account = (await call("create_account", { name: "Giro" })).id;
    await call("create_transaction", { account, date: day(5), amount: -100, payee: "From a file" });
    const link = await call("link_bank_account", {
      connection: connection.id,
      providerAccount: "erste-1",
      account,
    });
    expect(link.historyStart).toBe(day(4));
  });

  it("carries links to a new consent by the account's hash, with no duplicates", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [line("E1", day(3), -500, "Shop")];
    await sync(giro);

    fake.sessionAccounts = [{ ...erste, uid: "erste-2", lines: erste.lines }];
    await call("begin_bank_link", { bank: "Erste Bank", country: "AT" });
    await call("complete_bank_link", { redirectUrl: "good-code" });
    const status = await call("bank_status");
    expect(status.connections).toHaveLength(1);
    expect(status.links[0]).toMatchObject({ account: giro, status: "ok" });

    const result = await sync(giro);
    expect(result).toMatchObject({ status: "ok", added: 0, unchanged: 1 });
    expect(fake.requests.at(-2)!.path).toContain("/accounts/erste-2/");
    expect(await rows(giro!)).toHaveLength(1);
  });

  it("ends a consent and unlinks its accounts, keeping their transactions", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [line("E1", day(3), -500, "Shop")];
    await sync(giro);
    const { connections } = await call("bank_status");
    await call("remove_bank_connection", { id: connections[0].id });
    expect(await call("bank_status")).toMatchObject({ connections: [], links: [] });
    expect(fake.requests.some((each) => each.method === "DELETE")).toBe(true);
    expect(await rows(giro!)).toHaveLength(1);
  });
});

describe("syncing", () => {
  beforeEach(setUp);

  it("imports booked lines through the rules, and a second fetch changes nothing", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    const group = await call("create_category_group", { name: "Living" });
    const food = (await call("create_category", { name: "Food", groupId: group.id })).id;
    await call("create_rule", {
      conditions: [{ field: "imported_payee", op: "contains", value: "BILLA" }],
      actions: [{ op: "set", field: "category", value: food }],
    });
    erste.lines = [
      line("E1", day(3), -1999, "BILLA DANKT"),
      line("E2", day(2), 435, "Refund", { remittance_information: ["EREF+inv-1", "#42 back"] }),
    ];
    const first = await sync(giro);
    expect(first).toMatchObject({ status: "ok", added: 2, updated: 0, unchanged: 0 });
    expect(await balance(giro!)).toBe(-1999 + 435);
    const listed = await rows(giro!);
    expect(listed.map((row) => row.amount).sort((a, b) => a - b)).toEqual([-1999, 435]);
    expect(listed.every((row) => row.cleared)).toBe(true);
    const billa = listed.find((row) => row.amount === -1999);
    expect(billa.counterpart.id ?? billa.counterpart).toBeTruthy();
    const refund = await call("get_transaction", {
      id: listed.find((row) => row.amount === 435).transactionId,
    });
    expect(refund.notes).toBe("inv-1 ##42 back");

    const again = await sync(giro);
    expect(again).toMatchObject({ status: "ok", added: 0, updated: 0, unchanged: 2 });
    expect(await rows(giro!)).toHaveLength(2);
  });

  it("asks only for booked lines, and the deep history on a link's first fetch", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    await sync(giro);
    await sync(giro);
    const fetches = fake.requests.filter((each) => each.path.includes("/transactions"));
    expect(fetches[0]!.path).toContain("transaction_status=BOOK");
    expect(fetches[0]!.path).toContain("strategy=longest");
    expect(fetches[1]!.path).not.toContain("strategy=longest");
  });

  it("follows the provider's pages and stops at a repeated key", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    fake.pageSize = 2;
    erste.lines = Array.from({ length: 5 }, (_, index) =>
      line(`E${index}`, day(5), -(index + 1), "Shop"),
    );
    expect(await sync(giro)).toMatchObject({ added: 5 });
  });

  it("does not take lines from before the link's first day, though a bank sends them", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [line("OLD", day(61), -100, "Old"), line("NEW", day(60), -200, "New")];
    expect(await sync(giro)).toMatchObject({ added: 1 });
  });

  it("reads the amount by its digits, not through a float", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [
      {
        ...line("A", day(3), 0, "Shop"),
        credit_debit_indicator: "DBIT",
        transaction_amount: { amount: "19.99", currency: "EUR" },
      },
      {
        ...line("B", day(3), 0, "Shop"),
        credit_debit_indicator: "DBIT",
        transaction_amount: { amount: "4.35", currency: "EUR" },
      },
      {
        ...line("C", day(3), 0, "Shop"),
        credit_debit_indicator: "CRDT",
        transaction_amount: { amount: "1001.1", currency: "EUR" },
      },
    ];
    await sync(giro);
    expect(await balance(giro!)).toBe(-1999 - 435 + 100110);
  });

  it("finds Revolut's payee in its second remittance line", async () => {
    const [main] = await connect("Revolut", [revolut], ["Main"]);
    revolut.lines = [
      {
        ...line("R1", day(3), -500, "x"),
        creditor: null,
        remittance_information: ["Card payment", "Spar Wien"],
      },
    ];
    await sync(main);
    const [row] = await rows(main!);
    const tx = await call("get_transaction", { id: row.transactionId });
    expect(tx).toMatchObject({ payee: "Spar Wien", notes: "Card payment" });
  });

  const card = (id: string, back: number, cents: number, text: string) => ({
    ...line(id, day(back), cents, "x"),
    creditor: null,
    remittance_information: [text],
  });

  it("names a card payment's shop without the day and the minute", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [
      card("C1", 3, -670, "TABAK TRAFIK 3219  K2   01.11. 22:26"),
      card("C2", 2, -1150, "TABAK TRAFIK 2362  K2   03.11. 09:45"),
    ];
    await sync(giro);
    const found = await rows(giro!);
    const txs = await Promise.all(
      found.map((row) => call("get_transaction", { id: row.transactionId })),
    );
    expect(new Set(txs.map((tx) => tx.payee)), "one payee for both purchases").toEqual(
      new Set(["Tabak Trafik"]),
    );
    expect(
      txs.map((tx) => tx.notes).toSorted((a, b) => a.localeCompare(b)),
      "the bank's text stays in the notes",
    ).toEqual(["TABAK TRAFIK 2362  K2   03.11. 09:45", "TABAK TRAFIK 3219  K2   01.11. 22:26"]);
  });

  it("takes every line of a booking that shares one id, and the next fetch finds them all", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [
      card("AB1", 3, -2124, "Kontoführung"),
      card("AB1", 3, -2, "Kest"),
      card("AB1", 3, 6, "Habenzinsen"),
      card(
        "AB1",
        3,
        0,
        "*** Abschlussbuchung per 30.09.2026 **** Reklamationen bitte binnen 2 Monaten",
      ),
    ];
    expect(await sync(giro)).toMatchObject({ added: 4, conflicts: 0 });
    expect(await sync(giro)).toMatchObject({ status: "ok", added: 0, conflicts: 0, unchanged: 4 });
    expect(await balance(giro!)).toBe(-2120);
  });

  it("keeps a renamed payee's name for the shop's later lines", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [card("C1", 5, -670, "TABAK TRAFIK 3219  K2   01.11. 22:26")];
    await sync(giro);
    const payee = (await call("list_payees")).find((each: any) => each.name === "Tabak Trafik");
    await call("update_payee", { id: payee.id, name: "Tabak Trafik Mila", renameImports: true });
    erste.lines.push(card("C2", 1, -650, "TABAK TRAFIK 3219  K2   07.11. 19:16"));
    expect(await sync(giro, { force: true })).toMatchObject({ added: 1 });
    const names = (await call("list_payees")).map((each: any) => each.name);
    expect(names, "no payee comes back under the old name").not.toContain("Tabak Trafik");
    expect(names).toContain("Tabak Trafik Mila");
  });

  it("sends a merged payee's later lines to the payee kept", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [
      card("C1", 5, -300, "SPAR         2361  K2   24.09. 19:24"),
      card("C2", 4, -400, "POS           3,08 AT  K2   06.05. 16:42 SPAR DANKT 4824 WIEN 1090 040"),
    ];
    await sync(giro);
    const payees = await call("list_payees");
    const spar = payees.find((each: any) => each.name === "Spar");
    const dankt = payees.find((each: any) => each.name === "Spar Dankt");
    await call("merge_payees", { target: spar.id, merge: [dankt.id], renameImports: true });
    erste.lines.push(
      card("C3", 1, -500, "POS           9,10 AT  K2   07.11. 10:02 SPAR DANKT 4230 WIEN 1010 040"),
    );
    await sync(giro, { force: true });
    const names = (await call("list_payees")).map((each: any) => each.name);
    expect(names).toContain("Spar");
    expect(names, "the merged name does not come back").not.toContain("Spar Dankt");
  });

  it("names a merged payee anew, and every name it had sends later lines to it", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [
      card("C1", 5, -300, "SPAR         2361  K2   24.09. 19:24"),
      card("C2", 4, -400, "POS           3,08 AT  K2   06.05. 16:42 SPAR DANKT 4824 WIEN 1090 040"),
    ];
    await sync(giro);
    const payees = await call("list_payees");
    const spar = payees.find((each: any) => each.name === "Spar");
    const dankt = payees.find((each: any) => each.name === "Spar Dankt");
    const merged = await call("merge_payees", {
      target: spar.id,
      merge: [dankt.id],
      name: "SPAR Supermarkt",
      renameImports: true,
    });
    expect(merged).toMatchObject({ id: spar.id, name: "SPAR Supermarkt", transactionCount: 2 });
    const names = async () => (await call("list_payees")).map((each: any) => each.name).toSorted();
    await call("undo");
    expect(await names(), "one undo takes back the merge and the name").toEqual([
      "Spar",
      "Spar Dankt",
    ]);
    await call("redo");
    erste.lines.push(
      card("C3", 1, -500, "SPAR         2361  K2   07.11. 10:02"),
      card("C4", 1, -600, "POS           9,10 AT  K2   07.11. 12:02 SPAR DANKT 4230 WIEN 1010 040"),
    );
    expect(await sync(giro, { force: true })).toMatchObject({ added: 2 });
    expect(await names(), "neither former name comes back").toEqual(["SPAR Supermarkt"]);
  });

  it("refuses a merged payee's new name when another payee has it", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [
      card("C1", 5, -300, "SPAR         2361  K2   24.09. 19:24"),
      card("C2", 4, -400, "INTERSPAR    2361  K2   27.08. 15:49"),
    ];
    await sync(giro);
    await call("create_payee", { name: "Hofer" });
    const payees = await call("list_payees");
    const [spar, inter] = ["Spar", "Interspar"].map((name) =>
      payees.find((each: any) => each.name === name),
    );
    await expect(
      call("merge_payees", { target: spar.id, merge: [inter.id], name: "Hofer" }),
    ).rejects.toThrow("There is already a payee named Hofer");
    expect((await call("list_payees")).map((each: any) => each.name).toSorted()).toEqual([
      "Hofer",
      "Interspar",
      "Spar",
    ]);
  });

  it("merges without touching the rules unless asked", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [
      card("C1", 5, -300, "SPAR         2361  K2   24.09. 19:24"),
      card("C2", 4, -400, "INTERSPAR    2361  K2   27.08. 15:49"),
    ];
    await sync(giro);
    const payees = await call("list_payees");
    const [spar, inter] = ["Spar", "Interspar"].map((name) =>
      payees.find((each: any) => each.name === name),
    );
    await call("merge_payees", { target: spar.id, merge: [inter.id] });
    expect(await call("list_rules")).toHaveLength(0);
  });

  it("keeps identical lines with no id as two purchases across fetches", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [line(null, day(3), -500, "Shop"), line(null, day(3), -500, "Shop")];
    expect(await sync(giro)).toMatchObject({ added: 2 });
    expect(await sync(giro)).toMatchObject({ added: 0, unchanged: 2 });
    expect(await rows(giro!)).toHaveLength(2);
  });

  it("gives a line no number when it cannot be imported", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    const valid = line(null, day(3), -500, "Shop", { transaction_date: day(4) });
    erste.lines = [{ ...valid, booking_date: "26/08/2026" }, valid];
    expect(await sync(giro)).toMatchObject({ added: 1, conflicts: 1 });
    erste.lines = [valid];
    expect(await sync(giro), "the line keeps its id once the unreadable one is gone").toMatchObject(
      { added: 0, unchanged: 1 },
    );
  });

  it("takes a line the bank sends twice once", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [line("E1", day(3), -500, "Shop"), line("E1", day(3), -500, "Shop")];
    expect(await sync(giro)).toMatchObject({ added: 1, unchanged: 1 });
    expect(await balance(giro!)).toBe(-500);
  });

  it("leaves a row alone when its id comes back with another amount", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [line("E1", day(3), -500, "Shop")];
    await sync(giro);
    erste.lines = [line("E1", day(3), -999, "Someone else")];
    const result = await sync(giro);
    expect(result).toMatchObject({ status: "attention", added: 0, conflicts: 1 });
    expect(await balance(giro!)).toBe(-500);
    expect((await call("bank_status")).links[0].status).toBe("attention");
  });

  it("flags a line in another currency instead of booking it as cents of this one", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [
      {
        ...line("E1", day(3), -500, "Shop"),
        transaction_amount: { amount: "5.00", currency: "USD" },
      },
    ];
    expect(await sync(giro)).toMatchObject({ status: "attention", added: 0, conflicts: 1 });
  });

  it("sets the starting balance of an account it created, so the balance is the bank's", async () => {
    erste.balances = [{ type: "CLBD", amount: "1000.00" }];
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [line("E1", day(3), -2500, "Shop")];
    await sync(giro);
    expect(await balance(giro!)).toBe(100000);
    const { links } = await call("bank_status");
    expect(links[0]).toMatchObject({
      bankBalance: 100000,
      bankBalanceType: "CLBD",
      bankBalanceBooked: true,
      cleared: 100000,
    });
  });

  it("does not touch the balance of an account that already holds transactions", async () => {
    erste.balances = [{ type: "CLBD", amount: "1000.00" }];
    fake.sessionAccounts = [erste];
    await call("begin_bank_link", { bank: "Erste Bank", country: "AT" });
    const connection = await call("complete_bank_link", { redirectUrl: "good-code" });
    const account = (await call("create_account", { name: "Giro", balance: 5000 })).id;
    await call("link_bank_account", {
      connection: connection.id,
      providerAccount: "erste-1",
      account,
    });
    await sync(account);
    expect(await balance(account)).toBe(5000);
  });
});

describe("what a person did stays done", () => {
  beforeEach(setUp);

  it("leaves out a deleted line until it is restored", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [line("E1", day(3), -500, "Shop")];
    await sync(giro);
    const [row] = await rows(giro!);
    await call("delete_transactions", { ids: [row.transactionId] });

    expect(await sync(giro)).toMatchObject({ added: 0, dismissed: 1 });
    expect(await rows(giro!)).toHaveLength(0);
    expect(await call("list_dismissed_imports", { account: giro })).toEqual([
      { importedId: "E1", date: day(3), amount: -500, payee: "Shop" },
    ]);

    expect(await call("restore_dismissed_imports", { account: giro, importedIds: ["E1"] })).toEqual(
      { restored: 1 },
    );
    expect(await rows(giro!), "back from the kept line, with no fetch").toHaveLength(1);
    expect(await sync(giro)).toMatchObject({ added: 0, unchanged: 1 });
    expect(await call("list_dismissed_imports", { account: giro })).toEqual([]);
  });

  it("leaves out a deleted line that has no id, and still takes a new one beside it", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [line(null, day(3), -500, "Shop")];
    await sync(giro);
    const [row] = await rows(giro!);
    await call("delete_transactions", { ids: [row.transactionId] });

    erste.lines = [line(null, day(3), -500, "Shop"), line(null, day(3), -500, "Bakery")];
    expect(await sync(giro)).toMatchObject({ added: 1, dismissed: 1 });
    const [bakery] = await rows(giro!);
    expect((await call("get_transaction", { id: bakery.transactionId })).payee).toBe("Bakery");
    const [dismissed] = await call("list_dismissed_imports", { account: giro });
    expect(dismissed).toMatchObject({ date: day(3), amount: -500, payee: "Shop" });
    expect(await sync(giro)).toMatchObject({ added: 0, dismissed: 1, unchanged: 1 });
  });

  it("leaves out one deleted line of two identical ones with no id", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [line(null, day(3), -500, "Shop"), line(null, day(3), -500, "Shop")];
    await sync(giro);
    const [first] = await rows(giro!);
    await call("delete_transactions", { ids: [first.transactionId] });

    expect(await sync(giro)).toMatchObject({ added: 0, dismissed: 1, unchanged: 1 });
    expect(await rows(giro!)).toHaveLength(1);
    expect(await balance(giro!)).toBe(-500);
  });

  it("leaves out what undo took back, and redo still brings it", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [line("E1", day(3), -500, "Shop")];
    await sync(giro);
    await call("undo");
    expect(await rows(giro!)).toHaveLength(0);

    expect(await sync(giro)).toMatchObject({ added: 0, dismissed: 1 });
    expect(await rows(giro!)).toHaveLength(0);
    expect(await call("redo")).toEqual({ done: true });
    expect(await rows(giro!)).toHaveLength(1);
    expect(await sync(giro)).toMatchObject({ added: 0, unchanged: 1 });
  });

  it("a fetch that changes nothing keeps what can be redone", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [line("E1", day(3), -500, "Shop")];
    await sync(giro);
    await call("create_transaction", { account: giro, date: day(1), amount: -1, payee: "Mine" });
    await call("undo");
    await sync(giro);
    expect(await call("redo")).toEqual({ done: true });
    expect(await rows(giro!)).toHaveLength(2);
  });

  it("keeps a person's category and payee on a line fetched again", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [line("E1", day(3), -500, "SHOP GMBH")];
    await sync(giro);
    const [row] = await rows(giro!);
    await call("update_transaction", { id: row.transactionId, payee: "My shop" });
    await sync(giro);
    const tx = await call("get_transaction", { id: row.transactionId });
    expect(tx.payee).toBe("My shop");
  });

  it("does not change a reconciled transaction", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [line("E1", day(3), -500, "Shop")];
    await sync(giro);
    await call("reconcile_account", { id: giro, balance: -500 });
    erste.lines = [line("E1", day(3), -500, "Renamed by the bank")];
    expect(await sync(giro)).toMatchObject({ added: 0 });
    const [row] = await rows(giro!);
    expect(row).toMatchObject({ reconciled: true, amount: -500, payee: "Shop" });
    expect(await balance(giro!)).toBe(-500);
  });

  it("matches a line to one entered by hand", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    await call("create_transaction", { account: giro, date: day(4), amount: -500, payee: "Mine" });
    erste.lines = [line("E1", day(3), -500, "Shop")];
    expect(await sync(giro)).toMatchObject({ added: 0, updated: 1 });
    expect(await rows(giro!)).toHaveLength(1);
  });
});

describe("what a review of the fetch found", () => {
  beforeEach(setUp);

  it("survives a bank repeating one id on two lines that both match", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    await call("create_transaction", { account: giro, date: day(3), amount: -1000, payee: "A" });
    await call("create_transaction", { account: giro, date: day(3), amount: -2000, payee: "B" });
    erste.lines = [line("SAME", day(3), -1000, "A"), line("SAME", day(3), -2000, "B")];
    const result = await sync(giro);
    expect(result, "a result for the account, not an error").toMatchObject({ updated: 2 });
    expect(await balance(giro!)).toBe(-3000);
    const again = await sync(giro);
    expect(again.added, "the repeat does not come in as a third line").toBe(0);
    expect(again.conflicts, "each line keeps its own id, so nothing conflicts").toBe(0);
    expect(await balance(giro!)).toBe(-3000);
  });

  it("reports a save that fails on the link, and lets the next fetch run", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [line("E1", day(3), -500, "Shop")];
    const file = new DatabaseSync(join(s.home, "books", `${book}.sqlite`));
    file.exec(
      "CREATE TRIGGER boom BEFORE INSERT ON postings BEGIN SELECT RAISE(ABORT, 'disk trouble'); END",
    );
    expect(await sync(giro), "the failure lands on the account's result").toMatchObject({
      status: "failed",
      added: 0,
    });
    file.exec("DROP TRIGGER boom");
    file.close();
    expect(await sync(giro), "no claim is left behind").toMatchObject({ status: "ok", added: 1 });
  });

  it("starts from a balance only when it counts booked money alone", async () => {
    erste.balances = [{ type: "ITAV", amount: "900.00" }];
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [line("E1", day(3), -500, "Shop")];
    await sync(giro);
    expect(await balance(giro!), "pending money must not become a starting balance").toBe(-500);
  });

  it("starts from what landed, not from what the bank sent", async () => {
    erste.balances = [{ type: "CLBD", amount: "1000.00" }];
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    await call("create_rule", {
      conditions: [{ field: "imported_payee", op: "contains", value: "Hold" }],
      actions: [{ op: "delete-transaction" }],
    });
    erste.lines = [line("E1", day(3), -2500, "Shop"), line("E2", day(3), -4000, "Card Hold")];
    await sync(giro);
    expect(await balance(giro!), "the bank's balance, with the deleted line left out").toBe(
      100_000,
    );
  });

  it("refuses to feed a second account from one bank account", async () => {
    await connect("Erste Bank", [erste], ["Giro"]);
    const { connections } = await call("bank_status");
    await expect(
      call("link_bank_account", {
        connection: connections[0].id,
        providerAccount: erste.uid,
        name: "Giro again",
      }),
    ).rejects.toThrow(/already feeds/);
    expect((await call("list_accounts")).map((each: any) => each.name)).toEqual(["Giro"]);
  });

  it("is not silenced by a transaction dated ahead", async () => {
    fake.sessionAccounts = [erste];
    const begun = await call("begin_bank_link", { bank: "Erste Bank", country: "AT" });
    const state = new URL(begun.url).searchParams.get("state");
    const connection = await call("complete_bank_link", {
      redirectUrl: `${REDIRECT}?code=good-code&state=${state}`,
    });
    const account = (await call("create_account", { name: "Giro", balance: 0 })).id;
    await call("create_transaction", {
      account,
      date: addDays(today(), 30),
      amount: -100,
      payee: "Next month's bill",
    });
    const link = await call("link_bank_account", {
      connection: connection.id,
      providerAccount: erste.uid,
      account,
    });
    expect(link.historyStart <= today()).toBe(true);
    erste.lines = [line("E1", today(), -500, "Shop")];
    expect(await sync(account)).toMatchObject({ added: 1 });
  });

  it("leaves what can be redone when a write changes nothing undoable", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    await call("create_transaction", { account: giro, date: day(1), amount: -700, payee: "Mine" });
    await call("undo");
    await call("restore_dismissed_imports", { account: giro, importedIds: ["none"] });
    await call("unlink_bank_account", { account: giro });
    expect((await call("redo")).done).toBe(true);
    expect(await balance(giro!)).toBe(-700);
  });
});

describe("transfers between two linked accounts", () => {
  beforeEach(setUp);

  it("counts a hand-entered transfer once when each bank's file names its side", async () => {
    const from = (await call("create_account", { name: "From", balance: 50_000 })).id;
    const to = (await call("create_account", { name: "To", balance: 0 })).id;
    await call("create_transaction", {
      account: from,
      date: day(5),
      amount: -20_000,
      transferAccount: to,
    });
    const importLine = (account: string, importedId: string, amount: number) =>
      call("import_transactions", {
        account,
        rows: [{ date: day(5), amount, payee: "Top up", importedId, cleared: true }],
      });
    await importLine(from, "file-out", -20_000);
    await importLine(to, "file-in", 20_000);

    expect(await balance(to), "the old importer gave 400.00 here").toBe(20_000);
    expect(await balance(from)).toBe(30_000);
    await importLine(to, "file-in", 20_000);
    expect(await balance(to), "fetching the same line again changes nothing").toBe(20_000);
  });

  const pair = async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    const [main] = await connect("Revolut", [revolut], ["Main"]);
    erste.lines = [line("E1", day(3), -10000, "Revolut Bank")];
    revolut.lines = [line("R1", day(2), 10000, "Top-up from Erste")];
    return { giro: giro!, main: main! };
  };

  it("takes both banks' lines into a transfer entered by hand", async () => {
    const { giro, main } = await pair();
    const transfer = await call("create_transaction", {
      account: giro,
      date: day(3),
      amount: -10000,
      transferAccount: main,
    });
    expect(await sync(giro)).toMatchObject({ added: 0, updated: 1 });
    expect(await sync(main)).toMatchObject({ added: 0, updated: 1 });
    expect(await balance(giro)).toBe(-10000);
    expect(await balance(main)).toBe(10000);

    const tx = await call("get_transaction", { id: transfer.id });
    const ids = Object.fromEntries(
      tx.postings.map((each: any) => [each.accountId, each.importedId]),
    );
    expect(ids).toEqual({ [giro]: "E1", [main]: "R1" });

    expect(await sync(giro)).toMatchObject({ added: 0, updated: 0, unchanged: 1 });
    expect(await sync(main)).toMatchObject({ added: 0, updated: 0, unchanged: 1 });
    expect(await balance(main)).toBe(10000);
  });

  for (const order of ["giro first", "revolut first"] as const)
    it(`a rule makes one transfer of both lines, ${order}`, async () => {
      const { giro, main } = await pair();
      await call("create_rule", {
        conditions: [{ field: "imported_payee", op: "contains", value: "Revolut" }],
        actions: [{ op: "set", field: "transfer_account", value: main }],
      });
      const sequence = order === "giro first" ? [giro, main] : [main, giro];
      for (const account of sequence) await sync(account);
      for (const account of sequence) expect(await sync(account)).toMatchObject({ added: 0 });

      expect(await balance(giro)).toBe(-10000);
      expect(await balance(main)).toBe(10000);
      const [row] = await rows(giro);
      expect(row.counterpart).toMatchObject({ kind: "transfer" });
      expect(await rows(main)).toHaveLength(1);
      const tx = await call("get_transaction", { id: row.transactionId });
      expect(tx.postings.map((each: any) => each.importedId).sort()).toEqual(["E1", "R1"]);
    });

  it("make_transfer joins two lines that came in apart, and undo parts them again", async () => {
    const { giro, main } = await pair();
    await sync(giro);
    await sync(main);
    expect(await balance(main)).toBe(10000);
    const [from] = await rows(giro);
    const [to] = await rows(main);
    const made = await call("make_transfer", { from: from.transactionId, to: to.transactionId });
    expect(made.postings.map((each: any) => each.importedId).sort()).toEqual(["E1", "R1"]);
    expect(await sync(giro)).toMatchObject({ added: 0, unchanged: 1 });
    expect(await sync(main)).toMatchObject({ added: 0, unchanged: 1 });
    expect(await balance(giro)).toBe(-10000);
    expect(await balance(main)).toBe(10000);

    await call("undo");
    expect(await rows(giro)).toHaveLength(1);
    expect(await rows(main)).toHaveLength(1);
    const [back] = await rows(main);
    expect(back.transactionId).toBe(to.transactionId);
    expect(await sync(main)).toMatchObject({ added: 0 });
  });

  it("deleting the transfer leaves both lines out", async () => {
    const { giro, main } = await pair();
    await sync(giro);
    await sync(main);
    const [from] = await rows(giro);
    const [to] = await rows(main);
    const made = await call("make_transfer", { from: from.transactionId, to: to.transactionId });
    await call("delete_transactions", { ids: [made.id] });
    expect(await sync(giro)).toMatchObject({ added: 0, dismissed: 1 });
    expect(await sync(main)).toMatchObject({ added: 0, dismissed: 1 });
  });
});

describe("what a bank refuses", () => {
  beforeEach(setUp);

  it("allows 4 fetches a day unless forced", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    for (let fetch = 0; fetch < 4; fetch++) expect((await sync(giro)).status).toBe("ok");
    const before = fake.requests.length;
    const fifth = await sync(giro);
    expect(fifth.status).toBe("rate_limited");
    expect(fake.requests.length).toBe(before);
    expect((await sync(giro, { force: true })).status).toBe("ok");
    expect((await call("bank_status")).links[0].fetchesToday).toBe(5);
  });

  it("waits 6 hours after the bank's rate limit, and does not ask for a new consent", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    fake.failure = {
      status: 429,
      body: { error: "ASPSP_RATE_LIMIT_EXCEEDED", message: "Slow down" },
    };
    expect(await sync(giro)).toMatchObject({ status: "rate_limited", added: 0 });
    fake.failure = null;
    const before = fake.requests.length;
    expect((await sync(giro)).status).toBe("rate_limited");
    expect(fake.requests.length).toBe(before);
    const { links, connections } = await call("bank_status");
    expect(Date.parse(links[0].retryAfter) - Date.now()).toBeGreaterThan(5.9 * 3600_000);
    expect(connections[0].status).toBe("active");
  });

  it("asks for a new consent when the session ends early", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    fake.failure = { status: 401, body: { error: "EXPIRED_SESSION", message: "Session expired" } };
    expect(await sync(giro)).toMatchObject({ status: "reauth_required" });
    expect((await call("bank_status")).connections[0].status).toBe("expired");
    fake.failure = null;
    const before = fake.requests.length;
    expect((await sync(giro)).status).toBe("reauth_required");
    expect(fake.requests.length).toBe(before);
  });

  it("asks for a new consent once its end has passed, without a fetch", async () => {
    fake.validUntil = new Date(Date.now() - 1000).toISOString();
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    expect((await call("bank_status")).connections[0].status).toBe("expired");
    const before = fake.requests.length;
    expect((await sync(giro)).status).toBe("reauth_required");
    expect(fake.requests.length).toBe(before);
  });

  it("reports an account's failure in its result and goes on to the next", async () => {
    const [giro, main] = await connect("Erste Bank", [erste, revolut], ["Giro", "Main"]);
    fake.accounts.delete("erste-1");
    revolut.lines = [line("R1", day(2), 100, "Someone")];
    const results = await call("sync_bank_accounts");
    expect(results.find((each: any) => each.account === giro)).toMatchObject({ status: "failed" });
    expect(results.find((each: any) => each.account === main)).toMatchObject({
      status: "ok",
      added: 1,
    });
  });

  it("lets no response body or token into what a failure says", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    fake.failure = { status: 500, body: { detail: "Bearer abc.def.ghi", key: TEST_KEY } };
    const result = await sync(giro);
    expect(result.status).toBe("failed");
    expect(JSON.stringify(result)).not.toContain("Bearer");
    expect(JSON.stringify(await call("bank_status"))).not.toContain("Bearer");
  });

  it("a key that went missing is a status, not a crash", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    await s.call("remove_bank_credentials");
    expect(await sync(giro)).toMatchObject({ status: "failed" });
  });
});

describe("fetching by itself", () => {
  beforeEach(setUp);

  /** One pass over this home, as the server's timer runs it, at a given time. */
  const pass = async (at: number) => {
    const runtime = ManagedRuntime.make(Books.layer({ home: s.home }));
    await runtime.runPromise(syncDueBankAccounts(at));
    await runtime.dispose();
  };
  const fetches = () => fake.requests.filter((each) => each.path.includes("/transactions")).length;

  it("rests after a failure, so an outage does not use up the day's fetches", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    await call("update_book", { bankAutoSync: true });
    fake.failure = { status: 500, body: { error: "OUTAGE", message: "Down" } };
    const start = Date.now();
    await pass(start);
    const after = fetches();
    expect(after).toBe(1);
    await pass(start + 15 * 60_000);
    await pass(start + 60 * 60_000);
    expect(fetches(), "no retry within 6 hours").toBe(after);
    fake.failure = null;
    expect(await sync(giro), "a person can still fetch").toMatchObject({ status: "ok" });
  });

  it("does nothing unless the book asks for it", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [line("E1", day(3), -500, "Shop")];
    await pass(Date.now());
    expect(fetches()).toBe(0);
    expect(await rows(giro!)).toHaveLength(0);
  });

  it("fetches what is due, then waits 6 hours", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    await call("update_book", { bankAutoSync: true });
    erste.lines = [line("E1", day(3), -500, "Shop")];
    await pass(Date.now());
    expect(fetches()).toBe(1);
    expect(await rows(giro!)).toHaveLength(1);

    await pass(Date.now() + 5 * 3600_000);
    expect(fetches()).toBe(1);
    await pass(Date.now() + 6 * 3600_000);
    expect(fetches()).toBe(2);
  });

  it("leaves an ended consent alone", async () => {
    await connect("Erste Bank", [erste], ["Giro"]);
    await call("update_book", { bankAutoSync: true });
    fake.failure = { status: 401, body: { error: "EXPIRED_SESSION", message: "Ended" } };
    await pass(Date.now());
    const before = fetches();
    await pass(Date.now() + 7 * 3600_000);
    expect(fetches()).toBe(before);
  });
});

/** The lines an account keeps beside their ids, read from the book's file: no operation returns them yet. */
const keptLines = (account: string, id: string = book) => {
  const file = new DatabaseSync(join(s.home, "books", `${id}.sqlite`));
  try {
    const found = file
      .prepare("SELECT imported_id, line FROM seen_imports WHERE account_id = ?")
      .all(account) as Array<{ imported_id: string; line: string | null }>;
    return Object.fromEntries(
      found.map((row) => [row.imported_id, row.line === null ? null : JSON.parse(row.line)]),
    );
  } finally {
    file.close();
  }
};

const forgetLines = () => {
  const file = new DatabaseSync(join(s.home, "books", `${book}.sqlite`));
  file.exec("UPDATE seen_imports SET line = NULL");
  file.close();
};

const asSent = (sent: unknown) => JSON.parse(JSON.stringify(sent));

describe("the line the bank sent", () => {
  beforeEach(setUp);

  const sent = line("E1", day(3), -1150, "Tabak Trafik", {
    value_date: day(4),
    creditor_account: { iban: "AT483200000012345864" },
    debtor_account: { iban: "AT001" },
    merchant_category_code: "5993",
    bank_transaction_code: { code: "CCRD", sub_code: "POSD" },
    a_field_no_one_knows: { nested: [1, "two", null] },
    remittance_information: ["TABAK TRAFIK 2362  K2   03.11. 09:45"],
  });

  it("keeps every field as it arrived, IBANs and fields reeve does not read included", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [sent];
    await sync(giro);
    expect(keptLines(giro!)).toEqual({
      E1: {
        source: "bank",
        bank: { name: "Erste Bank", country: "AT" },
        currency: "EUR",
        line: asSent(sent),
      },
    });
    const [row] = await rows(giro!);
    const tx = await call("get_transaction", { id: row.transactionId });
    expect(JSON.stringify(tx), "the transaction carries none of it").not.toContain("AT4832");
    expect(JSON.stringify(await rows(giro!))).not.toContain("AT4832");
  });

  it("writes a line once: a later fetch, or a conflict, leaves the first", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [sent];
    await sync(giro);
    erste.lines = [{ ...sent, remittance_information: ["CHANGED BY THE BANK"] }];
    await sync(giro);
    erste.lines = [line("E1", day(3), -9999, "Tabak Trafik")];
    expect(await sync(giro)).toMatchObject({ conflicts: 1 });
    expect(keptLines(giro!)["E1"].line).toEqual(asSent(sent));
  });

  it("fills a line taken before lines were kept, held or deleted, on the next fetch", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [sent, line("E2", day(2), -500, "Shop")];
    await sync(giro);
    const shop = (await rows(giro!)).find((row) => row.amount === -500);
    await call("delete_transactions", { ids: [shop.transactionId] });
    forgetLines();
    expect(await sync(giro), "a fetch that adds nothing").toMatchObject({
      added: 0,
      unchanged: 1,
      dismissed: 1,
    });
    const kept = keptLines(giro!);
    expect(kept["E1"].line).toEqual(asSent(sent));
    expect(kept["E2"].line).toEqual(asSent(erste.lines[1]));
  });

  it("keeps the line through undo of the fetch, and redo finds the same one", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [sent];
    await sync(giro);
    await call("undo");
    expect(await rows(giro!)).toHaveLength(0);
    expect(keptLines(giro!)["E1"].line).toEqual(asSent(sent));
    await call("redo");
    expect(keptLines(giro!)["E1"].line).toEqual(asSent(sent));
  });

  it("follows the bank's id into a merge with a transaction entered by hand", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [sent];
    await sync(giro);
    const [fetched] = await rows(giro!);
    const mine = await call("create_transaction", {
      account: giro,
      date: day(9),
      amount: -1150,
      payee: "Mine",
    });
    const merged = await call("merge_transactions", { keep: mine.id, drop: fetched.transactionId });
    expect(merged.postings.find((each: any) => each.accountId === giro).importedId).toBe("E1");
    expect(await call("list_dismissed_imports", { account: giro })).toEqual([]);
    expect(keptLines(giro!)["E1"].line).toEqual(asSent(sent));
  });

  it("keeps each bank's line on its own side of a transfer", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    const [main] = await connect("Revolut", [revolut], ["Main"]);
    erste.lines = [
      line("E1", day(3), -10000, "Revolut Bank", { creditor_account: { iban: "LT1" } }),
    ];
    revolut.lines = [
      line("R1", day(2), 10000, "Top-up from Erste", { debtor_account: { iban: "AT001" } }),
    ];
    await call("create_rule", {
      conditions: [{ field: "imported_payee", op: "contains", value: "Revolut" }],
      actions: [{ op: "set", field: "transfer_account", value: main }],
    });
    await sync(giro);
    await sync(main);
    const [row] = await rows(giro!);
    expect(row.counterpart).toMatchObject({ kind: "transfer" });
    expect(keptLines(giro!)["E1"]).toMatchObject({
      bank: { name: "Erste Bank" },
      line: asSent(erste.lines[0]),
    });
    expect(keptLines(main!)["R1"]).toMatchObject({
      bank: { name: "Revolut" },
      line: asSent(revolut.lines[0]),
    });
  });

  it("brings a deleted line back from what was kept, and undo leaves it out again", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [sent];
    await sync(giro);
    const [first] = await rows(giro!);
    await call("delete_transactions", { ids: [first.transactionId] });
    erste.lines = [];

    await call("restore_dismissed_imports", { account: giro, importedIds: ["E1"] });
    const [back] = await rows(giro!);
    expect(back).toMatchObject({ amount: -1150, date: day(3), payee: "Tabak Trafik" });
    expect(keptLines(giro!)["E1"].line).toEqual(asSent(sent));
    expect(await call("list_dismissed_imports", { account: giro })).toEqual([]);

    await call("undo");
    expect(await rows(giro!)).toHaveLength(0);
    expect(await call("list_dismissed_imports", { account: giro })).toHaveLength(1);
    expect(keptLines(giro!)["E1"].line).toEqual(asSent(sent));
  });

  it("lets a deleted line kept without its text back for the next fetch", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [sent];
    await sync(giro);
    const [first] = await rows(giro!);
    await call("delete_transactions", { ids: [first.transactionId] });
    forgetLines();
    expect(await call("restore_dismissed_imports", { account: giro, importedIds: ["E1"] })).toEqual(
      { restored: 1 },
    );
    expect(await rows(giro!)).toHaveLength(0);
    expect(await sync(giro)).toMatchObject({ added: 1 });
    expect(keptLines(giro!)["E1"].line).toEqual(asSent(sent));
  });

  it("puts no bank text in what a failure says", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [
      sent,
      { ...line("E2", day(2), -500, "SECRET SHOP"), transaction_amount: "not an amount" } as never,
    ];
    const result = await sync(giro);
    expect(result).toMatchObject({ status: "failed", added: 0 });
    for (const text of ["SECRET", "TABAK", "AT4832", "not an amount"])
      expect(JSON.stringify(result)).not.toContain(text);
    expect(JSON.stringify(await call("bank_status"))).not.toContain("SECRET");
  });
});

describe("backups", () => {
  beforeEach(setUp);

  it("a restored book keeps what it has seen and no bank link", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [line("E1", day(3), -500, "Shop")];
    await sync(giro);
    const path = join(s.home, "backup.sqlite");
    await call("export_book", { path });
    const restored = await s.call("restore_book", { path, name: "Copy" });
    const id = restored.id;
    expect(await s.call("bank_status", { book: id })).toMatchObject({ connections: [], links: [] });
    const page = await s.call("list_transactions", { book: id, account: giro });
    const tx = await s.call("get_transaction", { book: id, id: page.rows[0].transactionId });
    expect(tx.postings.find((each: any) => each.accountId === giro).importedId).toBe("E1");
    expect(keptLines(giro!, id)["E1"].line).toEqual(asSent(erste.lines[0]));
  });
});

describe("rules on the counterparty's account", () => {
  beforeEach(setUp);

  const rent = (id: string, back: number) =>
    line(id, day(back), -90000, "Hausverwaltung", {
      creditor_account: { iban: "AT61 1904 3002 3457 3201" },
      debtor_account: { iban: "AT001" },
    });

  const landlordRule = async (actions: ReadonlyArray<unknown>) =>
    call("create_rule", {
      conditions: [{ field: "counterparty_account", op: "is", value: "at61 1904 3002 3457 3201" }],
      actions,
    });

  it("sets the payee and category of a fetched line from the account it went to", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    const group = await call("create_category_group", { name: "Living" });
    const housing = (await call("create_category", { name: "Rent", groupId: group.id })).id;
    const landlord = (await call("create_payee", { name: "Landlord" })).id;
    await landlordRule([
      { op: "set", field: "payee", value: landlord },
      { op: "set", field: "category", value: housing },
    ]);
    erste.lines = [
      rent("E1", 5),
      line("E2", day(4), 2500, "Refund", {
        creditor_account: { iban: "AT611904300234573201" },
        debtor_account: { iban: "AT999" },
      }),
      line("E3", day(3), -1150, "Card", {
        creditor_account: { other: { identification: "2099 0000 0000 0000" } },
      }),
    ];
    await sync(giro);
    const byAmount = new Map((await rows(giro!)).map((row) => [row.amount, row]));
    expect(byAmount.get(-90000), "money out reads the creditor's account").toMatchObject({
      payee: "Landlord",
      counterpart: { kind: "category", id: housing },
    });
    expect(byAmount.get(2500)?.payee, "money in reads the debtor's account").toBe("Refund");
    const card = await call("preview_rule", {
      conditions: [{ field: "counterparty_account", op: "is", value: "2099000000000000" }],
    });
    expect(card.total, "a BBAN in other.identification is the account").toBe(1);
  });

  it("applies to lines already fetched, through apply_rules and preview_rule", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [rent("E1", 5), rent("E2", 35)];
    await sync(giro);
    await call("create_transaction", {
      account: giro,
      date: day(2),
      amount: -90000,
      payee: "Hausverwaltung",
    });
    const landlord = (await call("create_payee", { name: "Landlord" })).id;
    const rule = await landlordRule([{ op: "set", field: "payee", value: landlord }]);
    expect((await call("preview_rule", { rule: rule.id })).total).toBe(2);
    const applied = await call("apply_rules", { rule: rule.id });
    expect(applied.updated).toHaveLength(2);
    const listed = await rows(giro!);
    expect(listed.filter((row) => row.payee === "Landlord")).toHaveLength(2);
    expect(
      listed.filter((row) => row.payee === "Hausverwaltung"),
      "the one entered by hand has no bank line",
    ).toHaveLength(1);
    await call("update_rule", {
      id: rule.id,
      actions: [{ op: "set", field: "notes", value: "rent" }],
    });
    await call("apply_rules", { ids: listed.map((row) => row.transactionId) });
    const notes = await Promise.all(
      listed.map(
        async (row) => (await call("get_transaction", { id: row.transactionId })).notes as string,
      ),
    );
    expect(
      notes.filter((each) => each === "rent"),
      "every rule, by ids",
    ).toHaveLength(2);
  });

  it("never matches a transaction without a bank line, even with a negative operator", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [rent("E1", 5)];
    await sync(giro);
    await call("create_transaction", { account: giro, date: day(2), amount: -500, payee: "Cash" });
    for (const op of ["isNot", "doesNotContain", "notOneOf"]) {
      const value = op === "notOneOf" ? ["AT000"] : "AT000";
      const preview = await call("preview_rule", {
        conditions: [{ field: "counterparty_account", op, value }],
      });
      expect(
        preview.rows.map((row: any) => row.payee),
        `${op} leaves out Cash`,
      ).toEqual(["Hausverwaltung"]);
    }
  });

  it("makes a line to one of the person's own accounts a transfer", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    const [main] = await connect("Revolut", [revolut], ["Main"]);
    await call("create_rule", {
      conditions: [{ field: "counterparty_account", op: "is", value: "LT12 3456" }],
      actions: [{ op: "set", field: "transfer_account", value: main }],
    });
    erste.lines = [
      line("E1", day(3), -10000, "Top-up", { creditor_account: { iban: "LT123456" } }),
    ];
    await sync(giro);
    const [row] = await rows(giro!);
    expect(row.counterpart).toMatchObject({ kind: "transfer", id: main });
    const ruled = await call("run_rules", {
      account: giro,
      date: day(1),
      amount: -500,
      counterpartyAccount: "lt12 3456",
    });
    expect(ruled.transferAccount, "run_rules takes the account number").toBe(main);
    const unknown = await call("run_rules", { account: giro, date: day(1), amount: -500 });
    expect(unknown.transferAccount, "and without one, no rule on it holds").toBeNull();
  });
});

describe("rules suggested from account numbers", () => {
  beforeEach(setUp);

  const to = (iban: string) => ({ creditor_account: { iban } });
  const suggestions = async () => (await call("suggest_account_rules")).suggestions as Array<any>;

  it("offers a payee rule for an account whose lines all land on one payee", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [
      line("E1", day(40), -90000, "Hausverwaltung", to("AT61 1904")),
      line("E2", day(10), -90000, "Hausverwaltung", to("AT611904")),
      line("C1", day(9), -1150, "Tabak Trafik", {
        creditor_account: { other: { identification: "2099000000000000" } },
      }),
      line("C2", day(8), -2000, "Billa", {
        creditor_account: { other: { identification: "2099000000000000" } },
      }),
      line("K1", day(7), -3000, "Klarna Zalando", to("DE00KLARNA")),
      line("K2", day(6), -4000, "Klarna Ikea", to("DE00KLARNA")),
      line("O1", day(5), -500, "Once", to("AT00ONCE")),
    ];
    await sync(giro);
    const [only, ...rest] = await suggestions();
    expect(rest, "card clearing, a processor and a single line are left out").toEqual([]);
    expect(only).toMatchObject({
      kind: "payee",
      accountNumber: "AT611904",
      lines: 2,
      payee: { name: "Hausverwaltung" },
    });

    const accepted = await call("accept_account_suggestion", { accountNumber: "at61 1904" });
    expect(accepted.rule).toMatchObject({
      stage: "pre",
      conditions: [{ field: "counterparty_account", op: "is", value: "AT611904" }],
    });
    expect(await suggestions(), "a rule now covers it").toEqual([]);

    erste.lines.push(line("E3", day(1), -90000, "HV Immobilien GmbH", to("AT611904")));
    await sync(giro, { force: true });
    const latest = (await rows(giro!)).find((row) => row.amount === -90000 && row.date === day(1));
    expect(latest.payee, "a reworded line lands on the payee").toBe("Hausverwaltung");
    await s.fails("accept_account_suggestion", { accountNumber: "AT611904" });
  });

  it("offers to make lines to the person's own account transfers, joining both banks' copies", async () => {
    const ownRevolut: FakeAccount = { ...revolut, iban: "LT12 3456", lines: [] };
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    const [main] = await connect("Revolut", [ownRevolut], ["Main"]);
    erste.lines = [line("E1", day(3), -10000, "Revolut", to("LT123456"))];
    ownRevolut.lines = [line("R1", day(2), 10000, "Top-up", { debtor_account: { iban: "AT001" } })];
    await sync(giro);
    await sync(main);
    expect(await suggestions()).toEqual([
      { kind: "transfer", accountNumber: "AT001", lines: 1, account: { id: giro, name: "Giro" } },
      {
        kind: "transfer",
        accountNumber: "LT123456",
        lines: 1,
        account: { id: main, name: "Main" },
      },
    ]);

    const accepted = await call("accept_account_suggestion", { accountNumber: "LT123456" });
    expect(accepted.transfers).toHaveLength(1);
    const [row] = await rows(giro!);
    expect(row.counterpart).toMatchObject({ kind: "transfer", id: main });
    expect(await rows(main!), "the Revolut copy joined the transfer").toHaveLength(1);
    expect(await balance(main!)).toBe(10000);
    expect(await suggestions(), "the other side is a transfer now too").toEqual([]);

    await call("undo");
    expect(await rows(main!), "one undo step").toHaveLength(1);
    expect((await rows(giro!))[0].counterpart.kind).not.toBe("transfer");
  });

  it("dismissing an account number keeps it from coming back", async () => {
    const [giro] = await connect("Erste Bank", [erste], ["Giro"]);
    erste.lines = [
      line("E1", day(40), -90000, "Hausverwaltung", to("AT611904")),
      line("E2", day(10), -90000, "Hausverwaltung", to("AT611904")),
    ];
    await sync(giro);
    expect(await suggestions()).toHaveLength(1);
    await call("dismiss_account_suggestion", { accountNumber: "AT61 1904" });
    await call("dismiss_account_suggestion", { accountNumber: "AT611904" });
    expect(await suggestions()).toEqual([]);
  });
});
