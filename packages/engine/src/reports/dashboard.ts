import type { CustomReport, DashboardPage, PageHost, PageWidgets, Widget } from "./types.ts";
import {
  SavedReportDefinition,
  localWidgetSettings,
  type WidgetConfig,
} from "@reeve/contract/catalog";
import { followsScope, SCOPED_REPORTS } from "@reeve/contract/rules";
import { asc, eq, isNull } from "drizzle-orm";
import { invalid, newId, notFound, readSettings, writeSettings, type Book } from "../book.ts";
import * as t from "../db/schema.ts";
import { DEFAULT_DEFINITION, type Definition } from "./custom.ts";
import {
  createSavedReport,
  deleteSavedReport,
  listSavedReports,
  readableDefinition,
  savedReportOf,
  savedReportUsage,
  updateSavedReport,
} from "./saved-reports.ts";
import {
  defaultConfig,
  frozenContent,
  parse,
  reportTypeOf,
  reportLabels,
  same,
  validateConfig,
} from "./widget-config.ts";

type WidgetRow = typeof t.widgets.$inferSelect;
type WidgetType = Widget["type"];

const widgetRow = (book: Book, id: string): WidgetRow => {
  const row = book.db.select().from(t.widgets).where(eq(t.widgets.id, id)).get();
  if (row === undefined || frozenContent(row.type, row.meta)) return notFound("widget", id);
  return row;
};

const hostOf = (book: Book, pageId: string): PageHost | null =>
  book.db
    .select({ host: t.dashboardPages.host })
    .from(t.dashboardPages)
    .where(eq(t.dashboardPages.id, pageId))
    .get()?.host ?? null;

/** Whether a placement asks its report to follow accounts other than its saved report's. */
const overridesScope = (config: WidgetConfig, host: PageHost | null) =>
  host !== null || ("scope" in config && config.scope?.accounts.mode === "fixed");

export const toWidget = (book: Book, row: WidgetRow): Widget => {
  let config: WidgetConfig | null = null;
  let availability: Widget["availability"] = "available";
  try {
    config = validateConfig(book, row.type, row.config);
    const type = reportTypeOf(row.type);
    if (type !== undefined) {
      const stored =
        row.reportId === null
          ? undefined
          : book.db
              .select()
              .from(t.customReports)
              .where(eq(t.customReports.id, row.reportId))
              .get();
      const definition = stored === undefined ? undefined : readableDefinition(stored.definition);
      if (stored === undefined) availability = "missing-reference";
      else if (definition === undefined || definition.type !== type) availability = "unsupported";
      else if (
        !followsScope(definition) &&
        (definition.scope.accounts.mode !== "all" ||
          overridesScope(config, hostOf(book, row.pageId)))
      )
        availability = "unsupported";
    }
  } catch {
    availability =
      reportTypeOf(row.type) === undefined && !Object.hasOwn(localWidgetSettings, row.type)
        ? "unsupported"
        : "invalid-config";
  }
  return {
    id: row.id,
    pageId: row.pageId,
    type: row.type,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    reportId: row.reportId,
    config,
    availability,
  };
};

const widgetsOf = (book: Book, pageId: string) =>
  book.db
    .select()
    .from(t.widgets)
    .where(eq(t.widgets.pageId, pageId))
    .orderBy(asc(t.widgets.y), asc(t.widgets.x), asc(t.widgets.id))
    .all()
    .filter((row) => !frozenContent(row.type, row.meta))
    .map((row) => toWidget(book, row));

const normalPages = (book: Book) =>
  book.db
    .select()
    .from(t.dashboardPages)
    .where(isNull(t.dashboardPages.host))
    .orderBy(asc(t.dashboardPages.sortOrder), asc(t.dashboardPages.id))
    .all();

const defaultId = (book: Book) => {
  const pages = normalPages(book);
  const selected = readSettings(book.db).defaultDashboardId;
  return pages.some((page) => page.id === selected) ? selected : pages[0]?.id;
};

const pageRow = (book: Book, id: string) => {
  const row = book.db.select().from(t.dashboardPages).where(eq(t.dashboardPages.id, id)).get();
  if (row === undefined) return notFound("dashboard page", id);
  if (row.host !== null) return invalid("Operational widget arrangements are not dashboards");
  return row;
};

const pageOf = (book: Book, id: string): DashboardPage => {
  const row = pageRow(book, id);
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    isDefault: defaultId(book) === id,
    widgets: widgetsOf(book, id),
  };
};

export const listDashboardPages = (book: Book): Array<DashboardPage> =>
  normalPages(book).map((row) => pageOf(book, row.id));

const pageName = (value: string) => {
  const name = value.trim();
  if (name === "") invalid("A dashboard needs a name");
  return name;
};

export const createDashboardPage = (book: Book, name: string): DashboardPage => {
  const pages = normalPages(book);
  const id = newId();
  book.db
    .insert(t.dashboardPages)
    .values({
      id,
      name: pageName(name),
      sortOrder: Math.max(-1, ...pages.map((p) => p.sortOrder)) + 1,
    })
    .run();
  return pageOf(book, id);
};

export const renameDashboardPage = (book: Book, id: string, value: string): DashboardPage => {
  const page = pageRow(book, id);
  const name = pageName(value);
  if (page.name !== name)
    book.db.update(t.dashboardPages).set({ name }).where(eq(t.dashboardPages.id, id)).run();
  return pageOf(book, id);
};

export const setDefaultDashboard = (book: Book, id: string): DashboardPage => {
  pageRow(book, id);
  if (readSettings(book.db).defaultDashboardId !== id)
    writeSettings(book.db, { defaultDashboardId: id });
  return pageOf(book, id);
};

export const reorderDashboardPages = (book: Book, ids: ReadonlyArray<string>) => {
  const pages = normalPages(book);
  if (new Set(ids).size !== ids.length || !same([...ids].sort(), pages.map((p) => p.id).sort()))
    invalid("Supply every dashboard id exactly once");
  ids.forEach((id, sortOrder) => {
    if (pages.find((p) => p.id === id)?.sortOrder !== sortOrder)
      book.db.update(t.dashboardPages).set({ sortOrder }).where(eq(t.dashboardPages.id, id)).run();
  });
  return listDashboardPages(book);
};

export const deleteDashboardPage = (book: Book, id: string) => {
  pageRow(book, id);
  const remaining = normalPages(book).filter((p) => p.id !== id);
  if (remaining.length === 0) invalid("Cannot delete the last dashboard page");
  book.db.delete(t.widgets).where(eq(t.widgets.pageId, id)).run();
  book.db.delete(t.dashboardPages).where(eq(t.dashboardPages.id, id)).run();
  if (readSettings(book.db).defaultDashboardId === id)
    writeSettings(book.db, { defaultDashboardId: remaining[0]!.id });
  return { deleted: id };
};

export const seedTodayWidgets = (book: Book, pageId: string) => {
  const spending = createSavedReport(book, {
    name: uniqueReportName(book, "Spending"),
    definition: {
      version: 1,
      type: "spending",
      settings: { isLive: true, mode: "single-month" },
      scope: { accounts: { mode: "all" } },
    },
  });
  const types: ReadonlyArray<WidgetType> = [
    "home-insight",
    "category-pace",
    "account-balances",
    "spending-card",
    "upcoming-transactions",
    "recent-transactions",
  ];
  types.forEach((type, index) =>
    addWidget(book, {
      pageId,
      type,
      x: (index % 2) * 6,
      y: Math.floor(index / 2) * 3,
      width: 6,
      height: 3,
      ...(type === "spending-card"
        ? { reportId: spending.id, config: defaultConfig() }
        : { config: { ...defaultConfig(), settings: {} } }),
    }),
  );
};

export const uniqueReportName = (book: Book, base: string) => {
  const names = new Set(
    book.db
      .select({ name: t.customReports.name })
      .from(t.customReports)
      .all()
      .map((r) => r.name.trim()),
  );
  let name = base.trim() || "Report";
  for (let n = 2; names.has(name); n++) name = `${base.trim() || "Report"} (${n})`;
  return name;
};

export const resetDashboardPage = (book: Book, id: string): DashboardPage => {
  pageRow(book, id);
  const visible = book.db
    .select()
    .from(t.widgets)
    .where(eq(t.widgets.pageId, id))
    .all()
    .filter((row) => !frozenContent(row.type, row.meta));
  for (const row of visible) book.db.delete(t.widgets).where(eq(t.widgets.id, row.id)).run();
  seedTodayWidgets(book, id);
  return pageOf(book, id);
};

const checkLayout = (layout: Pick<Widget, "x" | "y" | "width" | "height">) => {
  const { x, y, width, height } = layout;
  if (
    ![x, y, width, height].every(Number.isInteger) ||
    x < 0 ||
    x > 11 ||
    y < 0 ||
    width < 1 ||
    width > 12 ||
    height < 1 ||
    height > 100 ||
    x + width > 12
  )
    invalid("Invalid widget grid coordinates or size");
};

const nextLayout = (
  book: Book,
  pageId: string,
  input: { x?: number; y?: number; width?: number; height?: number },
) => {
  const width = input.width ?? 4,
    height = input.height ?? 2;
  const rows = book.db
    .select()
    .from(t.widgets)
    .where(eq(t.widgets.pageId, pageId))
    .orderBy(asc(t.widgets.y), asc(t.widgets.x), asc(t.widgets.id))
    .all();
  const last = rows.at(-1);
  const wraps = last !== undefined && last.x + last.width + width > 12;
  const bottom = Math.max(0, ...rows.map((row) => row.y + row.height));
  const x = input.x ?? (last === undefined || wraps ? 0 : last.x + last.width);
  const y = input.y ?? (last === undefined ? 0 : wraps ? bottom : last.y);
  const layout = { x, y, width, height };
  checkLayout(layout);
  return layout;
};

const checkedLink = (
  book: Book,
  type: string,
  reportId: string | undefined,
  config: unknown,
  host: PageHost | null,
) => {
  const parsed = validateConfig(book, type, config);
  const expected = reportTypeOf(type);
  if (host !== null && (expected === undefined || !SCOPED_REPORTS.has(expected)))
    invalid(`This widget does not follow accounts, so it cannot sit on ${HOST_NAMES[host]}`);
  if (expected === undefined) {
    if (reportId !== undefined) invalid("Local widgets cannot reference a report");
  } else {
    if (reportId === undefined) return invalid("A report widget requires a saved report id");
    const report = savedReportOf(book, reportId);
    if (report.definition.type !== expected) invalid("Widget and saved report types do not match");
    if (overridesScope(parsed, host) && !followsScope(report.definition))
      invalid("This report is budget-wide and cannot follow an account scope");
  }
  return { reportId: reportId ?? null, config: parsed };
};

const newReport = (book: Book, type: WidgetType, report: { name?: string; settings?: unknown }) => {
  const reportType = reportTypeOf(type);
  if (reportType === undefined) return invalid("Only report widgets can create a saved report");
  return createSavedReport(book, {
    name: uniqueReportName(book, report.name ?? reportLabels[reportType]),
    definition: parseDefinition(reportType, report.settings ?? {}),
  });
};

const parseDefinition = (type: string, settings: unknown) =>
  parse(SavedReportDefinition, {
    version: 1,
    type,
    settings,
    scope: { accounts: { mode: "all" } },
  });

interface NewWidget {
  readonly type: WidgetType;
  readonly reportId?: string;
  readonly report?: { name?: string; settings?: unknown };
  readonly config?: WidgetConfig;
}

const insertWidget = (
  book: Book,
  page: { id: string; host: PageHost | null },
  layout: Pick<Widget, "x" | "y" | "width" | "height">,
  input: NewWidget,
): string => {
  if (input.report !== undefined && input.reportId !== undefined)
    invalid("Supply reportId or report, not both");
  const config = input.config ?? defaultConfig();
  const active = checkedLink(
    book,
    input.type,
    input.reportId ??
      (reportTypeOf(input.type) === undefined && input.report === undefined
        ? undefined
        : newReport(book, input.type, input.report ?? {}).id),
    config,
    page.host,
  );
  const id = newId();
  book.db
    .insert(t.widgets)
    .values({ id, pageId: page.id, type: input.type, ...layout, ...active })
    .run();
  return id;
};

export const addWidget = (
  book: Book,
  input: NewWidget & { pageId: string; width?: number; height?: number; x?: number; y?: number },
): Widget => {
  pageRow(book, input.pageId);
  const layout = nextLayout(book, input.pageId, input);
  return toWidget(
    book,
    widgetRow(book, insertWidget(book, { id: input.pageId, host: null }, layout, input)),
  );
};

export interface WidgetChange {
  readonly id: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly config?: WidgetConfig;
}

export const updateWidget = (book: Book, change: WidgetChange): Widget => {
  const row = widgetRow(book, change.id);
  const host = hostOf(book, row.pageId);
  if (
    host !== null &&
    [change.x, change.y, change.width, change.height].some((v) => v !== undefined)
  )
    invalid("A page widget keeps its size; reorder it with move_page_widget");
  const layout = {
    x: change.x ?? row.x,
    y: change.y ?? row.y,
    width: change.width ?? row.width,
    height: change.height ?? row.height,
  };
  checkLayout(layout);
  let active = { reportId: row.reportId, config: row.config };
  if (change.config !== undefined) {
    if (toWidget(book, row).availability !== "available")
      invalid("Use repair_widget to configure an unavailable widget");
    active = checkedLink(book, row.type, row.reportId ?? undefined, change.config, host);
  }
  if (
    !same(layout, { x: row.x, y: row.y, width: row.width, height: row.height }) ||
    !same(active.config, row.config)
  )
    book.db
      .update(t.widgets)
      .set({ ...layout, ...active })
      .where(eq(t.widgets.id, row.id))
      .run();
  return toWidget(book, widgetRow(book, row.id));
};

export const updateWidgets = (book: Book, changes: ReadonlyArray<WidgetChange>) => {
  if (new Set(changes.map((c) => c.id)).size !== changes.length)
    invalid("Widget ids must be distinct");
  const pages = new Set(changes.map((c) => widgetRow(book, c.id).pageId));
  if (pages.size > 1) invalid("A layout batch must belong to one dashboard");
  for (const page of pages) pageRow(book, page);
  return changes.map((change) => updateWidget(book, change));
};

export const removeWidget = (book: Book, id: string) => {
  const row = widgetRow(book, id);
  book.db.delete(t.widgets).where(eq(t.widgets.id, id)).run();
  if (hostOf(book, row.pageId) !== null) stack(book, row.pageId);
  return { deleted: id };
};

export const copyWidget = (book: Book, id: string, pageId: string): Widget => {
  const row = widgetRow(book, id);
  pageRow(book, pageId);
  const layout = nextLayout(book, pageId, { width: row.width, height: row.height });
  const copyId = newId();
  book.db
    .insert(t.widgets)
    .values({ ...row, id: copyId, pageId, ...layout })
    .run();
  return toWidget(book, widgetRow(book, copyId));
};

export const duplicateDashboardPage = (book: Book, id: string, name: string) => {
  pageRow(book, id);
  const page = createDashboardPage(book, name);
  for (const row of book.db.select().from(t.widgets).where(eq(t.widgets.pageId, id)).all())
    book.db
      .insert(t.widgets)
      .values({ ...row, id: newId(), pageId: page.id })
      .run();
  return pageOf(book, page.id);
};

export const repairWidget = (
  book: Book,
  input: { id: string; type: WidgetType; reportId?: string; config: WidgetConfig },
) => {
  const row = widgetRow(book, input.id);
  if (toWidget(book, row).availability === "available")
    invalid("Only unavailable widgets can be repaired");
  const active = checkedLink(
    book,
    input.type,
    input.reportId,
    input.config,
    hostOf(book, row.pageId),
  );
  book.db
    .update(t.widgets)
    .set({ type: input.type, ...active })
    .where(eq(t.widgets.id, row.id))
    .run();
  return toWidget(book, widgetRow(book, row.id));
};

const HOST_NAMES: Record<PageHost, string> = { transactions: "Transactions", payees: "Payees" };
export const PAGE_WIDGET_LIMIT = 3;

const hostRow = (book: Book, host: PageHost) =>
  book.db.select().from(t.dashboardPages).where(eq(t.dashboardPages.host, host)).get();

const stackOf = (book: Book, pageId: string) =>
  book.db
    .select()
    .from(t.widgets)
    .where(eq(t.widgets.pageId, pageId))
    .orderBy(asc(t.widgets.y), asc(t.widgets.x), asc(t.widgets.id))
    .all();

/** Writes a page's widgets back as one full-width row each, in the order given or stored. */
const stack = (book: Book, pageId: string, order = stackOf(book, pageId)) =>
  order.forEach((row, y) => {
    if (row.x !== 0 || row.y !== y || row.width !== 12 || row.height !== 1)
      book.db
        .update(t.widgets)
        .set({ x: 0, y, width: 12, height: 1 })
        .where(eq(t.widgets.id, row.id))
        .run();
  });

export const pageWidgets = (book: Book, host: PageHost): PageWidgets => {
  const row = hostRow(book, host);
  return { host, widgets: row === undefined ? [] : widgetsOf(book, row.id) };
};

export const addPageWidget = (book: Book, input: NewWidget & { host: PageHost }): Widget => {
  let page = hostRow(book, input.host);
  if (page === undefined) {
    const id = newId();
    book.db
      .insert(t.dashboardPages)
      .values({ id, name: HOST_NAMES[input.host], sortOrder: 0, host: input.host })
      .run();
    page = hostRow(book, input.host)!;
  }
  const rows = stackOf(book, page.id);
  if (rows.length >= PAGE_WIDGET_LIMIT)
    invalid(`${HOST_NAMES[input.host]} holds at most ${PAGE_WIDGET_LIMIT} widgets`);
  const id = insertWidget(
    book,
    page,
    { x: 0, y: (rows.at(-1)?.y ?? -1) + 1, width: 12, height: 1 },
    input,
  );
  stack(book, page.id);
  return toWidget(book, widgetRow(book, id));
};

export const movePageWidget = (book: Book, id: string, index: number): PageWidgets => {
  const row = widgetRow(book, id);
  const host = hostOf(book, row.pageId);
  if (host === null) return invalid("Arrange a dashboard's widgets with update_widgets");
  const order = stackOf(book, row.pageId).filter((each) => each.id !== id);
  if (!Number.isInteger(index) || index < 0 || index > order.length)
    invalid(`Choose a position from 0 to ${order.length}`);
  order.splice(index, 0, row);
  stack(book, row.pageId, order);
  return pageWidgets(book, host);
};

export const customReportOf = (book: Book, id: string): CustomReport => {
  const report = savedReportOf(book, id);
  if (report.definition.type !== "custom")
    return invalid("This saved report is not a custom report");
  return {
    ...DEFAULT_DEFINITION(),
    ...report.definition.settings,
    id: report.id,
    name: report.name,
  };
};

export const listCustomReports = (book: Book): Array<CustomReport> =>
  listSavedReports(book)
    .filter((report) => "definition" in report && report.definition.type === "custom")
    .map((report) => customReportOf(book, report.id));

export const createCustomReport = (
  book: Book,
  input: { name: string } & Partial<Definition>,
): CustomReport => {
  const { name, ...settings } = input;
  const report = createSavedReport(book, {
    name,
    definition: parseDefinition("custom", settings),
  });
  return customReportOf(book, report.id);
};

export const updateCustomReport = (
  book: Book,
  input: { id: string; name?: string } & Partial<Definition>,
): CustomReport => {
  const { id, name, ...fields } = input;
  const { id: _id, name: _name, ...settings } = customReportOf(book, id);
  updateSavedReport(book, {
    id,
    ...(name === undefined ? {} : { name }),
    settings: {
      ...settings,
      ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
    },
  });
  return customReportOf(book, id);
};

export const deleteCustomReport = (
  book: Book,
  id: string,
  expectedPlacementIds?: ReadonlyArray<string>,
) => {
  customReportOf(book, id);
  if (expectedPlacementIds === undefined && savedReportUsage(book, id).placements.length > 0)
    invalid("Review report usage and supply expectedPlacementIds before deleting");
  return deleteSavedReport(book, { id, expectedPlacementIds: expectedPlacementIds ?? [] });
};
