import { Schema } from "effect";
import {
  SavedReportDefinition,
  PersistedReportCondition,
  ReportPlacementConfig,
  localWidgetSettings,
  PlacementScope,
  PlacementPresentation,
  reportSettings,
  type ReportType,
  type WidgetConfig,
} from "@reeve/contract/catalog";
import { FEATURES } from "@reeve/contract/features";
import { followsScope, SCOPED_REPORTS } from "@reeve/contract/rules";
import { eq } from "drizzle-orm";
import { invalid, notFound, type Book } from "../book.ts";
import * as t from "../db/schema.ts";
import { whereOf } from "./lines.ts";

export const reportCards = {
  "net-worth-card": "net-worth",
  "cash-flow-card": "cash-flow",
  "spending-card": "spending",
  "summary-card": "summary",
  "calendar-card": "calendar",
  "crossover-card": "crossover",
  "budget-analysis-card": "budget-analysis",
  "sankey-card": "sankey",
  "age-of-money-card": "age-of-money",
  "balance-forecast-card": "balance-forecast",
  "formula-card": "formula",
  "custom-report": "custom",
  "monte-carlo-card": "monte-carlo",
} as const satisfies Record<string, ReportType>;

export const reportLabels: Record<ReportType, string> = {
  "net-worth": "Net Worth",
  "cash-flow": "Cash Flow",
  spending: "Monthly Spending",
  summary: "Summary",
  calendar: "Calendar",
  crossover: "Crossover Point",
  "budget-analysis": "Budget Analysis",
  sankey: "Sankey",
  "age-of-money": "Age of Money",
  "balance-forecast": "Balance Forecast",
  formula: "Formula",
  custom: "Custom report",
  "monte-carlo": "Monte Carlo Analysis",
};

export const reportTypeOf = (type: string): ReportType | undefined =>
  Object.hasOwn(reportCards, type) ? reportCards[type as keyof typeof reportCards] : undefined;

export const recordOf = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const parse = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  value: unknown,
): S["Type"] => {
  try {
    return Schema.decodeUnknownSync(schema)(value, { onExcessProperty: "error" });
  } catch (error) {
    return invalid(`Invalid report or widget configuration: ${String(error)}`);
  }
};

export const frozenContent = (type: string, value: unknown): boolean => {
  if (FEATURES.purchases) return false;
  if (/(purchase|receipt|product|item[-_ ]?(spending|report|price|category))/i.test(type))
    return true;
  if (typeof value === "string") {
    try {
      return frozenContent("", JSON.parse(value));
    } catch {
      return false;
    }
  }
  if (Array.isArray(value)) return value.some((entry) => frozenContent("", entry));
  if (value !== null && typeof value === "object")
    return Object.entries(value).some(
      ([key, entry]) =>
        /^(purchase|receipt|product|itemCategory)(Id|Ids|Type)?$/i.test(key) ||
        (["type", "reportType", "path", "route"].includes(key) &&
          typeof entry === "string" &&
          /(purchase|receipt|product|items|item[-_])/i.test(entry)) ||
        frozenContent("", entry),
    );
  return false;
};

export const validateAccountScope = (
  book: Book,
  scope: { mode: string; ids?: ReadonlyArray<string> },
) => {
  if (scope.mode !== "selected") return;
  const ids = scope.ids ?? [];
  if (new Set(ids).size !== ids.length) invalid("Account scope must contain distinct account ids");
  for (const id of ids) {
    const account = book.db.select().from(t.accounts).where(eq(t.accounts.id, id)).get();
    if (account === undefined) return notFound("account", id);
    if (account.type !== "asset" && account.type !== "liability")
      invalid("Scope requires asset or liability accounts");
  }
};

const validDay = (value: string) => {
  if (value.length === 7) return true;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const validateConditions = (value: unknown): void => {
  if (Array.isArray(value)) {
    value.forEach(validateConditions);
    return;
  }
  for (const [key, child] of Object.entries(recordOf(value))) {
    if ((key === "conditions" || key === "divisorConditions") && Array.isArray(child)) {
      const conditions = parse(Schema.Array(PersistedReportCondition), child);
      for (const condition of conditions) {
        const operand = condition.value;
        if (["onBudget", "offBudget"].includes(condition.op)) {
          if (condition.field !== "account")
            invalid("Budget membership filters require the account field");
        } else if (["amount", "amount_inflow", "amount_outflow"].includes(condition.field)) {
          if (condition.op === "isbetween")
            parse(Schema.Struct({ num1: Schema.Int, num2: Schema.Int }), operand);
          else if (typeof operand !== "number" || !Number.isSafeInteger(operand))
            invalid("Amount filters require integer minor units");
        } else if (["cleared", "reconciled", "transfer"].includes(condition.field)) {
          if (typeof operand !== "boolean") invalid("State filters require a boolean");
        } else if (Array.isArray(operand)) {
          if (
            !["oneOf", "notOneOf"].includes(condition.op) ||
            !operand.every((entry) => entry === null || typeof entry === "string")
          )
            invalid("List filters require strings or ids");
        } else if (operand !== undefined && operand !== null && typeof operand !== "string")
          invalid("This filter requires a string or id");
      }
      whereOf(conditions, "and");
    } else validateConditions(child);
  }
};

export const validateDefinition = (book: Book, value: unknown): SavedReportDefinition => {
  const definition = parse(SavedReportDefinition, value);
  validateAccountScope(book, definition.scope.accounts);
  validateConditions(definition.settings);
  if (definition.scope.accounts.mode !== "all" && !followsScope(definition))
    invalid("This report does not follow accounts, so it cannot have an account scope");
  if (definition.type === "balance-forecast") {
    for (const ids of [
      definition.settings.accounts,
      ...(definition.settings.series ?? []).map((series) => series.accounts),
    ])
      if (ids !== undefined) validateAccountScope(book, { mode: "selected", ids });
  }
  if (definition.type === "monte-carlo") {
    for (const pot of definition.settings.pots ?? [])
      if (pot.accountId != null)
        validateAccountScope(book, { mode: "selected", ids: [pot.accountId] });
  }
  if (definition.type === "crossover") {
    validateAccountScope(book, {
      mode: "selected",
      ids: definition.settings.incomeAccountIds ?? [],
    });
    for (const id of definition.settings.expenseCategoryIds ?? []) {
      const category = book.db.select().from(t.accounts).where(eq(t.accounts.id, id)).get();
      if (category === undefined) return notFound("category", id);
      if (category.type !== "expense")
        invalid("Crossover expense categories must be expense accounts");
    }
  }
  const settings = recordOf(definition.settings);
  const frame = recordOf(settings.timeFrame);
  for (const day of [frame.start, frame.end, settings.startDate, settings.endDate])
    if (typeof day === "string" && !validDay(day)) invalid("Invalid calendar date");
  for (const [start, end] of [
    [frame.start, frame.end],
    [settings.startDate, settings.endDate],
  ])
    if (typeof start === "string" && typeof end === "string" && start > end)
      invalid("The start must not follow the end");
  if (
    definition.type === "custom" &&
    definition.settings.groupBy === "Tag" &&
    definition.settings.balanceType === "Budgeted"
  )
    invalid("Budgeted reports cannot be split by tags.");
  if (definition.type === "crossover") {
    const s = definition.settings;
    if (
      s.safeWithdrawalRate !== undefined &&
      (s.safeWithdrawalRate <= 0 || s.safeWithdrawalRate > 1)
    )
      invalid("Withdrawal rate must be greater than zero and at most one");
    if (s.expenseAdjustmentFactor !== undefined && s.expenseAdjustmentFactor < 0)
      invalid("Expense adjustment cannot be negative");
  }
  return definition;
};

export const defaultConfig = (): WidgetConfig => ({
  version: 1,
  title: null,
  presentation: {},
  scope: { accounts: { mode: "inherit" } },
});

export const validateConfig = (book: Book, type: string, value: unknown): WidgetConfig => {
  const reportType = reportTypeOf(type);
  let config: WidgetConfig;
  if (reportType !== undefined) config = parse(ReportPlacementConfig, value);
  else {
    if (!Object.hasOwn(localWidgetSettings, type)) return invalid("Unsupported widget type");
    const settings = localWidgetSettings[type as keyof typeof localWidgetSettings];
    const fields = {
      version: Schema.Literal(1),
      title: Schema.NullOr(Schema.String),
      presentation: PlacementPresentation,
      settings,
    };
    config =
      type === "markdown-card"
        ? parse(Schema.Struct(fields), value)
        : parse(Schema.Struct({ ...fields, scope: PlacementScope }), value);
  }
  if (
    config.presentation.fontSize !== undefined &&
    type !== "summary-card" &&
    type !== "formula-card"
  )
    invalid("Font size is only supported by summary and formula widgets");
  if ("scope" in config && config.scope?.accounts.mode === "fixed") {
    if (reportType === undefined || !SCOPED_REPORTS.has(reportType))
      invalid("Only a report that follows accounts can have a fixed account scope");
    validateAccountScope(book, config.scope.accounts.value);
  }
  return config;
};

export const legacySettings = (
  type: ReportType,
  meta: Record<string, unknown>,
  strict: boolean,
) => {
  const { name: _name, fontSize: _fontSize, ...fields } = meta;
  if (type === "summary" && typeof fields.content === "string") {
    const content = recordOf(JSON.parse(fields.content));
    const { fontSize: _font, ...rest } = content;
    fields.content = rest;
  }
  return Schema.decodeUnknownSync(reportSettings[type])(fields, {
    onExcessProperty: strict ? "error" : "ignore",
  });
};

export const same = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right))
    return left.length === right.length && left.every((v, i) => same(v, right[i]));
  if (left !== null && right !== null && typeof left === "object" && typeof right === "object") {
    const a = Object.entries(left),
      b = Object.entries(right);
    return (
      a.length === b.length &&
      a.every(([key, value]) => Object.hasOwn(right, key) && same(value, recordOf(right)[key]))
    );
  }
  return false;
};
