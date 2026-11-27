import type { DashboardPage, SavedReport, Widget } from "@reeve/contract/catalog";
import { Effect, ManagedRuntime } from "effect";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Books } from "../src/books.ts";
import { migrations } from "../src/db/migrations.gen.ts";
import { runOperation } from "../src/operations.ts";
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
beforeEach(() => {
  s = scratch();
});
afterEach(async () => {
  await s.dispose();
});

const config = () => ({
  version: 1,
  title: null,
  presentation: {},
  scope: { accounts: { mode: "inherit" } },
});
const definition = () => ({
  version: 1,
  type: "net-worth",
  settings: { mode: "stacked" },
  scope: { accounts: { mode: "all" } },
});
const create = async () => {
  const book = await s.call("create_book", { name: "Test", empty: true });
  const [page] = await s.call<DashboardPage[]>("list_dashboard_pages", { book: book.id });
  return { book: book.id as string, page: page! };
};
const report = (book: string, name = "Savings") =>
  s.call<SavedReport>("create_saved_report", { book, name, definition: definition() });
const add = (book: string, pageId: string, reportId: string) =>
  s.call<Widget>("add_widget", {
    book,
    pageId,
    type: "net-worth-card",
    reportId,
    config: config(),
  });
const pages = (book: string) => s.call<DashboardPage[]>("list_dashboard_pages", { book });

const reopened = async (book: string) => {
  const runtime = ManagedRuntime.make(Books.layer({ home: s.home }));
  try {
    return await runtime.runPromise(
      runOperation("list_dashboard_pages", { book }) as Effect.Effect<
        DashboardPage[],
        unknown,
        Books
      >,
    );
  } finally {
    await runtime.dispose();
  }
};

const oldMeta = '{ "name": "Legacy", "mode": "stacked", "future": {"x":1} }';
const oldDefinition = '{ "groupBy": "Payee", "future": true }';
const olderBook = () => {
  mkdirSync(join(s.home, "books"), { recursive: true });
  const file = join(s.home, "books", "old.sqlite");
  const db = new DatabaseSync(file);
  const boundary = migrations.findIndex((m) => m.sql.includes("ADD `legacy_definition`"));
  expect(boundary).toBeGreaterThan(0);
  db.exec("CREATE TABLE __migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
  for (const migration of migrations.slice(0, boundary)) {
    for (const statement of migration.sql.split("--> statement-breakpoint"))
      if (statement.trim()) db.exec(statement);
    db.prepare("INSERT INTO __migrations VALUES (?, 0)").run(migration.name);
  }
  db.exec(`
    INSERT INTO settings VALUES ('name', '"Old book"');
    INSERT INTO dashboard_pages (id, name, sort_order) VALUES ('main', 'Main', 4);
    INSERT INTO accounts (id, name, type, on_budget, created_at) VALUES ('cash', 'Cash', 'asset', 1, 0), ('opening', 'Opening', 'equity', 0, 0);
    INSERT INTO transactions (id, date, created_at) VALUES ('tx', 20260101, 0);
    INSERT INTO postings (id, transaction_id, account_id, amount, sort_order) VALUES ('a', 'tx', 'cash', 12345, 0), ('b', 'tx', 'opening', -12345, 1);
    INSERT INTO products (id, name, created_at) VALUES ('frozen-product', 'Milk', 0);
    INSERT INTO undo_state (id, group_id, stack, active) VALUES (1, 1, 'undo', 0);
    INSERT INTO undo_log (group_id, stack, statement) VALUES (1, 'undo', 'DELETE FROM widgets'), (2, 'redo', 'DELETE FROM postings');
  `);
  db.prepare(
    "INSERT INTO custom_reports (id, name, definition, created_at) VALUES ('custom', 'Custom', ?, 9)",
  ).run(oldDefinition);
  const insert = db.prepare(
    "INSERT INTO widgets (id, page_id, type, x, y, width, height, meta) VALUES (?, 'main', ?, 0, ?, 4, 2, ?)",
  );
  insert.run("w1", "net-worth-card", 0, oldMeta);
  insert.run("w2", "net-worth-card", 2, oldMeta);
  insert.run("linked", "custom-report", 4, '{"id":"custom","name":"Short","future":42}');
  insert.run("missing", "custom-report", 6, '{"id":"absent"}');
  insert.run("malformed", "net-worth-card", 8, "not json");
  insert.run(
    "frozen",
    "spending-card",
    10,
    '{"reportType":"item-spending","name":"Private purchase widget"}',
  );
  db.close();
  return file;
};

const inspect = <A>(file: string, sql: string): A => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare(sql).all() as A;
  } finally {
    db.close();
  }
};

describe("dashboard persistence", () => {
  it("shows scoped definitions and fixed placements, and refuses scope where a report has none", async () => {
    const { book, page } = await create();
    const account = await s.call("create_account", { book, name: "Checking" });
    const saved = await s.call<SavedReport>("create_saved_report", {
      book,
      name: "Scoped",
      definition: { ...definition(), scope: { accounts: { mode: "selected", ids: [account.id] } } },
    });
    expect((await add(book, page.id, saved.id)).availability).toBe("available");
    const all = await report(book);
    const fixed = await s.call<Widget>("add_widget", {
      book,
      pageId: page.id,
      type: "net-worth-card",
      reportId: all.id,
      config: {
        ...config(),
        scope: { accounts: { mode: "fixed", value: { mode: "selected", ids: [account.id] } } },
      },
    });
    expect(fixed.availability).toBe("available");
    expect(
      (
        await s.fails("create_saved_report", {
          book,
          name: "Invalid plan",
          definition: {
            version: 1,
            type: "monte-carlo",
            settings: {},
            scope: { accounts: { mode: "budgeted" } },
          },
        })
      )._tag,
    ).toBe("InvalidRequest");
  });

  it("validates nested persisted condition operands and retains the existing closed amount range", async () => {
    const { book } = await create();
    const valid = await s.call("create_saved_report", {
      book,
      name: "Range",
      definition: {
        ...definition(),
        settings: {
          conditions: [{ field: "amount", op: "isbetween", value: { num1: -100, num2: 100 } }],
        },
      },
    });
    expect(valid.definition.settings.conditions[0].value).toEqual({ num1: -100, num2: 100 });
    for (const settings of [
      { conditions: [{ field: "payee", op: "is", value: { extra: true } }] },
      { conditions: [{ field: "amount", op: "is", value: 1.5 }] },
      { conditions: [{ field: "cleared", op: "is", value: "yes" }] },
      { conditions: [{ field: "date", op: "is", value: "2026-02-30" }] },
      {
        conditions: [
          { field: "amount", op: "isbetween", value: { num1: 1, num2: 2, extra: true } },
        ],
      },
    ])
      expect(
        (
          await s.fails("create_saved_report", {
            book,
            name: "Invalid",
            definition: { ...definition(), settings },
          })
        )._tag,
      ).toBe("InvalidRequest");
    expect(
      (
        await s.fails("create_saved_report", {
          book,
          name: "Invalid formula",
          definition: {
            version: 1,
            type: "formula",
            scope: { accounts: { mode: "all" } },
            settings: {
              queries: {
                q: { conditions: [{ field: "notes", op: "is", value: { extra: true } }] },
              },
            },
          },
        })
      )._tag,
    ).toBe("InvalidRequest");
    await report(book, " Savings ");
    expect(
      (await s.fails("create_saved_report", { book, name: "Savings", definition: definition() }))
        ._tag,
    ).toBe("InvalidRequest");
  });

  it("returns unavailable descriptors without exposing frozen reports and protects reserved page hosts", async () => {
    const file = olderBook();
    const db = new DatabaseSync(file);
    db.prepare(
      "INSERT INTO custom_reports (id, name, definition, created_at) VALUES (?, ?, ?, 0)",
    ).run("future", "Future", '{"version":2,"type":"net-worth","private":"retained"}');
    db.prepare(
      "INSERT INTO custom_reports (id, name, definition, created_at) VALUES (?, ?, ?, 0)",
    ).run("broken", "Broken", "not json");
    db.prepare(
      "INSERT INTO custom_reports (id, name, definition, created_at) VALUES (?, ?, ?, 0)",
    ).run("purchase", "Hidden purchase", '{"type":"item-spending"}');
    db.prepare(
      "INSERT INTO widgets (id, page_id, type, x, y, width, height, meta) VALUES ('unknown', 'main', 'future-card', 0, 12, 4, 2, '{}')",
    ).run();
    db.close();
    const upgraded = await pages("old");
    expect(await s.call("get_saved_report", { book: "old", id: "future" })).toEqual({
      id: "future",
      name: "Future",
      createdAt: 0,
      availability: "unsupported",
    });
    expect(await s.call("get_saved_report", { book: "old", id: "broken" })).toMatchObject({
      availability: "invalid-config",
    });
    expect((await s.fails("get_saved_report", { book: "old", id: "purchase" }))._tag).toBe(
      "NotFound",
    );
    const copied = await s.call("copy_widget", {
      book: "old",
      id: "unknown",
      pageId: upgraded[1]!.id,
    });
    expect(copied).toMatchObject({ type: "future-card", availability: "unsupported" });
    const hostDb = new DatabaseSync(file);
    hostDb
      .prepare(
        "INSERT INTO dashboard_pages (id, name, sort_order, host) VALUES ('host', 'Transactions', 0, 'transactions')",
      )
      .run();
    hostDb.close();
    for (const name of ["set_default_dashboard", "delete_dashboard_page", "reset_dashboard_page"])
      expect((await s.fails(name, { book: "old", id: "host" }))._tag).toBe("InvalidRequest");
    expect((await pages("old")).some((page) => page.id === "host")).toBe(false);
    await s.call("delete_saved_report", { book: "old", id: "broken", expectedPlacementIds: [] });
    await s.call("undo", { book: "old" });
    expect(await s.call("get_saved_report", { book: "old", id: "broken" })).toMatchObject({
      availability: "invalid-config",
    });
  });

  it("initializes Today once, lists without writes, and does not recreate a renamed or deleted Today", async () => {
    const { book, page } = await create();
    expect(page).toMatchObject({ name: "Today", isDefault: true });
    expect(page.widgets.map((w) => w.type)).toEqual([
      "home-insight",
      "category-pace",
      "account-balances",
      "spending-card",
      "upcoming-transactions",
      "recent-transactions",
    ]);
    expect(await s.call("undo", { book })).toMatchObject({ done: false });
    const other = await s.call<DashboardPage>("create_dashboard_page", { book, name: "Other" });
    await s.call("rename_dashboard_page", { book, id: page.id, name: "Renamed" });
    expect((await reopened(book)).map((p) => p.name)).toEqual(["Renamed", "Other"]);
    await s.call("delete_dashboard_page", { book, id: page.id });
    expect(await reopened(book)).toMatchObject([{ id: other.id, isDefault: true }]);
    await s.call("undo", { book });
    expect((await pages(book)).find((p) => p.id === page.id)).toMatchObject({
      name: "Renamed",
      isDefault: true,
    });
    await s.call("redo", { book });
    expect(await pages(book)).toHaveLength(1);
  });

  it("links copies and dashboard duplicates, but duplicates report definitions independently", async () => {
    const { book, page } = await create();
    const saved = await report(book);
    const first = await add(book, page.id, saved.id);
    const second = await s.call<Widget>("copy_widget", { book, id: first.id, pageId: page.id });
    const duplicate = await s.call<DashboardPage>("duplicate_dashboard_page", {
      book,
      id: page.id,
      name: "Copy",
    });
    expect(duplicate.widgets.filter((w) => w.reportId === saved.id)).toHaveLength(2);
    await s.call("update_saved_report", {
      book,
      id: saved.id,
      settings: { mode: "trend" },
      name: "Changed",
    });
    const linked = (await pages(book))
      .flatMap((p) => p.widgets)
      .filter((w) => w.reportId === saved.id);
    expect(linked).toHaveLength(4);
    await s.call("update_widget", {
      book,
      id: second.id,
      config: { ...config(), title: "Only this card", presentation: { collapsed: true } },
    });
    expect(await s.call("get_saved_report", { book, id: saved.id })).toMatchObject({
      name: "Changed",
    });
    const independent = await s.call<SavedReport>("duplicate_saved_report", {
      book,
      id: saved.id,
      name: "Independent",
    });
    expect(independent.id).not.toBe(saved.id);
    expect(await s.call("get_saved_report_usage", { book, id: independent.id })).toMatchObject({
      placements: [],
    });
    await s.call("remove_widget", { book, id: first.id });
    expect(await s.call("get_saved_report", { book, id: saved.id })).toMatchObject({
      id: saved.id,
    });
  });

  it("requires exact reviewed usage and restores report and placements in one undo step", async () => {
    const { book, page } = await create();
    const saved = await report(book);
    const first = await add(book, page.id, saved.id);
    const second = await add(book, page.id, saved.id);
    expect(
      (
        await s.fails("delete_saved_report", {
          book,
          id: saved.id,
          expectedPlacementIds: [first.id],
        })
      )._tag,
    ).toBe("InvalidRequest");
    const usage = await s.call("get_saved_report_usage", { book, id: saved.id });
    expect(usage.placements).toHaveLength(2);
    await s.call("delete_saved_report", {
      book,
      id: saved.id,
      expectedPlacementIds: [second.id, first.id],
    });
    expect((await s.fails("get_saved_report", { book, id: saved.id }))._tag).toBe("NotFound");
    await s.call("undo", { book });
    expect(
      (await s.call("get_saved_report_usage", { book, id: saved.id })).placements,
    ).toHaveLength(2);
    await s.call("redo", { book });
    expect((await s.fails("get_saved_report", { book, id: saved.id }))._tag).toBe("NotFound");
  });

  it("keeps redo across identical definition, layout and default writes", async () => {
    const { book, page } = await create();
    const saved = await report(book);
    const widget = await add(book, page.id, saved.id);
    await s.call("rename_dashboard_page", { book, id: page.id, name: "Changed" });
    await s.call("undo", { book });
    await s.call("rename_dashboard_page", { book, id: page.id, name: "Today" });
    await s.call("set_default_dashboard", { book, id: page.id });
    await s.call("update_saved_report", {
      book,
      id: saved.id,
      settings: saved.definition.settings,
    });
    await s.call("update_widget", { book, id: widget.id, x: widget.x, config: widget.config });
    expect(await s.call("redo", { book })).toMatchObject({ done: true });
    expect((await pages(book))[0]?.name).toBe("Changed");
  });

  it("validates closed inputs, references, types, scope, dates and layout atomically", async () => {
    const { book, page } = await create();
    const saved = await report(book);
    const widget = await add(book, page.id, saved.id);
    for (const input of [
      { ...definition(), settings: { unknown: true } },
      { ...definition(), settings: { timeFrame: { start: "2026-02-30", end: "2026-03-01" } } },
      { ...definition(), settings: { timeFrame: { start: "2026-03", end: "2026-02" } } },
    ])
      expect(
        (await s.fails("create_saved_report", { book, name: "Invalid", definition: input }))._tag,
      ).toBe("InvalidRequest");
    expect(
      (
        await s.fails("create_saved_report", {
          book,
          name: "Invalid",
          definition: {
            ...definition(),
            scope: { accounts: { mode: "selected", ids: ["missing"] } },
          },
        })
      )._tag,
    ).toBe("NotFound");
    expect(
      (
        await s.fails("add_widget", {
          book,
          pageId: page.id,
          type: "cash-flow-card",
          reportId: saved.id,
          config: config(),
        })
      )._tag,
    ).toBe("InvalidRequest");
    expect(
      (
        await s.fails("add_widget", {
          book,
          pageId: page.id,
          type: "net-worth-card",
          reportId: "missing",
          config: config(),
        })
      )._tag,
    ).toBe("NotFound");
    expect(
      (
        await s.fails("update_widget", {
          book,
          id: widget.id,
          config: { ...config(), settings: { mode: "trend" } },
        })
      )._tag,
    ).toBe("InvalidRequest");
    expect(
      (await s.fails("update_widget", { book, id: widget.id, meta: { future: true } }))._tag,
    ).toBe("InvalidRequest");
    expect(
      (
        await s.fails("update_widget", {
          book,
          id: widget.id,
          meta: { timeFrame: { start: "2026-01", future: true } },
        })
      )._tag,
    ).toBe("InvalidRequest");
    expect(
      (
        await s.fails("update_widgets", {
          book,
          widgets: [
            { id: widget.id, x: 1 },
            { id: widget.id, x: 2 },
          ],
        })
      )._tag,
    ).toBe("InvalidRequest");
    const other = await add(book, page.id, saved.id);
    expect(
      (
        await s.fails("update_widgets", {
          book,
          widgets: [
            { id: widget.id, y: 90 },
            { id: other.id, width: 13 },
          ],
        })
      )._tag,
    ).toBe("InvalidRequest");
    expect((await pages(book))[0]?.widgets.find((w) => w.id === widget.id)?.y).toBe(widget.y);
  });

  it("adds a report widget with a new linked report in one undo step", async () => {
    const { book, page } = await create();
    const before = await s.call<ReadonlyArray<unknown>>("list_saved_reports", { book });
    const first = await s.call<Widget>("add_widget", {
      book,
      pageId: page.id,
      type: "summary-card",
      report: { name: "Sum", settings: { content: { type: "sum" } } },
      config: { ...config(), presentation: { fontSize: 32 } },
    });
    expect(await s.call("get_saved_report", { book, id: first.reportId })).toMatchObject({
      name: "Sum",
      definition: { type: "summary", settings: { content: { type: "sum" } } },
    });
    const defaulted = await s.call<Widget>("add_widget", {
      book,
      pageId: page.id,
      type: "net-worth-card",
    });
    expect(await s.call("get_saved_report", { book, id: defaulted.reportId })).toMatchObject({
      name: "Net Worth",
      definition: { type: "net-worth", settings: {} },
    });
    expect(
      (
        await s.fails("add_widget", {
          book,
          pageId: page.id,
          type: "summary-card",
          reportId: first.reportId,
          report: {},
        })
      )._tag,
    ).toBe("InvalidRequest");
    expect(
      (await s.fails("add_widget", { book, pageId: page.id, type: "markdown-card", report: {} }))
        ._tag,
    ).toBe("InvalidRequest");
    await s.call("undo", { book });
    await s.call("undo", { book });
    expect(await s.call("list_saved_reports", { book })).toEqual(before);
    expect((await pages(book))[0]!.widgets.some((w) => w.id === first.id)).toBe(false);
  });

  it("reorders, resets and changes defaults with reversible relationships", async () => {
    const { book, page } = await create();
    const other = await s.call<DashboardPage>("create_dashboard_page", { book, name: "Other" });
    expect((await s.fails("reorder_dashboard_pages", { book, ids: [other.id] }))._tag).toBe(
      "InvalidRequest",
    );
    await s.call("reorder_dashboard_pages", { book, ids: [other.id, page.id] });
    expect((await pages(book)).map((p) => p.id)).toEqual([other.id, page.id]);
    await s.call("set_default_dashboard", { book, id: other.id });
    await s.call("reset_dashboard_page", { book, id: other.id });
    expect((await pages(book))[0]?.widgets).toHaveLength(6);
    await s.call("undo", { book });
    expect((await pages(book))[0]?.widgets).toHaveLength(0);
    await s.call("redo", { book });
    expect((await pages(book))[0]?.widgets).toHaveLength(6);
    await s.call("delete_dashboard_page", { book, id: other.id });
    expect(await pages(book)).toMatchObject([{ id: page.id, isDefault: true }]);
    await s.call("undo", { book });
    expect((await pages(book)).find((p) => p.id === other.id)).toMatchObject({ isDefault: true });
  });

  it("upgrades old rows once, preserves raw and financial data, and intentionally resets history", async () => {
    const file = olderBook();
    const financial = inspect(file, "SELECT * FROM postings ORDER BY id");
    const upgraded = await pages("old");
    expect(upgraded.map((p) => p.name)).toEqual(["Main", "Today"]);
    const main = upgraded[0]!;
    expect(main).toMatchObject({ id: "main", sortOrder: 4 });
    expect(main.widgets.some((w) => w.id === "frozen")).toBe(false);
    expect(main.widgets.find((w) => w.id === "w1")).toMatchObject({
      x: 0,
      y: 0,
      width: 4,
      availability: "available",
    });
    expect(main.widgets.find((w) => w.id === "w1")?.reportId).not.toBe(
      main.widgets.find((w) => w.id === "w2")?.reportId,
    );
    expect(main.widgets.find((w) => w.id === "missing")).toMatchObject({
      reportId: null,
      availability: "missing-reference",
    });
    expect(main.widgets.find((w) => w.id === "malformed")?.availability).toBe("invalid-config");
    expect(inspect(file, "SELECT meta FROM widgets WHERE id = 'w1'")).toEqual([{ meta: oldMeta }]);
    expect(
      inspect(file, "SELECT legacy_definition FROM custom_reports WHERE id = 'custom'"),
    ).toEqual([{ legacy_definition: oldDefinition }]);
    expect(inspect(file, "SELECT * FROM postings ORDER BY id")).toEqual(financial);
    expect(inspect(file, "SELECT name FROM products")).toEqual([{ name: "Milk" }]);
    expect(await s.call("undo", { book: "old" })).toMatchObject({ done: false });
    expect(await s.call("redo", { book: "old" })).toMatchObject({ done: false });
    await s.call("create_transaction", {
      book: "old",
      account: "cash",
      date: "2026-01-02",
      amount: -50,
    });
    await s.call("undo", { book: "old" });
    expect(inspect(file, "SELECT * FROM postings ORDER BY id")).toEqual(financial);
    await s.call("redo", { book: "old" });
    expect(
      inspect(
        file,
        "SELECT transaction_id FROM postings GROUP BY transaction_id HAVING sum(amount) != 0",
      ),
    ).toEqual([]);
    await s.call("undo", { book: "old" });
    const count = (await s.call<SavedReport[]>("list_saved_reports", { book: "old" })).length;
    await s.call("rename_dashboard_page", { book: "old", id: "main", name: "New name" });
    expect((await reopened("old"))[0]?.name).toBe("New name");
    await s.call("undo", { book: "old" });
    expect((await pages("old"))[0]?.name).toBe("Main");
    expect(await s.call("list_saved_reports", { book: "old" })).toHaveLength(count);
    const widget = main.widgets.find((w) => w.id === "w1")!;
    await s.call("update_widget", {
      book: "old",
      id: widget.id,
      config: { ...widget.config, title: "Changed" },
    });
    expect(inspect(file, "SELECT meta FROM widgets WHERE id = 'w1'")).toEqual([{ meta: oldMeta }]);
    await s.call("reset_dashboard_page", { book: "old", id: "main" });
    expect(inspect(file, "SELECT meta FROM widgets WHERE id = 'frozen'")).toEqual([
      { meta: '{"reportType":"item-spending","name":"Private purchase widget"}' },
    ]);
  });

  it.each(["marker", "placement"])(
    "rolls back initialization and history reset together on %s failure",
    async (target) => {
      const file = olderBook();
      const db = new DatabaseSync(file);
      db.exec(
        target === "marker"
          ? "CREATE TRIGGER fail_home BEFORE INSERT ON settings WHEN new.key = 'homeInitializedVersion' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END"
          : "CREATE TRIGGER fail_home BEFORE UPDATE ON widgets WHEN old.id = 'w1' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
      );
      db.close();
      expect((await s.fails("list_dashboard_pages", { book: "old" }))._tag).toBe("StorageError");
      expect(inspect(file, "SELECT count(*) AS n FROM undo_log")).toEqual([{ n: 2 }]);
      expect(inspect(file, "SELECT definition FROM custom_reports WHERE id = 'custom'")).toEqual([
        { definition: oldDefinition },
      ]);
      expect(inspect(file, "SELECT name FROM dashboard_pages")).toEqual([{ name: "Main" }]);
      const retry = new DatabaseSync(file);
      retry.exec("DROP TRIGGER fail_home");
      retry.close();
      expect(await pages("old")).toHaveLength(2);
    },
  );

  it("repairs unavailable cards explicitly and preserves linked backups and restore", async () => {
    const file = olderBook();
    await pages("old");
    const saved = await report("old");
    expect(
      (
        await s.fails("repair_widget", {
          book: "old",
          id: "w1",
          type: "net-worth-card",
          reportId: saved.id,
          config: config(),
        })
      )._tag,
    ).toBe("InvalidRequest");
    await s.call("repair_widget", {
      book: "old",
      id: "malformed",
      type: "net-worth-card",
      reportId: saved.id,
      config: config(),
    });
    expect(inspect(file, "SELECT meta FROM widgets WHERE id = 'malformed'")).toEqual([
      { meta: "not json" },
    ]);
    const path = join(s.home, "backup.sqlite");
    await s.call("export_book", { book: "old", path });
    const restored = await s.call("restore_book", { path, name: "Restored" });
    const restoredPages = await pages(restored.id);
    expect(restoredPages.flatMap((p) => p.widgets).find((w) => w.id === "malformed")).toMatchObject(
      { reportId: saved.id, availability: "available" },
    );
    expect(restoredPages).toHaveLength(2);
    expect(inspect(restored.file, "SELECT name FROM products")).toEqual([{ name: "Milk" }]);
  });
});
