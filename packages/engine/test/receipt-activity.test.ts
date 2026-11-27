import { today } from "@reeve/contract/rules";
import { addDays, format, parseISO } from "date-fns";
import { vi, afterEach, beforeEach, describe, expect, it } from "vitest";

// Frozen behavior stays covered without enabling purchases in the product.
vi.mock("@reeve/contract/features", () => ({ FEATURES: { purchases: true } }));
import { scratch } from "./helpers.ts";

const daysAgo = (days: number) => format(addDays(parseISO(today()), -days), "yyyy-MM-dd");

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

const receipt = async (input: Record<string, unknown>) =>
  (await s.call("create_receipt", { book, date: daysAgo(1), payee: "Grocer", ...input })).receipt;

const paying = (amount: number, date = daysAgo(1)) =>
  s.call("create_transaction", {
    book,
    account: checking,
    date,
    amount: -amount,
    payee: "Grocer",
    category: food,
  });

/** One receipt at each step, with `since` a month back. */
const everyStage = async () => {
  await receipt({ total: 1000, lines: [{ text: "Off", lineTotal: 880, budgetCategoryId: food }] });
  await receipt({
    total: 500,
    lines: [{ text: "Unpaid", lineTotal: 500, budgetCategoryId: food }],
  });
  const a = await paying(700);
  await receipt({
    total: 700,
    lines: [{ text: "No category", lineTotal: 700 }],
    payments: [{ transactionId: a.id }],
  });
  const b = await paying(300);
  const ready = await receipt({
    total: 300,
    lines: [{ text: "Ready", lineTotal: 300, budgetCategoryId: general }],
    payments: [{ transactionId: b.id }],
  });
  const c = await paying(200);
  const done = await receipt({
    total: 200,
    lines: [{ text: "Done", lineTotal: 200, budgetCategoryId: general }],
    payments: [{ transactionId: c.id }],
  });
  await s.call("apply_receipt_to_transaction", { book, id: done.id });
  return { ready, done };
};

describe("receipt_activity", () => {
  it("puts each receipt at the first step it has not done, and lists the same ones", async () => {
    await everyStage();
    const { pipeline, summary } = await s.call("receipt_activity", { book, since: daysAgo(30) });
    expect(pipeline).toEqual({ balance: 1, match: 1, categorize: 1, apply: 1, finished: 1 });
    expect(summary.receipts).toBe(5);
    for (const stage of ["balance", "match", "categorize", "apply", "finished"]) {
      const { total } = await s.call("list_receipts", { book, stage });
      expect(total).toBe(1);
    }
    expect((await s.call("list_receipts", { book, stage: "unfinished" })).total).toBe(4);
  });

  it("nets refunds out of spent and leaves them out of the average basket", async () => {
    await receipt({ total: 1000 });
    await receipt({ total: 2000 });
    await receipt({ total: -500 });
    const { summary } = await s.call("receipt_activity", { book, since: daysAgo(30) });
    expect(summary).toMatchObject({
      receipts: 3,
      purchases: 2,
      spent: 2500,
      refunds: 500,
      average: 1500,
    });
  });

  it("compares with as many days before the range", async () => {
    await receipt({ total: 1000, date: daysAgo(5) });
    await receipt({ total: 400, date: daysAgo(15) });
    await receipt({ total: 900, date: daysAgo(25) });
    const { summary } = await s.call("receipt_activity", { book, since: daysAgo(10) });
    expect(summary.spent).toBe(1000);
    expect(summary.previous.spent).toBe(400);
    const all = await s.call("receipt_activity", { book });
    expect(all.summary.spent).toBe(2300);
    expect(all.summary.previous).toBeNull();
  });

  it("ranks stores by what was paid and shows what the ledger records there", async () => {
    await receipt({ total: 1000, payee: "Big" });
    await receipt({ total: 200, payee: "Small" });
    await receipt({ total: 150, payee: null });
    await s.call("create_transaction", {
      book,
      account: checking,
      date: daysAgo(2),
      amount: -4000,
      payee: "Big",
      category: food,
    });
    const { stores } = await s.call("receipt_activity", { book, since: daysAgo(30) });
    expect(stores.map((each: any) => [each.name, each.spent, each.recorded])).toEqual([
      ["Big", 1000, 4000],
      ["Small", 200, 0],
      ["No store", 150, 0],
    ]);
  });

  it("spreads a receipt's total over its lines by top-level item category", async () => {
    const top = await s.call("create_item_category", { book, name: "Groceries" });
    const dairy = await s.call("create_item_category", { book, name: "Dairy", parentId: top.id });
    await receipt({
      total: 1100,
      lines: [
        { text: "Milk", lineTotal: 500, itemCategoryId: dairy.id },
        { text: "Thing", lineTotal: 500 },
      ],
      adjustments: [{ kind: "tax", amount: 100 }],
    });
    await receipt({ total: 900 });
    const { categories, unitemized } = await s.call("receipt_activity", {
      book,
      since: daysAgo(30),
    });
    expect(categories.map((each: any) => [each.name, each.spent, each.lines])).toEqual([
      ["Groceries", 550, 1],
      ["No item category", 550, 1],
    ]);
    expect(unitemized).toBe(900);
    const within = await s.call("list_receipts", { book, itemCategoryId: top.id });
    expect(within.total).toBe(1);
    expect((await s.call("list_receipts", { book, noItemCategory: true })).total).toBe(1);
  });

  it("says how much recorded spending has receipts behind it, by the transaction's day", async () => {
    const tx = await paying(3000, daysAgo(2));
    await paying(7000, daysAgo(3));
    await paying(9999, daysAgo(60));
    await receipt({ total: 3000, date: daysAgo(40), payments: [{ transactionId: tx.id }] });
    await receipt({ total: 1000 });
    await receipt({ total: -300 });
    const { coverage } = await s.call("receipt_activity", { book, since: daysAgo(30) });
    expect(coverage).toEqual({ recorded: 10_000, covered: 3000, unlinked: 1000 });
  });

  it("counts open checks across the book, each as many as its list holds", async () => {
    await receipt({ total: 1000, date: daysAgo(200) });
    await receipt({
      total: 1000,
      lines: [
        { text: "Off", lineTotal: 880 },
        { text: "Priced", quantity: 2, unitPrice: 50, lineTotal: 110 },
      ],
    });
    await everyStage();
    const { attention } = await s.call("receipt_activity", { book, since: daysAgo(10) });
    expect(attention).toEqual({
      off: 2,
      offAmount: 120 + 10,
      noLines: 1,
      noPayment: 4,
      uncategorizedLines: 2,
      uncategorizedLineCount: 3,
      unapplied: 2,
      lineMismatch: 1,
      old: 1,
      oldDays: 30,
    });
    const counted = {
      off: attention.off,
      no_lines: attention.noLines,
      no_payment: attention.noPayment,
      uncategorized_lines: attention.uncategorizedLines,
      unapplied: attention.unapplied,
      line_mismatch: attention.lineMismatch,
      old: attention.old,
    };
    for (const [check, count] of Object.entries(counted))
      expect((await s.call("list_receipts", { book, check })).total).toBe(count);
  });

  it("lists months with what stands unfinished today", async () => {
    await receipt({ total: 1000, date: today() });
    const { months, unfinished, total, earliest } = await s.call("receipt_activity", { book });
    expect(months).toHaveLength(12);
    expect(months.at(-1)).toMatchObject({ receipts: 1, spent: 1000, unfinished: 1 });
    expect([unfinished, total, earliest]).toEqual([1, 1, today()]);
  });

  it("compares with a period as long as the range, its first day included", async () => {
    await receipt({ total: 100, date: daysAgo(21) });
    await receipt({ total: 900, date: daysAgo(22) });
    const { summary } = await s.call("receipt_activity", { book, since: daysAgo(10) });
    expect(summary.previous.spent).toBe(100);
  });

  it("covers only what a transaction posts to expense accounts", async () => {
    const groups = await s.call("list_categories", { book });
    const income = groups
      .flatMap((group: any) => group.categories)
      .find((c: any) => c.type === "income" || c.isIncome === true || c.name === "Income").id;
    const onCategory = (amount: number, category: string) =>
      s.call("create_transaction", {
        book,
        account: checking,
        date: daysAgo(1),
        amount,
        payee: "Grocer",
        category,
      });
    const purchase = await onCategory(-1000, food);
    await receipt({ total: 1000, payments: [{ transactionId: purchase.id }] });
    const before = await s.call("receipt_activity", { book, since: daysAgo(30) });
    expect(before.coverage).toMatchObject({ recorded: 1000, covered: 1000 });

    const refund = await onCategory(400, income);
    await receipt({ total: -400, payments: [{ transactionId: refund.id }] });
    const afterRefund = await s.call("receipt_activity", { book, since: daysAgo(30) });
    expect(afterRefund.coverage).toMatchObject({ recorded: 1000, covered: 1000 });

    const odd = await onCategory(-800, income);
    await receipt({ total: 800, payments: [{ transactionId: odd.id }] });
    const afterOdd = await s.call("receipt_activity", { book, since: daysAgo(30) });
    expect(afterOdd.coverage.covered).toBeLessThanOrEqual(afterOdd.coverage.recorded);
    expect(afterOdd.coverage).toMatchObject({ covered: 1000 });

    const realRefund = await onCategory(300, food);
    await receipt({ total: -300, payments: [{ transactionId: realRefund.id }] });
    const net = await s.call("receipt_activity", { book, since: daysAgo(30) });
    expect(net.coverage).toMatchObject({ recorded: 700, covered: 700 });
  });

  it("names every category in the months, in the range or not", async () => {
    const dairy = await s.call("create_item_category", { book, name: "Dairy" });
    await receipt({
      total: 500,
      date: daysAgo(200),
      lines: [{ text: "Milk", lineTotal: 500, itemCategoryId: dairy.id }],
    });
    const { months, categories } = await s.call("receipt_activity", { book, since: daysAgo(90) });
    expect(categories).toEqual([]);
    const parts = months.flatMap((month: any) => month.categories);
    expect(parts).toEqual([{ id: dairy.id, name: "Dairy", spent: 500 }]);
  });

  it("reads an empty book", async () => {
    const overview = await s.call("receipt_activity", { book, since: daysAgo(30) });
    expect(overview.total).toBe(0);
    expect(overview.earliest).toBeNull();
    expect(overview.summary.average).toBe(0);
  });
});

describe("linking a payment by default", () => {
  it("never invents an amount for a receipt already paid", async () => {
    const a = await paying(100);
    const paid = await receipt({ total: 100, payments: [{ transactionId: a.id }] });
    const b = await paying(250);
    await expect(
      s.call("link_receipt_payment", { book, receipt: paid.id, transaction: b.id }),
    ).rejects.toThrow(/nothing/i);
    const read = await s.call("get_receipt", { book, id: paid.id });
    expect(read.status.paidAmount).toBe(100);
  });

  it("still takes what is left, and what a smaller transaction has", async () => {
    const small = await paying(60);
    const open = await receipt({ total: 100 });
    const first = await s.call("link_receipt_payment", {
      book,
      receipt: open.id,
      transaction: small.id,
    });
    expect(first.status.paidAmount).toBe(60);
    const big = await paying(500);
    const second = await s.call("link_receipt_payment", {
      book,
      receipt: open.id,
      transaction: big.id,
    });
    expect(second.status.paidAmount).toBe(100);
  });

  it("finishes a cash purchase through a transaction on a cash account", async () => {
    const cash = (await s.call("create_account", { book, name: "Cash", balance: 10_000 })).id;
    const tx = await s.call("create_transaction", {
      book,
      account: cash,
      date: daysAgo(1),
      amount: -870,
      payee: "Flea market",
      category: food,
    });
    const flea = await receipt({
      total: 870,
      payee: "Flea market",
      lines: [
        { text: "Lamp", lineTotal: 500, budgetCategoryId: general },
        { text: "Plate", lineTotal: 370, budgetCategoryId: food },
      ],
    });
    await s.call("link_receipt_payment", { book, receipt: flea.id, transaction: tx.id });
    await s.call("apply_receipt_to_transaction", { book, id: flea.id });
    const { status } = await s.call("get_receipt", { book, id: flea.id });
    expect(status).toMatchObject({
      balanced: true,
      matched: true,
      categorized: true,
      applied: true,
    });
    const { pipeline } = await s.call("receipt_activity", { book });
    expect(pipeline.finished).toBe(1);
  });
});

describe("list_receipts paging and sorting", () => {
  it("sorts across pages on the server", async () => {
    await receipt({ total: 300, payee: "Beta", date: daysAgo(3) });
    await receipt({ total: 100, payee: "Alpha", date: daysAgo(1) });
    await receipt({ total: 200, payee: "Gamma", date: daysAgo(2) });
    const names = async (input: Record<string, unknown>) =>
      (await s.call("list_receipts", { book, ...input })).receipts.map((each: any) => each.payee);
    expect(await names({})).toEqual(["Alpha", "Gamma", "Beta"]);
    expect(await names({ sort: "date", descending: false })).toEqual(["Beta", "Gamma", "Alpha"]);
    expect(await names({ sort: "total", descending: true, limit: 1 })).toEqual(["Beta"]);
    expect(await names({ sort: "total", descending: true, limit: 1, offset: 1 })).toEqual([
      "Gamma",
    ]);
    expect(await names({ sort: "store" })).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("takes receipts without a store as well as named stores", async () => {
    const big = await receipt({ total: 100, payee: "Big" });
    await receipt({ total: 200, payee: "Small" });
    await receipt({ total: 300, payee: null });
    const { total } = await s.call("list_receipts", {
      book,
      noStore: true,
      payeeIds: [big.payeeId],
    });
    expect(total).toBe(2);
    expect((await s.call("list_receipts", { book, noStore: true })).total).toBe(1);
  });
});

describe("a receipt's total", () => {
  it("can't be zero when created, imported or changed", async () => {
    await expect(receipt({ total: 0 })).rejects.toThrow(/can't be zero/);
    const kept = await receipt({ total: 500 });
    await expect(s.call("update_receipt", { book, id: kept.id, total: 0 })).rejects.toThrow(
      /can't be zero/,
    );
    const read = await s.call("get_receipt", { book, id: kept.id });
    expect(read.total).toBe(500);
    expect((await s.call("list_receipts", { book })).total).toBe(1);
  });

  it("can be a refund", async () => {
    expect((await receipt({ total: -500 })).total).toBe(-500);
  });
});

describe("a range with a last day", () => {
  it("leaves out what came after it, and compares with as many days before", async () => {
    await receipt({ date: daysAgo(40), total: 100 }); // before the period before
    await receipt({ date: daysAgo(25), total: 200 }); // the period before
    await receipt({ date: daysAgo(15), total: 400 }); // the range
    await receipt({ date: daysAgo(5), total: 800 }); // after it
    const overview = await s.call("receipt_activity", {
      book,
      since: daysAgo(20),
      until: daysAgo(10),
    });
    expect(overview.summary.spent).toBe(400);
    expect(overview.summary.previous?.spent).toBe(200);
  });

  it("keeps ledger spending to the range", async () => {
    const inside = await paying(300, daysAgo(15));
    await paying(700, daysAgo(5));
    await receipt({ date: daysAgo(15), total: 300, payments: [{ transactionId: inside.id }] });
    const overview = await s.call("receipt_activity", {
      book,
      since: daysAgo(20),
      until: daysAgo(10),
    });
    expect(overview.coverage.covered).toBe(overview.coverage.recorded);
  });
});
