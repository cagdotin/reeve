import { vi, afterEach, beforeEach, describe, expect, it } from "vitest";

// Frozen behavior stays covered without enabling purchases in the product.
vi.mock("@reeve/contract/features", () => ({ FEATURES: { purchases: true } }));
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
let book: string;
let checking: string;
let food: string;
let general: string;
let bills: string;
beforeEach(async () => {
  s = scratch();
  book = (await s.call("create_book", { name: "Test" })).id;
  checking = (await s.call("create_account", { book, name: "Checking" })).id;
  const groups = await s.call("list_categories", { book });
  const named = (name: string) => groups[0].categories.find((c: any) => c.name === name).id;
  food = named("Food");
  general = named("General");
  bills = named("Bills");
});
afterEach(() => s.dispose());

const turnOn = () => s.call("update_book", { book, autoApplyReceipts: true });

const spend = (amount: number, date = "2026-10-10", payee = "Grocer") =>
  s.call("create_transaction", { book, account: checking, date, amount: -amount, payee });

const receipt = (total: number, input: Record<string, unknown> = {}) =>
  s.call("create_receipt", {
    book,
    date: "2026-10-10",
    payee: "Grocer",
    total,
    lines: [
      { text: "Apples", lineTotal: total - 300, budgetCategoryId: food },
      { text: "Soap", lineTotal: 300, budgetCategoryId: general },
    ],
    ...input,
  });

const spent = async (category: string) => {
  const view = await s.call("get_budget", { book, month: "2026-10" });
  return view.months[0].categories.find((c: any) => c.id === category).spent;
};

const get = (id: string) => s.call("get_receipt", { book, id });

describe("the autoApplyReceipts setting", () => {
  it("is off by default, and then nothing applies itself", async () => {
    expect((await s.call("get_book", { book })).settings.autoApplyReceipts).toBe(false);
    const tx = await spend(1000);
    const { receipt: r } = await receipt(1000, { payments: [{ transactionId: tx.id }] });
    expect(r.status).toMatchObject({ balanced: true, matched: true, categorized: true });
    expect(r.status.applied).toBe(false);
    expect(r.autoApplied).toBe(false);
    expect(await spent(food)).toBe(0);
  });

  it("leaves receipts that are ready when it is turned on to be applied by hand", async () => {
    const tx = await spend(1000);
    const { receipt: r } = await receipt(1000, { payments: [{ transactionId: tx.id }] });
    expect((await turnOn()).autoApplyReceipts).toBe(true);
    expect((await get(r.id)).status.applied).toBe(false);
    await s.call("update_receipt", { book, id: r.id, notes: "weekly shop" });
    expect((await get(r.id)).status.applied).toBe(false);
  });
});

describe("with autoApplyReceipts on, a receipt applies itself when a write makes it ready", () => {
  beforeEach(turnOn);

  it("on create_receipt with its payment", async () => {
    const tx = await spend(1000);
    const { receipt: r } = await receipt(1000, { payments: [{ transactionId: tx.id }] });
    expect(r.status.applied).toBe(true);
    expect(r.autoApplied).toBe(true);
    expect(r.payments[0].applied).toBe(true);
    expect(await spent(food)).toBe(-700);
    expect(await spent(general)).toBe(-300);
  });

  it("on import_receipts", async () => {
    const tx = await spend(1000);
    const [result] = await s.call("import_receipts", {
      book,
      content: JSON.stringify({
        date: "2026-10-10",
        payee: "Grocer",
        total: 1000,
        lines: [{ text: "Apples", lineTotal: 1000, budgetCategoryId: food }],
        payments: [{ transactionId: tx.id }],
      }),
    });
    expect(result.receipt.status.applied).toBe(true);
    expect(await spent(food)).toBe(-1000);
  });

  it("on link_receipt_payment", async () => {
    const tx = await spend(1000);
    const { receipt: r } = await receipt(1000);
    expect(r.status.applied).toBe(false);
    const linked = await s.call("link_receipt_payment", {
      book,
      receipt: r.id,
      transaction: tx.id,
    });
    expect(linked.status.applied).toBe(true);
    expect(linked.autoApplied).toBe(true);
  });

  it("on auto_match_receipts", async () => {
    const tx = await spend(1000, "2026-10-11");
    const { receipt: r } = await receipt(1000);
    const result = await s.call("auto_match_receipts", { book });
    expect(result.linked).toEqual([{ receiptId: r.id, transactionId: tx.id, amount: 1000 }]);
    expect((await get(r.id)).status.applied).toBe(true);
    expect(await spent(general)).toBe(-300);
  });

  it("on editing a line's budget category", async () => {
    const tx = await spend(1000);
    const { receipt: r } = await receipt(1000, {
      lines: [{ text: "Mystery", lineTotal: 1000 }],
      payments: [{ transactionId: tx.id }],
    });
    expect(r.status.applied).toBe(false);
    const edited = await s.call("update_receipt_line", {
      book,
      id: r.lines[0].id,
      budgetCategoryId: bills,
    });
    expect(edited.status.applied).toBe(true);
    expect(await spent(bills)).toBe(-1000);
  });

  it("on adding lines, adding an adjustment or changing the total", async () => {
    const one = await spend(1100);
    const { receipt: a } = await receipt(1100, {
      lines: [{ text: "Apples", lineTotal: 1000, budgetCategoryId: food }],
      payments: [{ transactionId: one.id }],
    });
    expect(a.status.balanced).toBe(false);
    const adjusted = await s.call("add_receipt_adjustment", {
      book,
      receipt: a.id,
      kind: "tax",
      amount: 100,
    });
    expect(adjusted.status.applied).toBe(true);

    const two = await spend(1200, "2026-10-12");
    const { receipt: b } = await receipt(1200, {
      date: "2026-10-12",
      lines: [{ text: "Apples", lineTotal: 1000, budgetCategoryId: food }],
      payments: [{ transactionId: two.id }],
    });
    expect(b.status.applied).toBe(false);
    const added = await s.call("add_receipt_lines", {
      book,
      receipt: b.id,
      lines: [{ text: "Soap", lineTotal: 200, budgetCategoryId: general }],
    });
    expect(added.status.applied).toBe(true);

    const three = await spend(900, "2026-10-14");
    const { receipt: c } = await receipt(1000, {
      date: "2026-10-14",
      payments: [{ transactionId: three.id, amount: 900 }],
    });
    expect(c.status.matched).toBe(false);
    await s.call("delete_receipt_lines", { book, receipt: c.id, ids: [c.lines[1].id] });
    await s.call("update_receipt_line", { book, id: c.lines[0].id, lineTotal: 900 });
    const totalled = await s.call("update_receipt", { book, id: c.id, total: 900 });
    expect(totalled.status.applied).toBe(true);
  });

  it("on assigning a product whose item category names a budget category", async () => {
    const dairy = await s.call("create_item_category", {
      book,
      name: "Dairy",
      budgetCategoryId: food,
    });
    const milk = await s.call("create_product", { book, name: "Milk", itemCategoryId: dairy.id });
    const tx = await spend(500);
    const { receipt: r } = await receipt(500, {
      lines: [{ text: "MILK 1L", lineTotal: 500 }],
      payments: [{ transactionId: tx.id }],
    });
    const result = await s.call("assign_line_product", {
      book,
      line: r.lines[0].id,
      productId: milk.id,
    });
    expect(result.receipt.status.applied).toBe(true);
    expect(await spent(food)).toBe(-500);
  });

  it("on assigning a product to similar lines on other receipts", async () => {
    const dairy = await s.call("create_item_category", {
      book,
      name: "Dairy",
      budgetCategoryId: food,
    });
    const milk = await s.call("create_product", { book, name: "Milk", itemCategoryId: dairy.id });
    const one = await spend(500);
    const two = await spend(400, "2026-10-12");
    const { receipt: a } = await receipt(500, {
      lines: [{ text: "MILK 1L", lineTotal: 500 }],
      payments: [{ transactionId: one.id }],
    });
    const { receipt: b } = await receipt(400, {
      date: "2026-10-12",
      lines: [{ text: "milk 1l", lineTotal: 400 }],
      payments: [{ transactionId: two.id }],
    });
    await s.call("assign_line_product", {
      book,
      line: a.lines[0].id,
      productId: milk.id,
      applyToSimilar: true,
    });
    expect((await get(a.id)).status.applied).toBe(true);
    expect((await get(b.id)).status.applied).toBe(true);
  });

  it("on a product's item category or an item category's budget category changing", async () => {
    const dairy = await s.call("create_item_category", { book, name: "Dairy" });
    const milk = await s.call("create_product", { book, name: "Milk" });
    const tx = await spend(500);
    const { receipt: r } = await receipt(500, {
      lines: [{ text: "MILK", lineTotal: 500, productId: milk.id }],
      payments: [{ transactionId: tx.id }],
    });
    await s.call("update_product", { book, id: milk.id, itemCategoryId: dairy.id });
    expect((await get(r.id)).status.applied).toBe(false);
    await s.call("update_item_category", { book, id: dairy.id, budgetCategoryId: food });
    const after = await get(r.id);
    expect(after.status.applied).toBe(true);
    expect(after.autoApplied).toBe(true);
    expect(await spent(food)).toBe(-500);
  });

  it("re-applies a receipt it applied when a later edit changes the split", async () => {
    const tx = await spend(1000);
    const { receipt: r } = await receipt(1000, { payments: [{ transactionId: tx.id }] });
    expect(await spent(general)).toBe(-300);
    const edited = await s.call("update_receipt_line", {
      book,
      id: r.lines[1].id,
      budgetCategoryId: bills,
    });
    expect(edited.status.applied).toBe(true);
    expect(await spent(general)).toBe(0);
    expect(await spent(bills)).toBe(-300);
  });

  it("undoes the triggering write and the apply in one step", async () => {
    const tx = await spend(1000);
    const { receipt: r } = await receipt(1000, {
      lines: [{ text: "Mystery", lineTotal: 1000 }],
      payments: [{ transactionId: tx.id }],
    });
    await s.call("update_receipt_line", { book, id: r.lines[0].id, budgetCategoryId: bills });
    expect(await spent(bills)).toBe(-1000);
    await s.call("undo", { book });
    const undone = await get(r.id);
    expect(undone.lines[0].budgetCategoryId).toBe(null);
    expect(undone.status.applied).toBe(false);
    expect(await spent(bills)).toBe(0);
    await s.call("redo", { book });
    expect((await get(r.id)).status.applied).toBe(true);
    expect(await spent(bills)).toBe(-1000);
  });
});

describe("with autoApplyReceipts on, nothing applies", () => {
  beforeEach(turnOn);

  it("while a receipt is unbalanced, uncategorized or unpaid", async () => {
    const one = await spend(1000);
    const unbalanced = await receipt(1000, {
      lines: [{ text: "Apples", lineTotal: 900, budgetCategoryId: food }],
      payments: [{ transactionId: one.id }],
    });
    expect(unbalanced.receipt.status.applied).toBe(false);
    const two = await spend(800, "2026-10-12");
    const uncategorized = await receipt(800, {
      date: "2026-10-12",
      lines: [{ text: "Mystery", lineTotal: 800 }],
      payments: [{ transactionId: two.id }],
    });
    expect(uncategorized.receipt.status.applied).toBe(false);
    const unpaid = await receipt(1000);
    expect(unpaid.receipt.status).toMatchObject({ matched: false, applied: false });
    expect(await spent(food)).toBe(0);
  });

  it("for a receipt paid by several transactions", async () => {
    const one = await spend(600);
    const two = await spend(400, "2026-10-11");
    const { receipt: r } = await receipt(1000, {
      payments: [
        { transactionId: one.id, amount: 600 },
        { transactionId: two.id, amount: 400 },
      ],
    });
    expect(r.status).toMatchObject({ matched: true, categorized: true, applied: false });
    expect(await spent(food)).toBe(0);
  });

  it("for a transaction that pays several receipts", async () => {
    const tx = await spend(2000);
    const { receipt: one } = await receipt(1000, {
      payments: [{ transactionId: tx.id, amount: 1000 }],
    });
    // Alone on the transaction it applies, the rest staying Uncategorized.
    expect(one.status.applied).toBe(true);
    expect(await spent(food)).toBe(-700);
    const { receipt: two } = await receipt(1000, {
      payments: [{ transactionId: tx.id, amount: 1000 }],
    });
    expect(two.status).toMatchObject({ matched: true, applied: false });
    expect((await get(one.id)).status.applied).toBe(false);
    expect(await spent(food)).toBe(-700);
  });

  it("where applying by hand would refuse, and the write still succeeds", async () => {
    const tx = await s.call("create_transaction", {
      book,
      account: checking,
      date: "2026-10-10",
      amount: -5000,
      payee: "Grocer",
      splits: [
        { category: general, amount: -2500 },
        { category: bills, amount: -2500 },
      ],
    });
    const { receipt: r } = await receipt(1000, { payments: [{ transactionId: tx.id }] });
    expect(r.status).toMatchObject({ matched: true, categorized: true, applied: false });
    expect(await spent(bills)).toBe(-2500);
  });

  it("over a transaction split by hand after the receipt was applied", async () => {
    const tx = await spend(1000);
    const { receipt: r } = await receipt(1000, { payments: [{ transactionId: tx.id }] });
    expect(r.autoApplied).toBe(true);
    await s.call("update_transaction", {
      book,
      id: tx.id,
      account: checking,
      splits: [
        { category: food, amount: -500 },
        { category: bills, amount: -500 },
      ],
    });
    const diverged = await get(r.id);
    expect(diverged.status.applied).toBe(false);
    expect(diverged.autoApplied).toBe(false);

    const edited = await s.call("update_receipt_line", {
      book,
      id: r.lines[1].id,
      budgetCategoryId: general,
      notes: "still Soap",
    });
    expect(edited.status.applied).toBe(false);
    expect(await spent(bills)).toBe(-500);
    expect(await spent(food)).toBe(-500);

    const applied = await s.call("apply_receipt_to_transaction", { book, id: r.id });
    expect(applied.receipt.status.applied).toBe(true);
    expect(applied.receipt.autoApplied).toBe(false);
    expect(await spent(bills)).toBe(0);
  });
});
