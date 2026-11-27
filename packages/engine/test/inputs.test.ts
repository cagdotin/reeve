import { vi, afterEach, beforeEach, describe, expect, it } from "vitest";

// Frozen behavior stays covered without enabling purchases in the product.
vi.mock("@reeve/contract/features", () => ({ FEATURES: { purchases: true } }));
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
let book: string;
beforeEach(async () => {
  s = scratch();
  book = (await s.call("create_book", { name: "Test" })).id;
});
afterEach(() => s.dispose());

const receipts = async () => (await s.call("list_receipts", { book })).receipts;

describe("operation inputs", () => {
  it("rejects a field the input does not know, naming it", async () => {
    const error = await s.fails("create_receipt", {
      book,
      date: "2026-10-10",
      total: 100,
      store: "Grocer",
    });
    expect(error._tag).toBe("InvalidRequest");
    expect(error.message).toContain("Expected no excess property");
    expect(error.message).toContain(`["store"]`);
    expect(await receipts()).toEqual([]);
  });

  it("rejects an unknown field inside a nested struct, with its path", async () => {
    const error = await s.fails("create_receipt", {
      book,
      date: "2026-10-10",
      total: 100,
      payee: "Grocer",
      lines: [{ text: "MILK", lineTotal: 100, price: 100 }],
    });
    expect(error._tag).toBe("InvalidRequest");
    expect(error.message).toContain(`["lines"][0]["price"]`);
    expect(await receipts()).toEqual([]);
  });

  it("names every unknown field at once", async () => {
    const error = await s.fails("create_account", { book, name: "Checking", kind: "x", typ: "y" });
    expect(error.message).toContain(`["kind"]`);
    expect(error.message).toContain(`["typ"]`);
  });

  it("rejects unknown fields in operations outside a book", async () => {
    const error = await s.fails("create_book", { name: "Other", title: "Other" });
    expect(error._tag).toBe("InvalidRequest");
    expect(error.message).toContain(`["title"]`);
    expect((await s.call("list_books")).map((each: any) => each.name)).toEqual(["Test"]);
  });

  it("still takes the fields it knows", async () => {
    const { receipt } = await s.call("create_receipt", {
      book,
      date: "2026-10-10",
      total: 100,
      payee: "Grocer",
      lines: [{ text: "MILK", lineTotal: 100 }],
    });
    expect(receipt.payee).toBe("Grocer");
  });
});
