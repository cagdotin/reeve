import { Schema } from "effect";
import { InvalidRequest, NotFound } from "@reeve/contract";
import { SavedReportDefinition, reportSettings, type WidgetConfig } from "@reeve/contract/catalog";
import { eq } from "drizzle-orm";
import { writeSettings, type Book } from "../book.ts";
import * as t from "../db/schema.ts";
import { inTransaction } from "../db/open.ts";
import { DEFAULT_DEFINITION } from "./custom.ts";
import { createDashboardPage, seedTodayWidgets, uniqueReportName } from "./dashboard.ts";
import { createSavedReport, readableDefinition } from "./saved-reports.ts";
import {
  defaultConfig,
  frozenContent,
  legacySettings,
  recordOf,
  reportTypeOf,
  reportLabels,
  validateConfig,
} from "./widget-config.ts";

const originalJson = (value: string | null): unknown => (value === null ? null : JSON.parse(value));

export const initializeDashboards = (book: Book) => {
  inTransaction(
    book.client,
    () => {
      if (
        book.db
          .select()
          .from(t.settings)
          .where(eq(t.settings.key, "homeInitializedVersion"))
          .get() !== undefined
      )
        return;
      const reports = book.client
        .prepare("SELECT id, definition FROM custom_reports ORDER BY id")
        .all() as Array<{ id: string; definition: string }>;
      for (const report of reports) {
        try {
          const old = originalJson(report.definition);
          if (frozenContent("", old) || recordOf(old).version !== undefined) continue;
          const settings = Schema.decodeUnknownSync(reportSettings.custom);
          const definition = {
            version: 1,
            type: "custom",
            settings: { ...DEFAULT_DEFINITION(), ...settings(old) },
            scope: { accounts: { mode: "all" } },
          };
          book.client
            .prepare("UPDATE custom_reports SET definition = ?, legacy_definition = ? WHERE id = ?")
            .run(JSON.stringify(definition), report.definition, report.id);
        } catch (error) {
          if (
            !(
              error instanceof SyntaxError ||
              Schema.isSchemaError(error) ||
              error instanceof InvalidRequest ||
              error instanceof NotFound
            )
          )
            throw error;
        }
      }
      const widgets = book.client
        .prepare("SELECT id, type, meta FROM widgets ORDER BY id")
        .all() as Array<{ id: string; type: string; meta: string | null }>;
      for (const widget of widgets) {
        try {
          const raw = originalJson(widget.meta);
          if (frozenContent(widget.type, raw)) continue;
          const meta = recordOf(raw);
          if (raw !== null && (typeof raw !== "object" || Array.isArray(raw))) continue;
          let config: WidgetConfig = {
            ...defaultConfig(),
            title: typeof meta.name === "string" ? meta.name : null,
          };
          const type = reportTypeOf(widget.type);
          let reportId: string | null = null;
          if (type === "custom") {
            const report =
              typeof meta.id === "string"
                ? book.db
                    .select()
                    .from(t.customReports)
                    .where(eq(t.customReports.id, meta.id))
                    .get()
                : undefined;
            if (report !== undefined && readableDefinition(report.definition)?.type === "custom")
              reportId = report.id;
          } else if (type !== undefined) {
            const settings = legacySettings(type, meta, false);
            const definition = Schema.decodeUnknownSync(SavedReportDefinition)({
              version: 1,
              type,
              settings,
              scope: { accounts: { mode: "all" } },
            });
            let fontSize = meta.fontSize;
            if (type === "summary" && typeof meta.content === "string")
              fontSize = recordOf(JSON.parse(meta.content)).fontSize;
            if (typeof fontSize === "number") config = { ...config, presentation: { fontSize } };
            config = validateConfig(book, widget.type, config);
            reportId = createSavedReport(book, {
              name: uniqueReportName(
                book,
                typeof meta.name === "string" ? meta.name : reportLabels[type],
              ),
              definition,
            }).id;
          } else if (widget.type === "markdown-card") {
            const { scope: _scope, ...base } = config;
            config = validateConfig(book, widget.type, {
              ...base,
              settings: {
                ...(meta.content === undefined ? {} : { content: meta.content }),
                ...(meta.text_align === undefined ? {} : { text_align: meta.text_align }),
              },
            });
          } else continue;
          book.db
            .update(t.widgets)
            .set({ config, reportId })
            .where(eq(t.widgets.id, widget.id))
            .run();
        } catch (error) {
          if (
            !(
              error instanceof SyntaxError ||
              Schema.isSchemaError(error) ||
              error instanceof InvalidRequest ||
              error instanceof NotFound
            )
          )
            throw error;
        }
      }
      const today = createDashboardPage(book, "Today");
      seedTodayWidgets(book, today.id);
      writeSettings(book.db, { defaultDashboardId: today.id });
      book.client.exec("DELETE FROM undo_log");
      book.db.insert(t.settings).values({ key: "homeInitializedVersion", value: "1" }).run();
    },
    { record: false },
  );
};
