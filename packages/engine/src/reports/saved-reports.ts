import { Schema } from "effect";
import {
  SavedReportDefinition,
  type SavedReport,
  type SavedReportInfo,
} from "@reeve/contract/catalog";
import { asc, eq, inArray } from "drizzle-orm";
import { invalid, newId, notFound, type Book } from "../book.ts";
import * as t from "../db/schema.ts";
import { DEFAULT_DEFINITION } from "./custom.ts";
import {
  frozenContent,
  recordOf,
  reportLabels,
  same,
  validateDefinition,
} from "./widget-config.ts";

export const readableDefinition = (value: unknown): SavedReportDefinition | undefined => {
  try {
    if (typeof value === "string") value = JSON.parse(value);
    const parsed = Schema.decodeUnknownSync(SavedReportDefinition)(value, {
      onExcessProperty: "error",
    });
    return frozenContent(parsed.type, value) ? undefined : parsed;
  } catch {
    return undefined;
  }
};

type StoredReport = { id: string; name: string; createdAt: number; definition: string };
const descriptor = (row: StoredReport): SavedReportInfo | undefined => {
  if (frozenContent("", row.definition)) return undefined;
  const definition = readableDefinition(row.definition);
  const { definition: raw, ...identity } = row;
  if (definition !== undefined) return { ...identity, definition };
  let value: Record<string, unknown> = {};
  try {
    value = recordOf(JSON.parse(raw));
  } catch {
    /* Invalid JSON remains unavailable. */
  }
  const unsupported =
    (value.version !== undefined && value.version !== 1) ||
    (typeof value.type === "string" && !Object.hasOwn(reportLabels, value.type));
  return { ...identity, availability: unsupported ? "unsupported" : "invalid-config" };
};

export const savedReportInfo = (book: Book, id: string): SavedReportInfo => {
  const row = book.client
    .prepare(
      "SELECT id, name, created_at AS createdAt, definition FROM custom_reports WHERE id = ?",
    )
    .get(id) as StoredReport | undefined;
  const info = row === undefined ? undefined : descriptor(row);
  return info ?? notFound("saved report", id);
};

export const savedReportOf = (book: Book, id: string): SavedReport => {
  const info = savedReportInfo(book, id);
  return "definition" in info ? info : invalid("Saved report is unavailable");
};

export const listSavedReports = (book: Book): Array<SavedReportInfo> =>
  (
    book.client
      .prepare("SELECT id, name, created_at AS createdAt, definition FROM custom_reports")
      .all() as Array<StoredReport>
  )
    .flatMap((row) => {
      const info = descriptor(row);
      return info === undefined ? [] : [info];
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

const checkedName = (book: Book, value: string, id?: string): string => {
  const name = value.trim();
  if (name === "") invalid("A report needs a name");
  const taken = book.db
    .select({ id: t.customReports.id, name: t.customReports.name })
    .from(t.customReports)
    .all()
    .some((row) => row.id !== id && row.name.trim() === name);
  if (taken) invalid(`There is already a report named ${name}`);
  return name;
};

export const createSavedReport = (
  book: Book,
  input: { name: string; definition: SavedReportDefinition },
): SavedReport => {
  const name = checkedName(book, input.name);
  const definition = validateDefinition(book, input.definition);
  const stored =
    definition.type === "custom"
      ? { ...definition, settings: { ...DEFAULT_DEFINITION(), ...definition.settings } }
      : definition;
  const id = newId();
  book.db
    .insert(t.customReports)
    .values({ id, name, definition: stored, createdAt: Date.now() })
    .run();
  return savedReportOf(book, id);
};

export const updateSavedReport = (
  book: Book,
  input: {
    id: string;
    name?: string;
    settings?: unknown;
    scope?: SavedReportDefinition["scope"];
  },
): SavedReport => {
  const current = savedReportOf(book, input.id);
  const name = input.name === undefined ? current.name : checkedName(book, input.name, input.id);
  const definition = validateDefinition(book, {
    ...current.definition,
    settings: input.settings ?? current.definition.settings,
    scope: input.scope ?? current.definition.scope,
  });
  if (name !== current.name || !same(definition, current.definition))
    book.db
      .update(t.customReports)
      .set({ name, definition })
      .where(eq(t.customReports.id, input.id))
      .run();
  return savedReportOf(book, input.id);
};

export const duplicateSavedReport = (
  book: Book,
  input: { id: string; name: string },
): SavedReport =>
  createSavedReport(book, {
    name: input.name,
    definition: savedReportOf(book, input.id).definition,
  });

export const savedReportUsage = (book: Book, id: string) => {
  const report = savedReportInfo(book, id);
  const placements = book.db
    .select({
      id: t.widgets.id,
      pageId: t.widgets.pageId,
      host: t.dashboardPages.host,
      pageName: t.dashboardPages.name,
      config: t.widgets.config,
      type: t.widgets.type,
      meta: t.widgets.meta,
    })
    .from(t.widgets)
    .innerJoin(t.dashboardPages, eq(t.widgets.pageId, t.dashboardPages.id))
    .where(eq(t.widgets.reportId, id))
    .orderBy(asc(t.widgets.pageId), asc(t.widgets.id))
    .all();
  return {
    reportId: id,
    placements: placements.map(({ config, type, meta, ...placement }) => ({
      ...placement,
      title: frozenContent(type, meta)
        ? "Unavailable widget"
        : config !== null &&
            typeof config === "object" &&
            "title" in config &&
            typeof config.title === "string"
          ? config.title
          : report.name,
    })),
  };
};

export const deleteSavedReport = (
  book: Book,
  input: { id: string; expectedPlacementIds: ReadonlyArray<string> },
) => {
  const usage = savedReportUsage(book, input.id);
  const actual = usage.placements.map((p) => p.id).sort();
  const expected = [...input.expectedPlacementIds].sort();
  if (!same(actual, expected)) invalid("Report usage changed. Review usage again before deleting.");
  if (actual.length > 0) book.db.delete(t.widgets).where(inArray(t.widgets.id, actual)).run();
  book.db.delete(t.customReports).where(eq(t.customReports.id, input.id)).run();
  return { deleted: input.id };
};
