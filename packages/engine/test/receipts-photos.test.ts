import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi, afterEach, beforeEach, describe, expect, it } from "vitest";

// Frozen behavior stays covered without enabling purchases in the product.
vi.mock("@reeve/contract/features", () => ({ FEATURES: { purchases: true } }));
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
let book: string;
let folder: string;
let receipt: string;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

beforeEach(async () => {
  s = scratch();
  folder = mkdtempSync(join(tmpdir(), "reeve-photos-"));
  book = (await s.call("create_book", { name: "Test" })).id;
  receipt = (
    await s.call("create_receipt", { book, date: "2026-10-10", payee: "Grocer", total: 100 })
  ).receipt.id;
});
afterEach(async () => {
  await s.dispose();
  rmSync(folder, { recursive: true, force: true });
});

const receiptFolder = () => join(s.home, "receipts", book, receipt);

describe("receipt photos", () => {
  it("copies a file into the receipts folder and lists it", async () => {
    const source = join(folder, "IMG 0001.JPG");
    writeFileSync(source, JPEG);
    const photo = await s.call("attach_receipt_photo", { book, receipt, path: source });
    expect(photo).toMatchObject({
      receiptId: receipt,
      position: 1,
      fileName: "1-img-0001.jpg",
      mimeType: "image/jpeg",
      size: JPEG.length,
      sha256: createHash("sha256").update(JPEG).digest("hex"),
      path: join(receiptFolder(), "1-img-0001.jpg"),
      exists: true,
    });
    expect(readFileSync(photo.path)).toEqual(JPEG);
    const second = await s.call("attach_receipt_photo", {
      book,
      receipt,
      content: Buffer.from("%PDF-1.4").toString("base64"),
      fileName: "scan.pdf",
    });
    expect(second).toMatchObject({
      position: 2,
      fileName: "2-scan.pdf",
      mimeType: "application/pdf",
    });
    expect((await s.call("list_receipt_photos", { book, receipt })).map((p: any) => p.id)).toEqual([
      photo.id,
      second.id,
    ]);
    expect((await s.call("get_receipt", { book, id: receipt })).photos).toHaveLength(2);
    const read = await s.call("get_receipt_photo", { book, id: photo.id, content: true });
    expect(Buffer.from(read.content, "base64")).toEqual(JPEG);
    expect((await s.call("get_receipt_photo", { book, id: photo.id })).content).toBeNull();
    expect((await s.call("list_receipts", { book })).receipts[0].photoCount).toBe(2);
  });

  it("refuses what is not an image or a PDF", async () => {
    const source = join(folder, "notes.txt");
    writeFileSync(source, "hello");
    expect((await s.fails("attach_receipt_photo", { book, receipt, path: source }))._tag).toBe(
      "InvalidRequest",
    );
    expect((await s.fails("attach_receipt_photo", { book, receipt }))._tag).toBe("InvalidRequest");
    expect(
      (
        await s.fails("attach_receipt_photo", {
          book,
          receipt: "nope",
          content: "AA==",
          fileName: "a.png",
        })
      )._tag,
    ).toBe("NotFound");
  });

  it("deletes a photo's file, and undo brings it back", async () => {
    const photo = await s.call("attach_receipt_photo", {
      book,
      receipt,
      content: JPEG.toString("base64"),
      fileName: "a.jpg",
    });
    await s.call("delete_receipt_photo", { book, id: photo.id });
    expect(existsSync(photo.path)).toBe(false);
    expect(await s.call("list_receipt_photos", { book, receipt })).toEqual([]);
    await s.call("undo", { book });
    const [restored] = await s.call("list_receipt_photos", { book, receipt });
    expect(restored).toMatchObject({ id: photo.id, exists: true });
    expect(readFileSync(photo.path)).toEqual(JPEG);
  });

  it("deletes a receipt's folder with it, and undo restores it", async () => {
    const photo = await s.call("attach_receipt_photo", {
      book,
      receipt,
      content: JPEG.toString("base64"),
      fileName: "a.jpg",
    });
    await s.call("delete_receipt", { book, id: receipt });
    expect(existsSync(receiptFolder())).toBe(false);
    await s.call("undo", { book });
    const read = await s.call("get_receipt", { book, id: receipt });
    expect(read.photos[0]).toMatchObject({ id: photo.id, exists: true });
  });

  it("forgets a deleted receipt's photos once undo can no longer bring them back", async () => {
    await s.call("attach_receipt_photo", {
      book,
      receipt,
      content: JPEG.toString("base64"),
      fileName: "a.jpg",
    });
    await s.call("delete_receipt", { book, id: receipt });
    const trash = join(s.home, "receipts", book, ".trash");
    expect(readdirSync(trash)).toEqual([receipt]);
    // Undo remembers 100 steps; after more, nothing can bring the receipt back.
    for (let n = 0; n < 100; n++)
      await s.call("set_note", { book, id: "budget-2026-01", note: `note ${n}` });
    const other = (await s.call("create_receipt", { book, date: "2026-10-11", total: 1 })).receipt
      .id;
    await s.call("delete_receipt", { book, id: other });
    expect(existsSync(join(trash, receipt))).toBe(false);
  });

  it("removes a book's receipts folder with the book", async () => {
    await s.call("attach_receipt_photo", {
      book,
      receipt,
      content: JPEG.toString("base64"),
      fileName: "a.jpg",
    });
    expect(existsSync(join(s.home, "receipts", book))).toBe(true);
    await s.call("delete_book", { id: book });
    expect(existsSync(join(s.home, "receipts", book))).toBe(false);
  });

  it("exports photos beside a backup and restores them", async () => {
    const photo = await s.call("attach_receipt_photo", {
      book,
      receipt,
      content: JPEG.toString("base64"),
      fileName: "a.jpg",
    });
    const path = join(folder, "backup.sqlite");
    const exported = await s.call("export_book", { book, path });
    expect(exported.photos).toBe(`${path}.receipts`);
    expect(readFileSync(join(`${path}.receipts`, receipt, photo.fileName))).toEqual(JPEG);
    const restored = await s.call("restore_book", { path, name: "Restored" });
    const [copy] = await s.call("list_receipt_photos", { book: restored.id, receipt });
    expect(copy).toMatchObject({
      exists: true,
      path: join(s.home, "receipts", restored.id, receipt, photo.fileName),
    });
    expect((await s.fails("export_book", { book, path }))._tag).toBe("InvalidRequest");
    const empty = (await s.call("create_book", { name: "Empty" })).id;
    expect(
      (await s.call("export_book", { book: empty, path: join(folder, "empty.sqlite") })).photos,
    ).toBeNull();
  });
});
