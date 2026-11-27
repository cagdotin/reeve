import { vi, afterEach, beforeEach, describe, expect, it } from "vitest";

// Frozen behavior stays covered without enabling purchases in the product.
vi.mock("@reeve/contract/features", () => ({ FEATURES: { purchases: true } }));
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
let book: string;
let checking: string;
let card: string;
let food: string;
let general: string;
let bills: string;
beforeEach(async () => {
  s = scratch();
  book = (await s.call("create_book", { name: "Test" })).id;
  checking = (await s.call("create_account", { book, name: "Checking" })).id;
  card = (await s.call("create_account", { book, name: "Card", type: "liability" })).id;
  const groups = await s.call("list_categories", { book });
  const named = (name: string) => groups[0].categories.find((c: any) => c.name === name).id;
  food = named("Food");
  general = named("General");
  bills = named("Bills");
});
afterEach(() => s.dispose());

const spend = (amount: number, date: string, payee: string | null = "Grocer", account = checking) =>
  s.call("create_transaction", { book, account, date, amount: -amount, payee });

const receipt = (total: number, input: Record<string, unknown> = {}) =>
  s
    .call("create_receipt", {
      book,
      date: "2026-10-10",
      payee: "Grocer",
      total,
      lines: [{ text: "Item", lineTotal: total, budgetCategoryId: food }],
      ...input,
    })
    .then((result: any) => result);

describe("match suggestions", () => {
  it("ranks exact amounts, near days and the same payee, with reasons", async () => {
    const exact = await spend(4250, "2026-10-11");
    const later = await spend(4250, "2026-10-18", "Someone");
    const tip = await spend(5000, "2026-10-10");
    await spend(4250, "2026-10-01");
    await spend(4250, "2026-10-21");
    await spend(9999, "2026-10-10");
    const { suggestions } = await receipt(4250);
    expect(suggestions.map((each: any) => each.transactionId)).toEqual([
      exact.id,
      tip.id,
      later.id,
    ]);
    expect(suggestions[0]).toMatchObject({
      amountMatch: "exact",
      sure: true,
      days: 1,
      amount: -4250,
      account: "Checking",
    });
    expect(suggestions[0].reasons).toEqual(["same amount", "1 day after", "same payee"]);
    expect(suggestions[1]).toMatchObject({ amountMatch: "tip", sure: false });
    expect(suggestions[2].sure).toBe(false);
  });

  it("matches a payee by a similar name and on liability accounts", async () => {
    const tx = await spend(1000, "2026-10-10", "GROCER STORE #12", card);
    const { suggestions } = await receipt(1000);
    expect(suggestions[0]).toMatchObject({ transactionId: tx.id, sure: true });
    expect(suggestions[0].reasons).toContain("similar payee");
  });

  it("leaves out transactions other receipts fully claim", async () => {
    const tx = await spend(3000, "2026-10-10");
    await receipt(3000, { payments: [{ transactionId: tx.id }] });
    const other = await receipt(3000);
    expect(other.suggestions).toEqual([]);
    const shared = await spend(5000, "2026-10-10");
    await receipt(2000, { payments: [{ transactionId: shared.id }] });
    const rest = await receipt(3000);
    expect(rest.suggestions[0]).toMatchObject({
      transactionId: shared.id,
      claimed: 2000,
      amountMatch: "exact",
    });
  });

  it("ignores transfers between accounts", async () => {
    await s.call("create_transaction", {
      book,
      account: checking,
      date: "2026-10-10",
      amount: -1000,
      transferAccount: card,
    });
    expect((await receipt(1000)).suggestions).toEqual([]);
  });
});

describe("payments", () => {
  it("links and unlinks transactions, with the amount defaulting to what is left", async () => {
    const a = await spend(600, "2026-10-10");
    const b = await spend(900, "2026-10-10", "Grocer", card);
    const { receipt: r } = await receipt(1000);
    let next = await s.call("link_receipt_payment", { book, receipt: r.id, transaction: a.id });
    expect(next.payments).toEqual([
      expect.objectContaining({ transactionId: a.id, amount: 600, transactionAmount: -600 }),
    ]);
    expect(next.status).toMatchObject({ paidAmount: 600, matched: false });
    expect(next.warnings.map((w: any) => w.code)).toContain("unpaid");
    next = await s.call("link_receipt_payment", { book, receipt: r.id, transaction: b.id });
    expect(next.payments[1].amount).toBe(400);
    expect(next.status.matched).toBe(true);
    const of = await s.call("list_transaction_receipts", { book, transaction: b.id });
    expect(of).toEqual([expect.objectContaining({ id: r.id, paidByTransaction: 400 })]);
    const marks = await s.call("transactions_with_receipts", { book, account: card });
    expect(marks).toEqual([{ transactionId: b.id, receiptIds: [r.id], applied: false }]);
    next = await s.call("unlink_receipt_payment", { book, receipt: r.id, transaction: a.id });
    expect(next.status.paidAmount).toBe(400);
  });

  it("refuses more than the transaction has free, the wrong direction and transfers", async () => {
    const tx = await spend(500, "2026-10-10");
    const deposit = await s.call("create_transaction", {
      book,
      account: checking,
      date: "2026-10-10",
      amount: 500,
    });
    const { receipt: r } = await receipt(1000);
    expect(
      (
        await s.fails("link_receipt_payment", {
          book,
          receipt: r.id,
          transaction: tx.id,
          amount: 600,
        })
      )._tag,
    ).toBe("InvalidRequest");
    expect(
      (await s.fails("link_receipt_payment", { book, receipt: r.id, transaction: deposit.id }))
        ._tag,
    ).toBe("InvalidRequest");
  });

  it("drops the link when the transaction is deleted, and follows a merge", async () => {
    const tx = await spend(1000, "2026-10-10");
    const { receipt: r } = await receipt(1000, { payments: [{ transactionId: tx.id }] });
    const copy = await spend(1000, "2026-10-10");
    await s.call("merge_transactions", { book, keep: copy.id, drop: tx.id });
    let read = await s.call("get_receipt", { book, id: r.id });
    expect(read.payments.map((p: any) => p.transactionId)).toEqual([copy.id]);
    await s.call("delete_transactions", { book, ids: [copy.id] });
    read = await s.call("get_receipt", { book, id: r.id });
    expect(read.payments).toEqual([]);
    await s.call("undo", { book });
    read = await s.call("get_receipt", { book, id: r.id });
    expect(read.payments.map((p: any) => p.transactionId)).toEqual([copy.id]);
  });

  it("follows payees through a merge and survives their deletion", async () => {
    const { receipt: r } = await receipt(100, { payee: "GROCER LTD" });
    const target = await s.call("create_payee", { book, name: "Grocer Inc" });
    await s.call("merge_payees", { book, target: target.id, merge: [r.payeeId] });
    expect((await s.call("get_receipt", { book, id: r.id })).payee).toBe("Grocer Inc");
    await s.call("delete_payees", { book, ids: [target.id] });
    expect((await s.call("get_receipt", { book, id: r.id })).payeeId).toBeNull();
  });
});

describe("auto-match", () => {
  it("links unique sure candidates and reports the ambiguous ones", async () => {
    const sure = await spend(1234, "2026-10-11");
    const { receipt: one } = await receipt(1234);
    await spend(500, "2026-10-10");
    await spend(500, "2026-10-12");
    const { receipt: two } = await receipt(500);
    const shared = await spend(700, "2026-10-10");
    const { receipt: three } = await receipt(700);
    const { receipt: four } = await receipt(700, { date: "2026-10-09" });
    const { receipt: none } = await receipt(42);
    const result = await s.call("auto_match_receipts", { book });
    expect(result.linked).toEqual([{ receiptId: one.id, transactionId: sure.id, amount: 1234 }]);
    expect(new Set(result.ambiguous.map((each: any) => each.receiptId))).toEqual(
      new Set([two.id, three.id, four.id]),
    );
    expect(
      result.ambiguous.find((each: any) => each.receiptId === three.id).transactionIds,
    ).toEqual([shared.id]);
    expect(result.unmatched).toEqual([none.id]);
    expect((await s.call("get_receipt", { book, id: one.id })).status.matched).toBe(true);
  });
});

describe("applying a receipt", () => {
  const budgetSpent = async (category: string) => {
    const view = await s.call("get_budget", { book, month: "2026-10" });
    return view.months[0].categories.find((c: any) => c.id === category).spent;
  };

  it("splits the transaction by budget category, exact to the bank's amount, as one undo step", async () => {
    const tx = await spend(2345, "2026-10-11", "Grocer");
    const { receipt: r } = await receipt(2300, {
      lines: [
        { text: "Apples", lineTotal: 1000, budgetCategoryId: food },
        { text: "Soap", lineTotal: 700, budgetCategoryId: general },
        { text: "Bread", lineTotal: 333, budgetCategoryId: food },
        { text: "Battery", lineTotal: 100, budgetCategoryId: bills },
      ],
      adjustments: [{ kind: "tax", amount: 167 }],
      payments: [{ transactionId: tx.id }],
    });
    expect(r.status).toMatchObject({
      balanced: true,
      matched: true,
      categorized: true,
      applied: false,
    });
    const preview = await s.call("receipt_split_preview", { book, id: r.id });
    expect(preview).toMatchObject({ amount: -2345, spread: true, remainder: null, applied: false });
    expect(preview.splits.reduce((sum: number, split: any) => sum + split.amount, 0)).toBe(-2345);
    expect(preview.splits.map((split: any) => [split.category, split.amount])).toEqual([
      ["Food", -1465],
      ["General", -770],
      ["Bills", -110],
    ]);
    const result = await s.call("apply_receipt_to_transaction", { book, id: r.id });
    expect(result.receipt.status.applied).toBe(true);
    expect(result.receipt.payments[0].applied).toBe(true);
    expect(await budgetSpent(food)).toBe(-1465);
    expect(await budgetSpent(general)).toBe(-770);
    expect((await s.call("transactions_with_receipts", { book }))[0].applied).toBe(true);
    const again = await s.call("apply_receipt_to_transaction", { book, id: r.id });
    expect(again.transactions[0].postings).toEqual(
      result.transactions[0].postings.map((p: any) => ({ ...p, id: expect.any(String) })),
    );
    await s.call("undo", { book });
    await s.call("undo", { book });
    expect(await budgetSpent(food)).toBe(0);
    expect((await s.call("get_receipt", { book, id: r.id })).status.applied).toBe(false);
  });

  it("refuses when lines have no budget category, naming them", async () => {
    const tx = await spend(500, "2026-10-10");
    const { receipt: r } = await receipt(500, {
      lines: [{ text: "Mystery", lineTotal: 500 }],
      payments: [{ transactionId: tx.id }],
    });
    const error = await s.fails("apply_receipt_to_transaction", { book, id: r.id });
    expect(error._tag).toBe("InvalidRequest");
    expect(error.message).toContain('"Mystery"');
  });

  it("keeps money not on the receipt on the transaction's category", async () => {
    const tx = await s.call("create_transaction", {
      book,
      account: checking,
      date: "2026-10-10",
      amount: -10000,
      payee: "Grocer",
      category: general,
    });
    const { receipt: r } = await receipt(4000, { payments: [{ transactionId: tx.id }] });
    const result = await s.call("apply_receipt_to_transaction", { book, id: r.id });
    expect(result.receipt.status.applied).toBe(true);
    const preview = await s.call("receipt_split_preview", { book, id: r.id });
    expect(preview.remainder).toEqual({ amount: -6000, categoryId: general });
    expect(await budgetSpent(general)).toBe(-6000);
    expect(await budgetSpent(food)).toBe(-4000);
    await s.call("update_receipt_line", { book, id: r.lines[0].id, budgetCategoryId: bills });
    expect((await s.call("get_receipt", { book, id: r.id })).status.applied).toBe(false);
    await s.call("apply_receipt_to_transaction", { book, id: r.id });
    expect(await budgetSpent(general)).toBe(-6000);
    expect(await budgetSpent(bills)).toBe(-4000);
  });

  it("links a named transaction first and applies a refund", async () => {
    const refund = await s.call("create_transaction", {
      book,
      account: checking,
      date: "2026-10-12",
      amount: 1500,
      payee: "Grocer",
    });
    const { receipt: r } = await receipt(-1500, {
      lines: [{ text: "Returned kettle", lineTotal: -1500, budgetCategoryId: general }],
    });
    const result = await s.call("apply_receipt_to_transaction", {
      book,
      id: r.id,
      transaction: refund.id,
    });
    expect(result.receipt.status).toMatchObject({ matched: true, applied: true });
    expect(await budgetSpent(general)).toBe(1500);
  });

  it("splits one transaction that pays two receipts", async () => {
    const tx = await spend(3000, "2026-10-10");
    await receipt(1000, { payments: [{ transactionId: tx.id }] });
    const { receipt: two } = await receipt(2000, {
      lines: [{ text: "Lamp", lineTotal: 2000, budgetCategoryId: general }],
      payments: [{ transactionId: tx.id }],
    });
    const preview = await s.call("receipt_split_preview", { book, id: two.id });
    expect(preview.splits.map((split: any) => [split.category, split.amount])).toEqual([
      ["Food", -1000],
      ["General", -2000],
    ]);
  });
});
