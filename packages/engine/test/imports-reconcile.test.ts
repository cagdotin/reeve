import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compareFuzzyMatchCandidates } from "../src/imports/reconcile.ts";
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
let book: string;
let account: string;
beforeEach(async () => {
  s = scratch();
  book = (await s.call("create_book", { name: "Test" })).id;
  account = (await s.call("create_account", { book, name: "Checking" })).id;
});
afterEach(() => s.dispose());

const reconcile = (rows: Array<Record<string, unknown>>, options: Record<string, unknown> = {}) =>
  s.call("import_transactions", { book, account, rows, ...options });

const payees = async () => (await s.call("list_payees", { book })).map((p: any) => p.name);

const transactions = async () => {
  const page = await s.call("list_transactions", { book, account });
  return Promise.all(
    page.rows.map(async (row: any) => {
      const tx = await s.call("get_transaction", { book, id: row.transactionId });
      return {
        ...tx,
        importedId: tx.postings.find((posting: any) => posting.accountId === account).importedId,
        amount: row.amount,
        cleared: row.cleared,
        counterpart: row.counterpart,
      };
    }),
  );
};

const enter = async (fields: Record<string, unknown>) =>
  (await s.call("create_transaction", { book, account, ...fields })).id as string;

describe("reconciling imports", () => {
  it("creates payees, title-cased", async () => {
    const result = await reconcile([
      { date: "2020-01-02", payee: "bakkerij", amount: 4133 },
      { date: "2020-01-03", payee: "kroger", amount: 5000 },
    ]);
    expect(result.added).toHaveLength(2);
    expect((await payees()).toSorted()).toEqual(["Bakkerij", "Kroger"]);
    const all = await transactions();
    expect(all.find((tx: any) => tx.amount === 4133).payee).toBe("Bakkerij");
    expect(all.find((tx: any) => tx.amount === 5000).payee).toBe("Kroger");
  });

  it("title-cases the payee and the imported payee by default", async () => {
    await reconcile([{ date: "2020-01-02", payee: "Nintendo Store New York NY", amount: 4133 }]);
    expect(await payees()).toEqual(["Nintendo Store New York Ny"]);
    expect((await transactions())[0].importedPayee).toBe("Nintendo Store New York Ny");
  });

  it("keeps the payee name, trimmed, without title case", async () => {
    await reconcile(
      [{ date: "2020-01-02", payee: "  Nintendo Store New York NY  ", amount: 4133 }],
      {
        titleCasePayees: false,
      },
    );
    expect(await payees()).toEqual(["Nintendo Store New York NY"]);
    expect((await transactions())[0].importedPayee).toBe("Nintendo Store New York NY");
  });

  it("handles rows without a payee", async () => {
    await enter({ date: "2020-01-01", amount: 2948 });
    const result = await reconcile([
      { date: "2020-01-02", amount: 0 },
      { date: "2020-01-01", amount: 2948 },
    ]);
    expect(result.added).toHaveLength(1);
    expect(result.updated).toHaveLength(1);
    expect(await transactions()).toHaveLength(2);
    expect(await payees()).toEqual([]);
  });

  it("does not create blank payees", async () => {
    await reconcile([{ date: "2020-01-02", payee: "     ", amount: 4133 }]);
    const [tx] = await transactions();
    expect(tx.payee).toBe(null);
    expect(tx.amount).toBe(4133);
    expect(tx.date).toBe("2020-01-02");
    expect(await payees()).toEqual([]);
  });

  it("prefers a candidate with the same payee over a closer one", async () => {
    const one = await enter({ date: "2017-10-15", amount: -2947, payee: "Bakkerij" });
    await enter({ date: "2017-10-17", amount: -2947 });
    const result = await reconcile([
      { date: "2017-10-17", payee: "bakkerij", amount: -2947, importedId: "imported1" },
    ]);
    expect(result.updated).toEqual([one]);
    const all = await transactions();
    expect(all).toHaveLength(2);
    expect(all.find((tx: any) => tx.id === one).importedId).toBe("imported1");
  });

  it("adds every row without reconcile, keeping payee names", async () => {
    const rows = [
      { date: "2017-10-17", payee: "BAKKerij", amount: -2947 },
      { date: "2017-10-18", payee: "bakkERIj2", amount: -2947 },
      { date: "2017-10-19", payee: "bakkerij3", amount: -2947 },
      { date: "2017-10-20", payee: "BakkeriJ3", amount: -2947 },
    ];
    const result = await reconcile(rows, { reconcile: false });
    expect(result.added).toHaveLength(4);
    expect((await payees()).toSorted()).toEqual(["BAKKerij", "bakkERIj2", "bakkerij3"]);
    expect((await transactions()).map((tx: any) => tx.payee)).toEqual([
      "bakkerij3",
      "bakkerij3",
      "bakkERIj2",
      "BAKKerij",
    ]);
  });

  it("lets a skipped row take its match without importing it", async () => {
    await reconcile([{ date: "2024-04-05", amount: -899, payee: "Netflix" }]);
    const result = await reconcile([
      { date: "2024-04-05", amount: -899, payee: "Netflix", notes: "Subscription", skip: true },
      { date: "2024-04-03", amount: -899, payee: "Corner Coffee" },
    ]);
    expect(result.added).toHaveLength(1);
    expect(result.updated).toHaveLength(0);
    expect((await transactions()).map((tx: any) => [tx.date, tx.payee, tx.notes])).toEqual([
      ["2024-04-05", "Netflix", null],
      ["2024-04-03", "Corner Coffee", null],
    ]);
  });

  it("does not merge transactions with different imported ids", async () => {
    const row = {
      amount: -1239,
      importedPayee: "Acme Inc.",
      payee: "Acme Inc.",
      notes: "TEST TRANSACTION",
      cleared: true,
    };
    await reconcile([{ ...row, date: "2024-04-05", importedId: "b85cdd57" }]);
    await reconcile([{ ...row, date: "2024-04-06", importedId: "ca1589b2" }]);
    expect(await payees()).toHaveLength(1);
    const all = await transactions();
    expect(all.map((tx: any) => [tx.importedId, tx.amount])).toEqual([
      ["ca1589b2", -1239],
      ["b85cdd57", -1239],
    ]);
  });

  it("matches by imported id first and updates the match", async () => {
    await reconcile([
      { date: "2024-01-10", amount: -500, payee: "Shop", importedId: "fit1", cleared: false },
    ]);
    const result = await reconcile([
      {
        date: "2024-01-30",
        amount: -999,
        payee: "Other",
        importedId: "fit1",
        notes: "late",
        cleared: true,
      },
    ]);
    expect(result.added).toEqual([]);
    expect(result.updated).toHaveLength(1);
    const [tx] = await transactions();
    expect(tx).toMatchObject({ payee: "Shop", notes: "late", cleared: true, amount: -500 });
  });

  it("leaves a duplicate with nothing new as it is", async () => {
    const rows = [
      { date: "2024-01-10", amount: -500, payee: "Shop", importedId: "fit1" },
      { date: "2024-01-11", amount: -700, payee: "Cafe" },
    ];
    const first = await reconcile(rows);
    const again = await reconcile(rows);
    expect(again.added).toEqual([]);
    expect(again.updated).toEqual([]);
    expect(again.skipped.toSorted()).toEqual(first.added.toSorted());
    expect(again.rows.map((row: any) => row.status)).toEqual(["duplicate", "duplicate"]);
    expect(await transactions()).toHaveLength(2);
  });

  it("matches within seven days only", async () => {
    await enter({ date: "2024-01-01", amount: -500 });
    const result = await reconcile([
      { date: "2024-01-08", amount: -500 },
      { date: "2024-01-09", amount: -500 },
    ]);
    expect(result.rows.map((row: any) => row.status)).toEqual(["update", "new"]);
  });

  it("fills an entered transaction's missing payee, notes and category, and clears it", async () => {
    const groups = await s.call("list_categories", { book });
    const food = groups[0].categories.find((c: any) => c.name === "Food");
    const id = await enter({ date: "2024-02-01", amount: -1234 });
    const result = await reconcile([
      {
        date: "2024-02-02",
        amount: -1234,
        payee: "grocer",
        notes: "weekly",
        category: food.id,
        importedId: "x1",
      },
    ]);
    expect(result.updated).toEqual([id]);
    const [tx] = await transactions();
    expect(tx).toMatchObject({
      id,
      payee: "Grocer",
      notes: "weekly",
      importedId: "x1",
      importedPayee: "Grocer",
      cleared: true,
      counterpart: { kind: "category", id: food.id },
    });
  });

  it("keeps what the existing transaction has", async () => {
    const groups = await s.call("list_categories", { book });
    const food = groups[0].categories.find((c: any) => c.name === "Food");
    const bills = groups[0].categories.find((c: any) => c.name === "Bills");
    await enter({
      date: "2024-02-01",
      amount: -1234,
      payee: "Mine",
      notes: "kept",
      category: bills.id,
    });
    await reconcile([
      { date: "2024-02-01", amount: -1234, payee: "Theirs", notes: "dropped", category: food.id },
    ]);
    const [tx] = await transactions();
    expect(tx).toMatchObject({ payee: "Mine", notes: "kept", counterpart: { id: bills.id } });
  });

  it("does not update a reconciled transaction", async () => {
    const id = await enter({ date: "2024-02-01", amount: -1234, cleared: true });
    await s.call("reconcile_account", { book, id: account, balance: -1234 });
    expect((await s.call("get_transaction", { book, id })).postings[0].reconciled).toBe(true);
    const result = await reconcile([{ date: "2024-02-01", amount: -1234, notes: "new" }]);
    expect(result.rows[0]).toMatchObject({ status: "duplicate", transactionId: id });
    expect((await s.call("get_transaction", { book, id })).notes).toBe(null);
  });

  it("adds a matched row when forced to", async () => {
    await enter({ date: "2024-02-01", amount: -1234 });
    const result = await reconcile([{ date: "2024-02-01", amount: -1234, forceAdd: true }]);
    expect(result.added).toHaveLength(1);
    expect(await transactions()).toHaveLength(2);
  });

  it("changes nothing in a dry run", async () => {
    const id = await enter({ date: "2024-02-01", amount: -1234 });
    const result = await reconcile(
      [
        { date: "2024-02-01", amount: -1234, notes: "x" },
        { date: "2024-02-05", amount: -1, payee: "New Payee" },
      ],
      { dryRun: true },
    );
    expect(result).toMatchObject({ dryRun: true, added: [], updated: [id] });
    expect(result.rows).toEqual([
      { index: 0, status: "update", transactionId: id },
      { index: 1, status: "new", transactionId: null },
    ]);
    expect(await transactions()).toHaveLength(1);
    expect(await payees()).toEqual([]);
  });

  it("is one undo step", async () => {
    await reconcile([
      { date: "2024-02-01", amount: -1 },
      { date: "2024-02-02", amount: -2 },
    ]);
    await s.call("undo", { book });
    expect(await transactions()).toHaveLength(0);
  });

  it("marks duplicates in a file preview and imports from the file", async () => {
    const content = ["Date,Payee,Amount", "2024-03-01,Grocer,-42.50", "2024-03-02,Cafe,-3.00"].join(
      "\n",
    );
    await enter({ date: "2024-03-01", amount: -4250, payee: "Grocer" });
    const preview = await s.call("preview_import", { book, account, content, fileType: "csv" });
    expect(preview.rows.map((row: any) => [row.payee, row.status, row.match !== null])).toEqual([
      ["Cafe", "new", false],
      ["Grocer", "update", true],
    ]);
    const result = await s.call("import_transactions", { book, account, content, fileType: "csv" });
    expect(result.added).toHaveLength(1);
    expect(result.updated).toHaveLength(1);
    expect(await transactions()).toHaveLength(2);
    const fromPreview = await s.call("import_transactions", {
      book,
      account,
      rows: preview.rows.map(
        ({ index: _index, categoryName: _name, status: _status, match: _match, ...row }: any) =>
          row,
      ),
    });
    expect(fromPreview.rows.map((row: any) => row.status)).toEqual(["duplicate", "duplicate"]);
  });

  it("imports an OFX file once", async () => {
    const path = join(import.meta.dirname, "fixtures", "data.ofx");
    const first = await s.call("import_transactions", { book, account, path });
    expect(first.added).toHaveLength(10);
    const second = await s.call("import_transactions", { book, account, path });
    expect(second.added).toHaveLength(0);
    expect(second.skipped).toHaveLength(10);
  });

  it("refuses an account that is not an asset or liability", async () => {
    const groups = await s.call("list_categories", { book });
    const error = await s.fails("import_transactions", {
      book,
      account: groups[0].categories[0].id,
      rows: [{ date: "2024-01-01", amount: 1 }],
    });
    expect(error._tag).toBe("InvalidRequest");
  });
});

describe("compareFuzzyMatchCandidates", () => {
  const date = "2024-04-05";
  const alreadyImported = { date: 20240405, importedId: "existing-import-id" };
  const notYetImported = { date: 20240405, importedId: null };

  it("breaks a tie on distance by preferring the unlinked candidate", () => {
    const compare = (a: typeof alreadyImported | typeof notYetImported, b: typeof a) =>
      compareFuzzyMatchCandidates(date, a, b);
    expect([alreadyImported, notYetImported].sort(compare)).toEqual([
      notYetImported,
      alreadyImported,
    ]);
    expect([notYetImported, alreadyImported].sort(compare)).toEqual([
      notYetImported,
      alreadyImported,
    ]);
  });

  it("prefers the closer date over imported id status", () => {
    const fartherButUnlinked = { date: 20240408, importedId: null };
    expect(
      [fartherButUnlinked, alreadyImported].sort((a, b) => compareFuzzyMatchCandidates(date, a, b)),
    ).toEqual([alreadyImported, fartherButUnlinked]);
  });
});
