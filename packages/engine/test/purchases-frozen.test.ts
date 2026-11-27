import { receipts } from "@reeve/contract/catalog";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scratch } from "./helpers.ts";

const features = vi.hoisted(() => ({ purchases: false }));
vi.mock("@reeve/contract/features", () => ({ FEATURES: features }));

let s: ReturnType<typeof scratch>;
beforeEach(() => {
  s = scratch();
});
afterEach(async () => {
  features.purchases = false;
  await s.dispose();
});

/** Simulates an older enabled book through its original operations, never a real home. */
const legacy = async () => {
  features.purchases = true;
  try {
    const book = (await s.call("create_book", { name: "Before the freeze" })).id;
    const account = (await s.call("create_account", { book, name: "Checking", balance: 10000 })).id;
    const groups = await s.call("list_categories", { book });
    const [food, other] = groups.find((group: { isIncome: boolean }) => !group.isIncome).categories;
    const payee = (await s.call("create_payee", { book, name: "Grocer" })).id;
    const transaction = (
      await s.call("create_transaction", {
        book,
        account,
        date: "2026-01-02",
        amount: -1000,
        payee: "Grocer",
      })
    ).id;
    const { receipt } = await s.call("create_receipt", {
      book,
      date: "2026-01-02",
      payeeId: payee,
      total: 1000,
      lines: [{ text: "Apples", lineTotal: 1000, budgetCategoryId: food.id }],
      payments: [{ transactionId: transaction }],
    });
    await s.call("apply_receipt_to_transaction", { book, id: receipt.id });
    await s.call("update_book", { book, autoApplyReceipts: true });
    const file = (await s.call("get_book", { book })).file;
    return {
      book,
      account,
      food: food.id,
      other: other.id,
      payee,
      transaction,
      receipt: receipt.id,
      file,
    };
  } finally {
    features.purchases = false;
  }
};

const rows = (file: string, table: string) => {
  const db = new DatabaseSync(file);
  try {
    return db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
  } finally {
    db.close();
  }
};

describe("existing purchase data while the feature is frozen", () => {
  it("rejects every frozen operation before creating a default book", async () => {
    for (const name of Object.keys(receipts))
      expect({ name, tag: (await s.fails(name))._tag }).toEqual({ name, tag: "InvalidRequest" });
    expect(existsSync(join(s.home, "books"))).toBe(false);
  });

  it("keeps applied money and stored settings, and still protects it from automatic recategorization", async () => {
    const old = await legacy();
    const before = await s.call("get_transaction", { book: old.book, id: old.transaction });
    const postings = rows(old.file, "postings");
    expect((await s.call("get_book", { book: old.book })).settings.autoApplyReceipts).toBe(true);
    const rule = await s.call("create_rule", {
      book: old.book,
      conditions: [{ field: "payee", op: "is", value: old.payee }],
      actions: [{ op: "set", field: "category", value: old.other }],
    });
    expect(rule.recategorized).toEqual([]);
    expect(await s.call("get_transaction", { book: old.book, id: old.transaction })).toEqual(
      before,
    );
    expect(rows(old.file, "postings")).toEqual(postings);
    expect((await s.fails("update_book", { book: old.book, autoApplyReceipts: false }))._tag).toBe(
      "InvalidRequest",
    );
  });

  it("maintains legacy merge and category references with undo and redo", async () => {
    const old = await legacy();
    const nextPayee = (await s.call("create_payee", { book: old.book, name: "New grocer" })).id;
    await s.call("merge_payees", { book: old.book, target: nextPayee, merge: [old.payee] });
    expect(rows(old.file, "receipts")[0]!.payee_id).toBe(nextPayee);
    await s.call("undo", { book: old.book });
    expect(rows(old.file, "receipts")[0]!.payee_id).toBe(old.payee);
    await s.call("redo", { book: old.book });
    expect(rows(old.file, "receipts")[0]!.payee_id).toBe(nextPayee);
    await s.call("delete_category", { book: old.book, id: old.food, transferCategory: old.other });
    expect(rows(old.file, "receipt_lines")[0]!.budget_category_id).toBe(old.other);
    const duplicate = await s.call("duplicate_transactions", {
      book: old.book,
      ids: [old.transaction],
    });
    const duplicateId = duplicate[0].id;
    await s.call("merge_transactions", {
      book: old.book,
      keep: duplicateId,
      drop: old.transaction,
    });
    expect(rows(old.file, "receipt_payments")[0]!.transaction_id).toBe(duplicateId);
    await s.call("undo", { book: old.book });
    expect(rows(old.file, "receipt_payments")[0]!.transaction_id).toBe(old.transaction);
  });

  it("backs up and restores legacy rows, photos and ordinary ledger splits while disabled", async () => {
    const old = await legacy();
    const folder = mkdtempSync(join(tmpdir(), "reeve-frozen-backup-"));
    try {
      const image = join(folder, "photo.png");
      writeFileSync(image, Buffer.from("89504e470d0a1a0a", "hex"));
      features.purchases = true;
      const photo = await s.call("attach_receipt_photo", {
        book: old.book,
        receipt: old.receipt,
        path: image,
      });
      await s.call("delete_receipt_photo", { book: old.book, id: photo.id });
      features.purchases = false;
      expect(existsSync(photo.path)).toBe(false);
      await s.call("undo", { book: old.book });
      expect(readFileSync(photo.path)).toEqual(readFileSync(image));
      await s.call("redo", { book: old.book });
      expect(rows(old.file, "receipt_photos")).toEqual([]);
      await s.call("undo", { book: old.book });
      // Older versions restored files lazily on receipt reads; those reads are now disabled.
      renameSync(
        photo.path,
        join(s.home, "receipts", old.book, ".trash", old.receipt, photo.fileName),
      );
      const backup = await s.call("export_book", {
        book: old.book,
        path: join(folder, "book.sqlite"),
      });
      expect(backup.photos).not.toBeNull();
      const restored = await s.call("restore_book", {
        path: backup.path,
        name: "Restored while frozen",
      });
      const restoredBook = await s.call("get_book", { book: restored.id });
      for (const table of [
        "receipts",
        "receipt_lines",
        "receipt_payments",
        "receipt_photos",
        "postings",
      ])
        expect(rows(restoredBook.file, table)).toEqual(rows(old.file, table));
      expect(await s.call("get_transaction", { book: restored.id, id: old.transaction })).toEqual(
        await s.call("get_transaction", { book: old.book, id: old.transaction }),
      );
      expect(
        readFileSync(join(s.home, "receipts", restored.id, old.receipt, photo.fileName)),
      ).toEqual(readFileSync(image));
    } finally {
      features.purchases = false;
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
