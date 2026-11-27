/** Tags: the `#words` of transaction notes, with a color and description (Actual's tags app). */
import { tagsIn } from "@reeve/contract/rules";
import type { Tag } from "./types.ts";
import { eq, inArray } from "drizzle-orm";
import { invalid, newId, notFound, type Book } from "../book.ts";
import * as t from "../db/schema.ts";

/** The distinct tags of a text: `#word` up to a space or `#`, not after a `#` (Actual's rule). */
export const extractTags = (text: string): Array<string> => [...new Set(tagsIn(text))];

/** Renames whole, unescaped, case-sensitive uses of a tag in notes. */
export const renameTagInNotes = (notes: string, from: string, to: string): string =>
  notes.replace(
    new RegExp(`(?<!#)#${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[\\s#]|$)`, "g"),
    () => `#${to}`,
  );

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const taggedNotes = (book: Book) =>
  book.client.prepare("SELECT id, notes FROM transactions WHERE notes LIKE '%#%'").all() as Array<{
    id: string;
    notes: string;
  }>;

const usage = (book: Book): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const { notes } of taggedNotes(book))
    for (const tag of extractTags(notes)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return counts;
};

export const listTags = (book: Book): Array<Tag> => {
  const counts = usage(book);
  return book.db
    .select()
    .from(t.tags)
    .all()
    .map((row) => ({ ...row, count: counts.get(row.tag) ?? 0 }))
    .sort((a, b) => collator.compare(a.tag, b.tag));
};

const tagOf = (book: Book, id: string): Tag => {
  const found = listTags(book).find((tag) => tag.id === id);
  return found ?? notFound("tag", id);
};

const validName = (name: string): string => {
  const trimmed = name.trim();
  // Any character but white space and '#', as a tag in notes can be.
  return /^[^#\s]+$/.test(trimmed) ? trimmed : invalid("Invalid tag name");
};

export const createTag = (
  book: Book,
  input: { tag: string; color?: string | null; description?: string | null },
): Tag => {
  const tag = validName(input.tag);
  const existing = book.db.select().from(t.tags).where(eq(t.tags.tag, tag)).get();
  const values = {
    color: input.color === undefined || input.color === null ? null : input.color.trim(),
    description: input.description ?? null,
  };
  if (existing !== undefined) {
    book.db.update(t.tags).set(values).where(eq(t.tags.id, existing.id)).run();
    return tagOf(book, existing.id);
  }
  const id = newId();
  book.db
    .insert(t.tags)
    .values({ id, tag, ...values })
    .run();
  return tagOf(book, id);
};

export const updateTag = (
  book: Book,
  input: {
    id: string;
    tag?: string;
    color?: string | null;
    description?: string | null;
    hidden?: boolean;
  },
): Tag => {
  const existing = tagOf(book, input.id);
  if (input.tag !== undefined) {
    const name = validName(input.tag);
    if (name !== existing.tag) {
      const taken = book.db.select().from(t.tags).where(eq(t.tags.tag, name)).get();
      if (taken !== undefined) invalid("A tag with that name already exists");
      book.db.update(t.tags).set({ tag: name }).where(eq(t.tags.id, input.id)).run();
      const update = book.client.prepare("UPDATE transactions SET notes = ? WHERE id = ?");
      for (const { id, notes } of taggedNotes(book)) {
        const renamed = renameTagInNotes(notes, existing.tag, name);
        if (renamed !== notes) update.run(renamed, id);
      }
    }
  }
  const change = {
    ...(input.color === undefined ? {} : { color: input.color }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.hidden === undefined ? {} : { hidden: input.hidden }),
  };
  if (Object.keys(change).length > 0)
    book.db.update(t.tags).set(change).where(eq(t.tags.id, input.id)).run();
  return tagOf(book, input.id);
};

export const deleteTags = (book: Book, ids: ReadonlyArray<string>) => {
  if (ids.length > 0)
    book.db
      .delete(t.tags)
      .where(inArray(t.tags.id, [...ids]))
      .run();
  return { deleted: [...ids] };
};

/** Adds every tag the notes use that is not listed yet. */
export const discoverTags = (book: Book): Array<Tag> => {
  const known = new Set(
    book.db
      .select({ tag: t.tags.tag })
      .from(t.tags)
      .all()
      .map((row) => row.tag),
  );
  for (const tag of usage(book).keys())
    if (!known.has(tag)) {
      book.db.insert(t.tags).values({ id: newId(), tag }).run();
      known.add(tag);
    }
  return listTags(book);
};
