import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { looselyParseAmount, parseDate } from "../src/imports/fields.ts";
import { html2Plain } from "../src/imports/parse/ofx.ts";
import { titleCase } from "../src/imports/title.ts";
import { scratch } from "./helpers.ts";

const fixture = (name: string) => join(import.meta.dirname, "fixtures", name);

let s: ReturnType<typeof scratch>;
let book: string;
let account: string;
beforeEach(async () => {
  s = scratch();
  book = (await s.call("create_book", { name: "Test" })).id;
  account = (await s.call("create_account", { book, name: "Checking" })).id;
});
afterEach(() => s.dispose());

const preview = (input: Record<string, unknown>) => s.call("preview_import", { book, ...input });

/** Imports a fixture as Actual's parse-file tests do, payees as written, and reads back what was written. */
const importFile = async (name: string, options: Record<string, unknown> = {}) => {
  await s.call("import_transactions", {
    book,
    account,
    path: fixture(name),
    derivePayees: false,
    ...options,
  });
  const page = await s.call("list_transactions", { book, account });
  return Promise.all(
    page.rows.map(async (row: any) => {
      const tx = await s.call("get_transaction", { book, id: row.transactionId });
      return {
        date: row.date,
        amount: row.amount,
        importedId: tx.postings.find((posting: any) => posting.accountId === account).importedId,
        importedPayee: tx.importedPayee,
        notes: tx.notes,
      };
    }),
  );
};

const snapshots = JSON.parse(readFileSync(fixture("actual-snapshots.json"), "utf8")) as Record<
  string,
  Array<Record<string, unknown>>
>;

const byKey = (rows: ReadonlyArray<Record<string, unknown>>) =>
  rows.toSorted((a, b) =>
    JSON.stringify([a["date"], a["amount"], a["importedId"], a["importedPayee"]]).localeCompare(
      JSON.stringify([b["date"], b["amount"], b["importedId"], b["importedPayee"]]),
    ),
  );

/** What Actual's snapshot of the same import holds, in a comparable order. */
const actual = (name: string) => byKey(snapshots[name]!);

describe("html2Plain", () => {
  it("leaves regular text", () => {
    expect(html2Plain("Hello, world!")).toBe("Hello, world!");
    expect(html2Plain("Hello, <b>world</b>!")).toBe("Hello, <b>world</b>!");
  });
  it("unescapes brackets", () => {
    expect(html2Plain("Hello, &lt;world&gt;!")).toBe("Hello, <world>!");
  });
  it("unescapes apostrophes", () => {
    expect(html2Plain("Hello, &#39;world&#39;!")).toBe("Hello, 'world'!");
  });
  it("unescapes quotes", () => {
    expect(html2Plain("Hello, &quot;world&quot;!")).toBe('Hello, "world"!');
  });
  it("unescapes ampersands", () => {
    expect(html2Plain("Hello, &amp;world&amp;!")).toBe("Hello, &world&!");
    expect(html2Plain("Hello, &#038;world&#038;!")).toBe("Hello, &world&!");
  });
  it("does not unescape twice", () => {
    expect(html2Plain("Hello, &amp;#038;world&amp;#038;!")).toBe("Hello, &#038;world&#038;!");
    expect(html2Plain("Hello, &#038;amp;world&#038;amp;!")).toBe("Hello, &amp;world&amp;!");
    expect(html2Plain("Hello, &amp;quot;world&amp;quot;!")).toBe("Hello, &quot;world&quot;!");
  });
});

describe("date parsing", () => {
  const invalidInputs: Array<[unknown, Parameters<typeof parseDate>[1]]> = [
    ["", "yyyy mm dd"],
    [null, "yyyy mm dd"],
    [42, "yyyy mm dd"],
    [{}, "yyyy mm dd"],
    [[], "yyyy mm dd"],
    ["Decimal 24 2020", "mm dd yyyy"],
    ["24 aDec 2020", "dd mm yyyy"],
    ["invalid", "yyyy mm dd"],
    ["12 24 20", "mm dd yyyy"],
    ["20 12 24", "yyyy mm dd"],
    ["2020 12 24", "yy mm dd"],
    ["12 24 2020", "mm dd yy"],
    ["12 00 2020", "mm dd yyyy"],
    ["12 32 2020", "mm dd yyyy"],
    ["13 24 2020", "mm dd yyyy"],
    ["00 24 2020", "mm dd yyyy"],
    ["02 30 2020", "mm dd yyyy"],
    ["04 31 2020", "mm dd yyyy"],
    ["06 31 2020", "mm dd yyyy"],
    ["09 31 2020", "mm dd yyyy"],
    ["11 31 2020", "mm dd yyyy"],
    ["2046 31 2020", "mm dd yyyy"],
    ["2011 31 2020", "mm dd yy"],
    ["2020", "mm dd yy"],
  ];
  it.each(invalidInputs)("does not parse %j as %s", (value, order) => {
    expect(parseDate(value, order)).toBe(null);
  });

  const validInputs: Array<[Parameters<typeof parseDate>[1], Array<[string, string]>]> = [
    [
      "yyyy mm dd",
      [
        ["2020 Dec 24", "2020-12-24"],
        ["2020 Dec. 24", "2020-12-24"],
        ["2020 December 24", "2020-12-24"],
        ["20201224", "2020-12-24"],
        ["2020 12 24", "2020-12-24"],
        ["2020-1-2", "2020-01-02"],
        ["2020-12-24", "2020-12-24"],
        ["2020/12/24", "2020-12-24"],
        [" 2020 / 12 / 24", "2020-12-24"],
        ["2020/12/24 ", "2020-12-24"],
        ["2020 12-24 ", "2020-12-24"],
        ["2023-01-19T02:36:52", "2023-01-19"],
      ],
    ],
    [
      "yy mm dd",
      [
        ["20 Dec 24", "2020-12-24"],
        ["20 Dec. 24", "2020-12-24"],
        ["20 December 24", "2020-12-24"],
        ["201224", "2020-12-24"],
        ["20 12 24", "2020-12-24"],
        ["20-12-24", "2020-12-24"],
        ["20/12/24", "2020-12-24"],
        ["20/12/24 ", "2020-12-24"],
        ["20/1/2 ", "2020-01-02"],
        ["20 12-24 ", "2020-12-24"],
      ],
    ],
    [
      "mm dd yyyy",
      [
        ["Dec 24, 2020", "2020-12-24"],
        ["Dec. 24, 2020", "2020-12-24"],
        ["December 24, 2020", "2020-12-24"],
        ["Sept 6, 2026", "2026-09-06"],
        ["12242020", "2020-12-24"],
        ["1 24 2020", "2020-01-24"],
        ["01 24 2020", "2020-01-24"],
        ["12 24 2020 ", "2020-12-24"],
        ["12-24-2020", "2020-12-24"],
        ["12/24/2020", "2020-12-24"],
        [" 12/24/2020", "2020-12-24"],
        ["12 24-2020", "2020-12-24"],
      ],
    ],
    [
      "mm dd yy",
      [
        ["Dec 24, 20", "2020-12-24"],
        ["Dec. 24, 20", "2020-12-24"],
        ["December 24, 20", "2020-12-24"],
        ["122420", "2020-12-24"],
        ["12 24 20 ", "2020-12-24"],
        ["12-24-20", "2020-12-24"],
        ["1-24-20", "2020-01-24"],
        ["01-24-20", "2020-01-24"],
        ["12/24/20", "2020-12-24"],
        [" 12/24/20", "2020-12-24"],
        ["1/24/20", "2020-01-24"],
        ["12 24-20", "2020-12-24"],
      ],
    ],
    [
      "dd mm yyyy",
      [
        ["24 Dec 2020", "2020-12-24"],
        ["24 Dec. 2020", "2020-12-24"],
        ["24 December 2020", "2020-12-24"],
        ["6 Sept 2026", "2026-09-06"],
        ["24122020", "2020-12-24"],
        ["24 12 2020 ", "2020-12-24"],
        ["2 12 2020", "2020-12-02"],
        ["02 12 2020 ", "2020-12-02"],
        ["24-12-2020", "2020-12-24"],
        ["02-12-2020", "2020-12-02"],
        ["24/12/2020", "2020-12-24"],
        [" 24/12/2020", "2020-12-24"],
        ["24/12/2020 ", "2020-12-24"],
        ["2/12/2020 ", "2020-12-02"],
        ["24-12 2020", "2020-12-24"],
      ],
    ],
    [
      "dd mm yy",
      [
        ["24 Dec 20", "2020-12-24"],
        ["24 Dec. 20", "2020-12-24"],
        ["24 December 20", "2020-12-24"],
        ["06 Sept 26", "2026-09-06"],
        ["06 Sept. 26", "2026-09-06"],
        ["241220", "2020-12-24"],
        ["2412 20 ", "2020-12-24"],
        ["24-12-20", "2020-12-24"],
        ["2-12-20", "2020-12-02"],
        ["02-12-20", "2020-12-02"],
        ["24/12/20", "2020-12-24"],
        [" 24/12/20", "2020-12-24"],
        ["24/12/20 ", "2020-12-24"],
        ["2/12/20", "2020-12-02"],
        ["02/12/20", "2020-12-02"],
        ["24 12-20 ", "2020-12-24"],
      ],
    ],
  ];
  describe.each(validInputs)("with order %s", (order, cases) => {
    it.each(cases)("parses %j as %j", (value, expected) => {
      expect(parseDate(value, order)).toBe(expected);
    });
  });
});

describe("looselyParseAmount", () => {
  it("reads basic numbers", () => {
    expect(looselyParseAmount("3")).toBe(3);
    expect(looselyParseAmount("3.4")).toBe(3.4);
    expect(looselyParseAmount("3.45")).toBe(3.45);
    expect(looselyParseAmount("3.456")).toBe(3456);
    expect(looselyParseAmount("3.4500")).toBe(3.45);
    expect(looselyParseAmount("3.450000000")).toBe(3.45);
  });
  it("reads other formats", () => {
    expect(looselyParseAmount("3,45")).toBe(3.45);
    expect(looselyParseAmount("3,456")).toBe(3456);
    expect(looselyParseAmount("3,4500")).toBe(3.45);
    expect(looselyParseAmount("3'456.78")).toBe(3456.78);
    expect(looselyParseAmount("1,00,000.99")).toBe(100000.99);
  });
  it("reads leading decimal markers", () => {
    expect(looselyParseAmount(".45")).toBe(0.45);
    expect(looselyParseAmount(",45")).toBe(0.45);
  });
  it("reads negative numbers and parentheses", () => {
    expect(looselyParseAmount("-3,45")).toBe(-3.45);
    expect(looselyParseAmount("−3.45")).toBe(-3.45);
    expect(looselyParseAmount("(3.45)")).toBe(-3.45);
    expect(looselyParseAmount("(−3)")).toBe(-3);
  });
  it("ignores other characters and currency suffixes", () => {
    expect(looselyParseAmount("3_45_23.10")).toBe(34523.1);
    expect(looselyParseAmount("(1 500.99)")).toBe(-1500.99);
    expect(looselyParseAmount(" $1,055.00 ")).toBe(1055);
    expect(looselyParseAmount("3.45 €")).toBe(3.45);
    expect(looselyParseAmount("1.234,5 kr")).toBe(1234.5);
    expect(looselyParseAmount("(3.4 €)")).toBe(-3.4);
    expect(looselyParseAmount("1.500 €")).toBe(1500);
  });
});

describe("titleCase", () => {
  it("title-cases payees as Actual does", () => {
    expect(titleCase("Nintendo Store New York NY")).toBe("Nintendo Store New York Ny");
    expect(titleCase("bakkerij")).toBe("Bakkerij");
    expect(titleCase("the bank of america")).toBe("The Bank of America");
  });
});

describe("file import", () => {
  it("imports a QIF file", async () => {
    expect(byKey(await importFile("data.qif", { dateFormat: "mm dd yy" }))).toEqual(
      actual("qif import works"),
    );
  });

  it("detects the QIF date format", async () => {
    const result = await preview({ path: fixture("data.qif") });
    expect(result.dateFormat).toBe("mm dd yy");
    expect(result.rows.at(-1).date).toBe("2018-12-19");
  });

  it("keeps QIF categories", async () => {
    const result = await preview({ path: fixture("qif-category.qif") });
    expect(result.rows).toMatchObject([
      { payee: "Outlet", categoryName: "Shopping" },
      { payee: "GroceriesYou", categoryName: "Groceries" },
    ]);
  });

  it("imports an OFX file", async () => {
    expect(byKey(await importFile("data.ofx"))).toEqual(actual("ofx import works"));
  });

  it("imports a credit card OFX file", async () => {
    expect(byKey(await importFile("credit-card.ofx"))).toEqual(
      actual("ofx import works (credit card)"),
    );
  });

  it("imports a QFX file", async () => {
    expect(byKey(await importFile("data.qfx"))).toEqual(actual("qfx import works"));
  });

  it("respects importNotes", async () => {
    expect(byKey(await importFile("data.ofx"))).toEqual(
      actual("import notes are respected when importing > transactions with notes"),
    );
    const result = await preview({ path: fixture("html-vals.qfx"), importNotes: false });
    expect(result.rows.every((row: any) => row.notes === null)).toBe(true);
  });

  it("tells file types by extension, whatever their case", async () => {
    expect((await preview({ path: fixture("best.data-ever$.QFX") })).fileType).toBe("ofx");
    expect((await preview({ path: fixture("big.data.QiF") })).fileType).toBe("qif");
    const error = await s.fails("preview_import", { book, content: "x", fileName: "foo.txt" });
    expect(error.message).toBe("Invalid file type");
  });

  it("handles non-ASCII characters", async () => {
    expect(byKey(await importFile("8859-1.qfx"))).toEqual(actual("handles non-ASCII characters"));
  });

  it("handles the windows-1252 charset", async () => {
    expect(byKey(await importFile("1252.qfx"))).toEqual(actual("handles windows-1252 charset"));
  });

  it("handles UTF-8", async () => {
    expect(byKey(await importFile("utf-8.qfx"))).toEqual(actual("handles UTF-8 encoding"));
  });

  it("handles html escaped plaintext", async () => {
    expect(byKey(await importFile("html-vals.qfx"))).toEqual(
      actual("handles html escaped plaintext"),
    );
  });

  it("imports CAMT.053", async () => {
    expect(byKey(await importFile("camt/camt.053.xml"))).toEqual(actual("CAMT.053 import works"));
  });

  it("reads CAMT in ISO-8859-1", async () => {
    const result = await preview({ path: fixture("camt/camt.latin1.xml") });
    expect(result.rows.map((row: any) => row.notes).toSorted()).toEqual([
      "M-Überschusssparen",
      "Restaurant Schrödingers Katze und Café Ünique",
    ]);
    expect(result.rows.map((row: any) => row.payee)).toContain("Grüße aus München");
  });

  const hungarian = {
    "Könyvelés dátuma": "2025.12.04",
    Összeg: "100",
    Devizanem: "HUF",
  };

  it.each(["utf-16le.csv", "utf-16be.csv", "utf-8-bom.csv"])("reads CSV %s", async (name) => {
    const result = await preview({ path: fixture(name), dateField: "Könyvelés dátuma" });
    expect(result.rows).toHaveLength(2);
    expect(result.columns).toEqual(expect.arrayContaining(Object.keys(hungarian)));
    expect(result.rows[0]).toMatchObject({ amount: expect.any(Number) });
    expect(result.dateFormat).toBe("yyyy mm dd");
  });

  it("skips start lines of a UTF-16 CSV", async () => {
    const result = await preview({
      path: fixture("utf-16le.csv"),
      hasHeaderRow: false,
      skipStartLines: 1,
      dateField: "2",
      payeeField: "0",
      amountField: "3",
    });
    expect(result.columns[0]).toBe("0");
    expect(result.rows.length + result.errors.length).toBe(2);
  });

  it("takes an encoding for a CSV", async () => {
    const result = await preview({ path: fixture("windows-1252.csv"), encoding: "windows-1252" });
    expect(result.rows).toMatchObject([
      { date: "2025-12-05", payee: "Boulangerie Müller", amount: -4210 },
      { date: "2025-12-04", payee: "Café Rémy", amount: 10025 },
    ]);
  });

  it("reads iso-8859-1 as windows-1252", async () => {
    const result = await preview({
      path: fixture("windows-1252-euro.csv"),
      encoding: "iso-8859-1",
    });
    expect(result.rows).toMatchObject([{ payee: "Café €Rémy", amount: 10025 }]);
  });

  it("treats auto encoding as detection", async () => {
    const result = await preview({ path: fixture("utf-16le.csv"), encoding: "auto" });
    expect(result.columns).toContain("Könyvelés dátuma");
  });

  it("refuses an unknown encoding", async () => {
    const error = await s.fails("preview_import", {
      book,
      path: fixture("utf-8-bom.csv"),
      encoding: "not-an-encoding",
    });
    expect(error.message).toContain("Failed parsing");
  });

  it("swaps payee and memo, and falls back to the memo", async () => {
    const swapped = await preview({ path: fixture("data-payee-memo.qif"), swapPayeeAndMemo: true });
    expect(swapped.rows.map((row: any) => [row.payee, row.notes])).toEqual([
      ["Note Text", "Payee Name"],
      ["Payee Name Only", null],
      ["Note Only Text", null],
      [null, null],
    ]);
    const ofx = await preview({ path: fixture("data-payee-memo.ofx") });
    const noFallback = await preview({
      path: fixture("data-payee-memo.ofx"),
      fallbackMissingPayeeToMemo: false,
    });
    expect(ofx.rows.filter((row: any) => row.payee === null).length).toBeLessThan(
      noFallback.rows.filter((row: any) => row.payee === null).length,
    );
  });

  it("reads OFX amounts with several decimals", async () => {
    const result = await preview({ path: fixture("data-multi-decimal.ofx") });
    expect(result.rows.map((row: any) => row.amount).toSorted()).toEqual([-3000, -377]);
  });
});

describe("CSV options", () => {
  const csv = [
    "Date,Payee,Notes,Amount,Category",
    "01/15/2024,Grocer,Weekly,-42.50,Food",
    "03/01/2024,Employer,,1000.00,Salary",
    "02/10/2024,Utility,,-80,Missing category",
  ].join("\n");

  it("guesses the mapping and the date format, and finds categories by name", async () => {
    const result = await preview({ content: csv, fileType: "csv" });
    expect(result.mapping).toMatchObject({
      date: "Date",
      payee: "Payee",
      notes: "Notes",
      amount: "Amount",
      category: "Category",
    });
    expect(result.dateFormat).toBe("mm dd yyyy");
    const groups = await s.call("list_categories", { book });
    const food = groups[0].categories.find((c: any) => c.name === "Food");
    expect(result.rows).toMatchObject([
      { date: "2024-03-01", payee: "Employer", amount: 100000, category: null },
      { date: "2024-02-10", payee: "Utility", amount: -8000, categoryName: "Missing category" },
      { date: "2024-01-15", payee: "Grocer", notes: "Weekly", amount: -4250, category: food.id },
    ]);
  });

  it("filters by a start date", async () => {
    const result = await preview({ content: csv, fileType: "csv", startDate: "2024-02-01" });
    expect(result.rows.map((row: any) => row.date)).toEqual(["2024-03-01", "2024-02-10"]);
  });

  it("flips and multiplies amounts", async () => {
    const result = await preview({
      content: csv,
      fileType: "csv",
      flipAmount: true,
      multiplier: 2,
    });
    expect(result.rows.map((row: any) => row.amount)).toEqual([-200000, 16000, 8500]);
  });

  it("reads separate inflow and outflow columns", async () => {
    const content = ["Date;Payee;In;Out", "2024-01-02;A;;12,50", "2024-01-03;B;100;"].join("\n");
    const result = await preview({
      content,
      fileName: "bank.csv",
      delimiter: ";",
      inflowField: "In",
      outflowField: "Out",
    });
    expect(result.dateFormat).toBe("yyyy mm dd");
    expect(result.rows.map((row: any) => [row.payee, row.amount])).toEqual([
      ["B", 10000],
      ["A", -1250],
    ]);
  });

  it("reads an in/out column", async () => {
    const content = ["Date,Payee,Amount,Type", "2024-01-02,A,10,DR", "2024-01-03,B,20,CR"].join(
      "\n",
    );
    const result = await preview({
      content,
      fileType: "csv",
      inOutField: "Type",
      outValue: "DR",
    });
    expect(result.rows.map((row: any) => row.amount)).toEqual([2000, -1000]);
  });

  it("maps columns by index without a header row", async () => {
    const content = ["24.12.2020;Shop;-5,00", "25.12.2020;Gift;20,00"].join("\n");
    const result = await preview({
      content,
      fileType: "csv",
      delimiter: ";",
      hasHeaderRow: false,
      dateField: "0",
      payeeField: "1",
      amountField: "2",
      dateFormat: "dd mm yyyy",
    });
    expect(result.columns).toEqual(["0", "1", "2"]);
    expect(result.rows.map((row: any) => [row.date, row.payee, row.amount])).toEqual([
      ["2020-12-25", "Gift", 2000],
      ["2020-12-24", "Shop", -500],
    ]);
  });

  it("reports rows whose date it cannot read, and refuses to import them", async () => {
    const content = ["Date,Payee,Amount", "2024-01-02,A,10", "nope,B,20"].join("\n");
    const result = await preview({ content, fileType: "csv" });
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual([
      { index: 1, message: "Unable to parse date nope with given date format" },
    ]);
    const error = await s.fails("import_transactions", {
      book,
      account,
      content,
      fileType: "csv",
    });
    expect(error.message).toContain("Unable to parse date nope");
  });

  it("skips lines at the end", async () => {
    const content = ["Date,Payee,Amount", "2024-01-02,A,10", "Total,,10"].join("\n");
    const result = await preview({ content, fileType: "csv", skipEndLines: 1 });
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });
});

describe("payees from card text", () => {
  const cardFiles = ["erste-card.csv", "camt/camt.053.erste-card.xml"];
  const imported = async (into: string, name: string, options: Record<string, unknown> = {}) => {
    await s.call("import_transactions", { book, account: into, path: fixture(name), ...options });
    const page = await s.call("list_transactions", { book, account: into });
    return Promise.all(
      page.rows.map(async (row: any) => {
        const tx = await s.call("get_transaction", { book, id: row.transactionId });
        return { payee: row.payee, importedPayee: tx.importedPayee, notes: tx.notes };
      }),
    );
  };
  const payeeNames = async () =>
    (await s.call("list_payees", { book })).map((payee: any) => payee.name);

  it.each(cardFiles)("%s gives every purchase at one shop one payee", async (name) => {
    const rows = await imported(account, name);
    expect(await payeeNames(), "one payee per shop, not per purchase").toHaveLength(3);
    expect(await payeeNames()).toEqual(expect.arrayContaining(["Billa Dankt", "Tabak Trafik"]));
    const tabak = rows.filter((row) => row.importedPayee === "TABAK TRAFIK");
    const notes = tabak.map((row) => String(row.notes)).toSorted((a, b) => a.localeCompare(b));
    expect(notes, "the card text stays in the notes").toEqual([
      "TABAK TRAFIK 3219  K2   01.11. 22:26",
      "TABAK TRAFIK 3219  K2   03.11. 09:45",
    ]);
  });

  it.each(cardFiles)("%s keeps each payee as written without derivePayees", async (name) => {
    const rows = await imported(account, name, { derivePayees: false });
    expect(await payeeNames()).toHaveLength(5);
    expect(rows.every((row) => row.notes === null || row.notes === "Jahreskarte 2026")).toBe(true);
  });

  it("previews the derived payee", async () => {
    const result = await preview({ path: fixture("erste-card.csv"), account });
    expect(new Set(result.rows.map((row: any) => row.payee))).toEqual(
      new Set(["TABAK TRAFIK", "BILLA DANKT", "Wiener Linien GmbH & Co KG"]),
    );
  });

  it("lets a rename hold for the shop's later files", async () => {
    await imported(account, "erste-card.csv");
    const payee = (await s.call("list_payees", { book })).find(
      (found: any) => found.name === "Tabak Trafik",
    );
    await s.call("update_payee", {
      book,
      id: payee.id,
      name: "Tabak Trafik Mila",
      renameImports: true,
    });
    const savings = (await s.call("create_account", { book, name: "Savings" })).id;
    const rows = await imported(savings, "camt/camt.053.erste-card.xml");
    expect(
      rows.filter((row) => row.importedPayee === "TABAK TRAFIK").map((row) => row.payee),
    ).toEqual(["Tabak Trafik Mila", "Tabak Trafik Mila"]);
  });
});
