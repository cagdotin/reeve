import { vi, afterEach, beforeEach, describe, expect, it } from "vitest";

// Frozen behavior stays covered without enabling purchases in the product.
vi.mock("@reeve/contract/features", () => ({ FEATURES: { purchases: true } }));
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
let book: string;
let checking: string;
let food: string;
let general: string;
beforeEach(async () => {
  s = scratch();
  book = (await s.call("create_book", { name: "Test" })).id;
  checking = (await s.call("create_account", { book, name: "Checking" })).id;
  const groups = await s.call("list_categories", { book });
  food = groups[0].categories.find((c: any) => c.name === "Food").id;
  general = groups[0].categories.find((c: any) => c.name === "General").id;
});
afterEach(() => s.dispose());

const create = (input: Record<string, unknown>) =>
  s.call("create_receipt", { book, date: "2026-10-10", payee: "Grocer", ...input });

describe("creating receipts", () => {
  it("computes line totals, status and keeps raw text", async () => {
    const { receipt, created } = await create({
      total: 1051,
      lines: [
        { text: "  MILK  1L ", quantity: 2, unitPrice: 129 },
        { text: "BREAD", lineTotal: 349 },
        { text: "APPLES", quantity: 0.5, unit: "kg", unitPrice: 201 },
        { text: "RETURN BOTTLE", lineTotal: -25 },
      ],
      adjustments: [
        { kind: "tax", amount: 300 },
        { kind: "discount", amount: -1 },
      ],
    });
    expect(created).toBe(true);
    expect(receipt.payee).toBe("Grocer");
    expect(receipt.lines.map((line: any) => line.lineTotal)).toEqual([258, 349, 101, -25]);
    expect(receipt.lines[0].text).toBe("  MILK  1L ");
    expect(receipt.status).toMatchObject({
      itemsTotal: 683,
      adjustmentsTotal: 299,
      expectedTotal: 982,
      difference: 69,
      balanced: false,
      matched: false,
      categorized: false,
      applied: false,
      lineCount: 4,
      unassignedLines: 4,
    });
    expect(receipt.warnings.map((warning: any) => warning.code)).toEqual(["unbalanced"]);
  });

  it("returns the same receipt for the same externalId", async () => {
    const first = await create({
      total: 100,
      externalId: "agent-1",
      lines: [{ text: "A", lineTotal: 100 }],
    });
    const again = await create({ total: 999, externalId: "agent-1", lines: [] });
    expect(again.created).toBe(false);
    expect(again.receipt.id).toBe(first.receipt.id);
    expect(again.receipt.total).toBe(100);
    const { total } = await s.call("list_receipts", { book });
    expect(total).toBe(1);
  });

  it("warns, without failing, when a given line total differs by more than a cent", async () => {
    const { receipt } = await create({
      total: 302,
      lines: [
        { text: "A", quantity: 1, unitPrice: 100, lineTotal: 101 },
        { text: "B", quantity: 1, unitPrice: 100, lineTotal: 201 },
      ],
    });
    expect(receipt.warnings).toEqual([
      expect.objectContaining({ code: "line_total_mismatch", lineId: receipt.lines[1].id }),
    ]);
  });

  it("refuses a line with neither total nor price, and rolls the whole receipt back", async () => {
    const error = await s.fails("create_receipt", {
      book,
      date: "2026-10-10",
      total: 100,
      lines: [{ text: "A", lineTotal: 100 }, { text: "B" }],
    });
    expect(error._tag).toBe("InvalidRequest");
    expect((await s.call("list_receipts", { book })).total).toBe(0);
  });

  it("imports receipts from JSON, idempotent by externalId", async () => {
    const content = JSON.stringify([
      {
        date: "2026-10-01",
        payee: "Grocer",
        total: 100,
        externalId: "x1",
        lines: [{ text: "A", lineTotal: 100 }],
      },
      {
        date: "2026-10-02",
        payee: "Baker",
        total: 250,
        lines: [{ text: "B", quantity: 2, unitPrice: 125 }],
      },
    ]);
    const results = await s.call("import_receipts", { book, content });
    expect(results.map((each: any) => each.created)).toEqual([true, true]);
    expect(results[1].receipt.status.balanced).toBe(true);
    const bad = await s.fails("import_receipts", { book, content: '{"date":"nope"}' });
    expect(bad._tag).toBe("InvalidRequest");
    const again = await s.call("import_receipts", {
      book,
      content: JSON.stringify({ date: "2026-10-01", total: 1, externalId: "x1" }),
    });
    expect(again[0].created).toBe(false);
  });
});

describe("editing receipts", () => {
  it("adds, updates, reorders and deletes lines and adjustments", async () => {
    const { receipt } = await create({ total: 600, lines: [{ text: "A", lineTotal: 100 }] });
    let next = await s.call("add_receipt_lines", {
      book,
      receipt: receipt.id,
      lines: [{ text: "B", lineTotal: 200 }],
      before: receipt.lines[0].id,
    });
    expect(next.lines.map((line: any) => [line.position, line.text])).toEqual([
      [1, "B"],
      [2, "A"],
    ]);
    const a = next.lines[1].id;
    next = await s.call("update_receipt_line", { book, id: a, quantity: 3, unitPrice: 100 });
    expect(next.lines[1].lineTotal).toBe(300);
    next = await s.call("reorder_receipt_lines", { book, receipt: receipt.id, ids: [a] });
    expect(next.lines.map((line: any) => line.text)).toEqual(["A", "B"]);
    next = await s.call("add_receipt_adjustment", {
      book,
      receipt: receipt.id,
      kind: "tax",
      amount: 100,
    });
    expect(next.status.balanced).toBe(true);
    next = await s.call("update_receipt_adjustment", {
      book,
      id: next.adjustments[0].id,
      amount: 50,
    });
    expect(next.status.difference).toBe(50);
    next = await s.call("delete_receipt_adjustment", { book, id: next.adjustments[0].id });
    next = await s.call("delete_receipt_lines", { book, receipt: receipt.id, ids: [a] });
    expect(next.lines.map((line: any) => [line.position, line.text])).toEqual([[1, "B"]]);
    next = await s.call("update_receipt", {
      book,
      id: receipt.id,
      payee: "Other",
      total: 200,
      time: "09:30",
    });
    expect(next).toMatchObject({ payee: "Other", total: 200, time: "09:30" });
    expect(next.status.balanced).toBe(true);
  });

  it("undoes a receipt's creation in one step", async () => {
    await create({ total: 100, lines: [{ text: "A", lineTotal: 100 }] });
    await s.call("undo", { book });
    expect((await s.call("list_receipts", { book })).total).toBe(0);
    await s.call("redo", { book });
    const { receipts } = await s.call("list_receipts", { book });
    expect(receipts[0].status.lineCount).toBe(1);
  });
});

describe("listing receipts", () => {
  it("filters by range, store, text and status flags", async () => {
    const tx = await s.call("create_transaction", {
      book,
      account: checking,
      date: "2026-10-05",
      amount: -100,
      payee: "Grocer",
    });
    await create({
      date: "2026-10-05",
      total: 100,
      lines: [{ text: "Oat milk", lineTotal: 100, budgetCategoryId: food }],
      payments: [{ transactionId: tx.id }],
    });
    await create({
      date: "2026-09-01",
      payee: "Baker",
      total: 300,
      lines: [{ text: "Bread", lineTotal: 250 }],
    });
    const list = (input: Record<string, unknown>) =>
      s
        .call("list_receipts", { book, ...input })
        .then((page: any) => page.receipts.map((each: any) => each.payee));
    expect(await list({})).toEqual(["Grocer", "Baker"]);
    expect(await list({ from: "2026-10-01" })).toEqual(["Grocer"]);
    expect(await list({ query: "BREAD" })).toEqual(["Baker"]);
    expect(await list({ unbalanced: true })).toEqual(["Baker"]);
    expect(await list({ unmatched: true })).toEqual(["Baker"]);
    expect(await list({ uncategorized: true })).toEqual(["Baker"]);
    expect(await list({ unapplied: true })).toEqual(["Grocer"]);
    const page = await s.call("list_receipts", { book, limit: 1, offset: 1 });
    expect(page).toMatchObject({ total: 2, receipts: [{ payee: "Baker" }] });
  });
});

describe("categories of lines", () => {
  it("resolves a line's budget category through its product and the item-category tree", async () => {
    const groceries = await s.call("create_item_category", {
      book,
      name: "Groceries",
      budgetCategoryId: food,
    });
    const dairy = await s.call("create_item_category", {
      book,
      name: "Dairy",
      parentId: groceries.id,
    });
    const milk = await s.call("create_product", {
      book,
      name: "Milk",
      itemCategoryId: dairy.id,
      unit: "l",
    });
    const organic = await s.call("create_product", {
      book,
      name: "Organic milk 1L",
      parentId: milk.id,
      size: 1,
      sizeUnit: "l",
      unit: "l",
    });
    const { receipt } = await create({
      total: 600,
      lines: [
        { text: "ORG MILK", lineTotal: 200, productId: organic.id },
        { text: "SOAP", lineTotal: 300, budgetCategoryId: general },
        { text: "THING", lineTotal: 100 },
      ],
    });
    expect(
      receipt.lines.map((line: any) => [
        line.effectiveItemCategoryId,
        line.effectiveBudgetCategoryId,
      ]),
    ).toEqual([
      [dairy.id, food],
      [null, general],
      [null, null],
    ]);
    expect(receipt.lines[0].effectiveBudgetCategory).toBe("Food");
    expect(receipt.status).toMatchObject({ categorized: false, uncategorizedLines: 1 });
    const fixed = await s.call("update_receipt_line", {
      book,
      id: receipt.lines[2].id,
      itemCategoryId: dairy.id,
    });
    expect(fixed.status.categorized).toBe(true);
  });
});
