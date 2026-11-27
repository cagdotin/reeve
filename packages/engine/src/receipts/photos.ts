/**
 * Receipt photos are plain files, `<home>/receipts/<book>/<receipt>/<n>-<name>.<ext>`, with a
 * `receipt_photos` row each (docs/rules/purchases.md). A deleted photo or receipt folder moves to the book's
 * `.trash/` until no undo step can bring its rows back, so undo restores the files too.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { asc, eq, sql } from "drizzle-orm";
import { invalid, newId, notFound, type Book } from "../book.ts";
import { homeOfBook, receiptsDir } from "../home.ts";
import * as r from "./schema.ts";
import type { ReceiptPhoto } from "./types.ts";

type PhotoRow = typeof r.receiptPhotos.$inferSelect;

const TRASH = ".trash";
const MAX_BYTES = 50 * 1024 * 1024;
/** get_receipt_photo gives bytes inline only up to this size. */
export const INLINE_BYTES = 5 * 1024 * 1024;

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".pdf": "application/pdf",
};

const EXTENSIONS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(MIME_TYPES).map(([extension, mime]) => [mime, extension]),
);

export const bookPhotosDir = (book: Book) => receiptsDir(homeOfBook(book.file), book.id);
const receiptDir = (book: Book, receiptId: string) => join(bookPhotosDir(book), receiptId);
const trashDir = (book: Book, receiptId: string) => join(bookPhotosDir(book), TRASH, receiptId);

/** Where a photo's file is; one that undo brought back is moved back out of the trash first. */
const photoFile = (book: Book, row: PhotoRow): string => {
  const file = join(receiptDir(book, row.receiptId), row.fileName);
  const trashed = join(trashDir(book, row.receiptId), row.fileName);
  if (!existsSync(file) && existsSync(trashed)) {
    mkdirSync(receiptDir(book, row.receiptId), { recursive: true });
    renameSync(trashed, file);
  }
  return file;
};

/** Recover live files after undo, even when purchase reads are unavailable. */
export const restorePhotoFiles = (book: Book): void => {
  if (!existsSync(join(bookPhotosDir(book), TRASH))) return;
  for (const row of book.db.select().from(r.receiptPhotos).all()) photoFile(book, row);
};

export const photoView = (book: Book, row: PhotoRow): ReceiptPhoto => {
  const path = photoFile(book, row);
  return {
    id: row.id,
    receiptId: row.receiptId,
    position: row.position,
    fileName: row.fileName,
    mimeType: row.mimeType,
    size: row.size,
    sha256: row.sha256,
    path,
    exists: existsSync(path),
  };
};

export const photoRow = (book: Book, id: string): PhotoRow =>
  book.db.select().from(r.receiptPhotos).where(eq(r.receiptPhotos.id, id)).get() ??
  notFound("receipt photo", id);

export const listPhotos = (book: Book, receiptId: string): Array<ReceiptPhoto> =>
  book.db
    .select()
    .from(r.receiptPhotos)
    .where(eq(r.receiptPhotos.receiptId, receiptId))
    .orderBy(asc(r.receiptPhotos.position))
    .all()
    .map((row) => photoView(book, row));

const slug = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "photo";

export const attachPhoto = (
  book: Book,
  input: {
    readonly receipt: string;
    readonly path?: string;
    readonly content?: string;
    readonly fileName?: string;
    readonly mimeType?: string;
  },
): ReceiptPhoto => {
  let bytes: Buffer;
  let name: string;
  if (input.path !== undefined) {
    if (input.content !== undefined) invalid("Give a path or content, not both");
    const path = resolve(input.path);
    if (!existsSync(path) || !statSync(path).isFile()) invalid(`${path} is not a file`);
    if (statSync(path).size > MAX_BYTES) invalid("A photo may be at most 50 MB");
    bytes = readFileSync(path);
    name = input.fileName ?? basename(path);
  } else if (input.content !== undefined) {
    if (input.fileName === undefined && input.mimeType === undefined)
      invalid("Name the content with fileName or mimeType");
    bytes = Buffer.from(input.content, "base64");
    name = input.fileName ?? "photo";
  } else return invalid("Give a path or base64 content");
  if (bytes.length === 0) invalid("The photo is empty");
  if (bytes.length > MAX_BYTES) invalid("A photo may be at most 50 MB");
  const extension = extname(name).toLowerCase();
  const mimeType = input.mimeType ?? MIME_TYPES[extension];
  if (mimeType === undefined)
    return invalid(`Unknown kind of file ${name}: give mimeType (an image or a PDF)`);
  if (!mimeType.startsWith("image/") && mimeType !== "application/pdf")
    invalid("A receipt photo is an image or a PDF");
  const position =
    (book.db
      .select({ max: sql<number | null>`max(${r.receiptPhotos.position})` })
      .from(r.receiptPhotos)
      .where(eq(r.receiptPhotos.receiptId, input.receipt))
      .get()?.max ?? 0) + 1;
  const folder = receiptDir(book, input.receipt);
  mkdirSync(folder, { recursive: true });
  const stem = `${position}-${slug(basename(name, extname(name)))}`;
  const suffix = MIME_TYPES[extension] === undefined ? (EXTENSIONS[mimeType] ?? "") : extension;
  let fileName = `${stem}${suffix}`;
  for (let n = 2; existsSync(join(folder, fileName)); n++) fileName = `${stem}-${n}${suffix}`;
  const id = newId();
  book.db
    .insert(r.receiptPhotos)
    .values({
      id,
      receiptId: input.receipt,
      position,
      fileName,
      mimeType,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      createdAt: Date.now(),
    })
    .run();
  writeFileSync(join(folder, fileName), bytes);
  return photoView(book, photoRow(book, id));
};

/**
 * Tidies the trash: files whose rows are back (undone) return to their folder, and a folder whose
 * receipt no undo or redo step mentions any more is removed.
 */
const pruneTrash = (book: Book) => {
  const trash = join(bookPhotosDir(book), TRASH);
  if (!existsSync(trash)) return;
  const mentions = book.client.prepare(
    "SELECT 1 FROM undo_log WHERE instr(statement, ?) > 0 LIMIT 1",
  );
  for (const receiptId of readdirSync(trash)) {
    for (const row of book.db
      .select()
      .from(r.receiptPhotos)
      .where(eq(r.receiptPhotos.receiptId, receiptId))
      .all())
      photoFile(book, row);
    if (mentions.get(receiptId) === undefined)
      rmSync(join(trash, receiptId), { recursive: true, force: true });
  }
};

const moveToTrash = (book: Book, receiptId: string, fileName: string) => {
  const file = join(receiptDir(book, receiptId), fileName);
  if (!existsSync(file)) return;
  mkdirSync(trashDir(book, receiptId), { recursive: true });
  renameSync(file, join(trashDir(book, receiptId), fileName));
};

export const deletePhoto = (book: Book, id: string) => {
  const row = photoRow(book, id);
  book.db.delete(r.receiptPhotos).where(eq(r.receiptPhotos.id, id)).run();
  moveToTrash(book, row.receiptId, row.fileName);
  pruneTrash(book);
  return { deleted: id };
};

/** Moves a deleted receipt's folder out of the way; called after its rows are deleted. */
export const trashReceiptFolder = (book: Book, receiptId: string) => {
  const folder = receiptDir(book, receiptId);
  if (existsSync(folder)) {
    for (const name of readdirSync(folder)) moveToTrash(book, receiptId, name);
    rmSync(folder, { recursive: true, force: true });
  }
  pruneTrash(book);
};

/** The photo's file and, when asked and small enough, its bytes as base64. */
export const photoContent = (book: Book, id: string, content: boolean) => {
  const photo = photoView(book, photoRow(book, id));
  if (!content) return { ...photo, content: null };
  if (!photo.exists) return invalid(`The file ${photo.path} is missing`);
  if (photo.size > INLINE_BYTES) invalid("The photo is over 5 MB: read it from path");
  return { ...photo, content: readFileSync(photo.path).toString("base64") };
};
