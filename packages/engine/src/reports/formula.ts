/** Actual's formula card: a HyperFormula formula with functions that read the book. */
import { currentMonth, dayToInt } from "@reeve/contract/rules";
import {
  ArraySize,
  CellError,
  EmptyValue,
  ErrorType,
  FunctionArgumentType,
  FunctionPlugin,
  HyperFormula,
  SimpleRangeValue,
} from "hyperformula";
import type { Book } from "../book.ts";
import { computeMonths } from "../budget/view.ts";
import { categoryRows, filterCategoriesByConditions } from "./context.ts";
import { endDay, resolveTimeFrame, startDay, type TimeFrameMode } from "./dates.ts";
import { allOf, queryLines, sqlOf, whereOf, type Condition, type ConditionsOp } from "./lines.ts";

export interface FormulaQuery {
  readonly conditions?: ReadonlyArray<Condition>;
  readonly conditionsOp?: ConditionsOp;
  readonly timeFrame?: { start?: string; end?: string; mode?: TimeFrameMode };
}

interface Context {
  readonly book: Book;
  readonly queries: Readonly<Record<string, FormulaQuery>>;
}

const toAmount = (cents: number, places = 2) => cents / 10 ** places;

/** The months of a query's time frame, as Actual's `calculateTimeRange` on whole months. */
const monthsOf = (query: FormulaQuery) => {
  const frame = query.timeFrame;
  const slidingByMonth = frame?.mode === "sliding-window";
  return resolveTimeFrame(
    slidingByMonth ? frame?.start?.slice(0, 7) : frame?.start,
    slidingByMonth ? frame?.end?.slice(0, 7) : frame?.end,
    frame?.mode,
  );
};

const queryWhere = (query: FormulaQuery) => {
  const filters = whereOf(query.conditions, query.conditionsOp);
  if (query.timeFrame?.mode === undefined) return filters;
  const { start, end } = monthsOf(query);
  return allOf(
    filters,
    sqlOf("l.date >= ? AND l.date <= ?", dayToInt(startDay(start)), dayToInt(endDay(end))),
  );
};

/** The categories a query's category conditions name; without any, the visible expense ones. */
const queryCategories = (book: Book, query: FormulaQuery | undefined): Array<string> => {
  const categories = categoryRows(book);
  const conditions = (query?.conditions ?? []).filter(
    (condition) => condition.field === "category" || condition.field === "category_group",
  );
  if (conditions.length === 0)
    return categories
      .filter((category) => category.is_income === 0 && category.hidden === 0)
      .map((category) => category.id);
  return filterCategoriesByConditions(categories, conditions, query?.conditionsOp).map(
    (category) => category.id,
  );
};

const budgetValue = (
  book: Book,
  dimension: string,
  categories: ReadonlyArray<string>,
  startMonth: string,
  endMonth: string,
): number | CellError => {
  const dim = dimension.toLowerCase();
  if (!["budgeted", "spent", "balance_start", "balance_end", "goal"].includes(dim))
    return new CellError(ErrorType.VALUE, `Invalid BUDGET_QUERY dimension: ${dimension}`);
  if (!/^\d{4}-\d{2}$/.test(startMonth) || !/^\d{4}-\d{2}$/.test(endMonth) || endMonth < startMonth)
    return new CellError(ErrorType.VALUE, "BUDGET_QUERY takes months, YYYY-MM");
  const computed = computeMonths(book, endMonth);
  const months: Array<string> = [];
  for (let month = startMonth; month <= endMonth;) {
    months.push(month);
    const [year, index] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
    month = index === 12 ? `${year + 1}-01` : `${year}-${String(index + 1).padStart(2, "0")}`;
  }
  const cell = (month: string, id: string) =>
    computed.months.get(month)?.categories.find((category) => category.id === id);
  const sum = (value: (month: string, id: string) => number) =>
    months.reduce(
      (total, month) => total + categories.reduce((s, id) => s + value(month, id), 0),
      0,
    );
  if (dim === "budgeted") return toAmount(sum((month, id) => cell(month, id)?.budgeted ?? 0));
  if (dim === "spent") return toAmount(sum((month, id) => cell(month, id)?.spent ?? 0));
  if (dim === "goal") return toAmount(sum((month, id) => computed.goals(month, id).goal ?? 0));
  const carried = (month: string) =>
    categories.reduce((total, id) => {
      const found = cell(month, id);
      const balance = found?.balance ?? 0;
      return total + (balance > 0 || (balance < 0 && found?.carryover === true) ? balance : 0);
    }, 0);
  const previous = (() => {
    const [year, index] = [Number(startMonth.slice(0, 4)), Number(startMonth.slice(5, 7))];
    return index === 1 ? `${year - 1}-12` : `${year}-${String(index - 1).padStart(2, "0")}`;
  })();
  let running = carried(previous);
  let first: number | null = null;
  let last = 0;
  for (const month of months) {
    const budgeted = categories.reduce((s, id) => s + (cell(month, id)?.budgeted ?? 0), 0);
    const spent = categories.reduce((s, id) => s + (cell(month, id)?.spent ?? 0), 0);
    first ??= running;
    last = budgeted + spent + running;
    running = carried(month);
  }
  return toAmount(dim === "balance_start" ? (first ?? 0) : last);
};

const rangeIds = (range: SimpleRangeValue): Array<string> =>
  range
    .valuesFromTopLeftCorner()
    .filter(
      (value) =>
        value !== EmptyValue &&
        !(value instanceof CellError) &&
        (typeof value === "string" || typeof value === "number"),
    )
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

const formatNumber = (value: number, decimals: number, thousands: string, decimal: string) => {
  const [integer, fraction] = Math.abs(value).toFixed(decimals).split(".");
  const grouped = integer!.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  return `${value < 0 ? "-" : ""}${decimals > 0 && fraction ? `${grouped}${decimal}${fraction}` : grouped}`;
};

type Ast = { readonly args: Array<{ readonly type: string; readonly value?: unknown }> };

class BookFunctions extends FunctionPlugin {
  private get context(): Context {
    return this.config.context as Context;
  }

  private run(ast: Ast, state: unknown, name: string, fn: (...args: Array<any>) => unknown) {
    return this.runFunction(ast.args as never, state as never, this.metadata(name), fn as never);
  }

  private query(name: string): FormulaQuery | undefined {
    return this.context.queries[name];
  }

  querySum(ast: Ast, state: unknown) {
    return this.run(ast, state, "QUERY", (name: string) => {
      const query = this.query(name);
      if (query === undefined) return 0;
      const [row] = queryLines<{ amount: number | null }>(
        this.context.book,
        "sum(l.amount) AS amount",
        queryWhere(query),
      );
      return toAmount(row?.amount ?? 0);
    });
  }

  queryCount(ast: Ast, state: unknown) {
    return this.run(ast, state, "QUERY_COUNT", (name: string) => {
      const query = this.query(name);
      if (query === undefined) return 0;
      const [row] = queryLines<{ count: number }>(
        this.context.book,
        "count(*) AS count",
        queryWhere(query),
      );
      return row?.count ?? 0;
    });
  }

  balanceOf(ast: Ast, state: unknown) {
    return this.run(ast, state, "BALANCE_OF", (key: string) => {
      const row = this.context.book.client
        .prepare(
          `SELECT coalesce(sum(p.amount), 0) AS amount FROM postings p
           WHERE p.account_id = (
             SELECT id FROM accounts WHERE type IN ('asset', 'liability') AND (id = ? OR name = ?)
             ORDER BY id = ? DESC LIMIT 1)`,
        )
        .get(key, key, key) as { amount: number };
      return toAmount(row.amount);
    });
  }

  queryExtractCategories(ast: Ast, state: unknown) {
    return this.run(ast, state, "QUERY_EXTRACT_CATEGORIES", (name: string) => {
      const ids = queryCategories(this.context.book, this.query(name));
      return SimpleRangeValue.onlyValues(ids.length > 0 ? ids.map((id) => [id]) : [[""]]);
    });
  }

  queryExtractCategoriesSize(ast: Ast): ArraySize {
    const [arg] = ast.args;
    if (ast.args.length !== 1 || arg?.type !== "STRING") return ArraySize.error();
    const count = queryCategories(this.context.book, this.query(String(arg.value))).length;
    return new ArraySize(1, Math.max(count, 1));
  }

  queryExtractTimeframeStart(ast: Ast, state: unknown) {
    return this.run(ast, state, "QUERY_EXTRACT_TIMEFRAME_START", (name: string) => {
      const query = this.query(name);
      return query?.timeFrame === undefined ? currentMonth() : monthsOf(query).start.slice(0, 7);
    });
  }

  queryExtractTimeframeEnd(ast: Ast, state: unknown) {
    return this.run(ast, state, "QUERY_EXTRACT_TIMEFRAME_END", (name: string) => {
      const query = this.query(name);
      return query?.timeFrame === undefined ? currentMonth() : monthsOf(query).end.slice(0, 7);
    });
  }

  budgetQuery(ast: Ast, state: unknown) {
    return this.run(
      ast,
      state,
      "BUDGET_QUERY",
      (dimension: string, categories: SimpleRangeValue, start: string, end: string) =>
        budgetValue(this.context.book, dimension, rangeIds(categories), start, end),
    );
  }

  integerToAmount(ast: Ast, state: unknown) {
    return this.run(ast, state, "INTEGER_TO_AMOUNT", (value: number, places: number) =>
      toAmount(value, places),
    );
  }

  fixed(ast: Ast, state: unknown) {
    return this.run(ast, state, "FIXED", (value: number, decimals: number) =>
      Number(value).toFixed(decimals),
    );
  }

  formatNumberFn(ast: Ast, state: unknown) {
    return this.run(
      ast,
      state,
      "FORMATNUMBER",
      (value: number, decimals: number, thousands: string, decimal: string) =>
        formatNumber(Number(value), decimals, thousands, decimal),
    );
  }

  formatCurrency(ast: Ast, state: unknown) {
    return this.run(
      ast,
      state,
      "FORMATCURRENCY",
      (
        value: number,
        symbol: string,
        decimals: number,
        thousands: string,
        decimal: string,
        position: string,
        space: boolean,
      ) => {
        const amount = formatNumber(Math.abs(Number(value)), decimals, thousands, decimal);
        const gap = space ? " " : "";
        const text = position === "after" ? `${amount}${gap}${symbol}` : `${symbol}${gap}${amount}`;
        return Number(value) < 0 ? `-${text}` : text;
      },
    );
  }
}

const text = { argumentType: FunctionArgumentType.STRING };
const number = { argumentType: FunctionArgumentType.NUMBER };
const optional = <T>(argument: T, defaultValue: unknown) => ({
  ...argument,
  optionalArg: true,
  defaultValue,
});

BookFunctions.implementedFunctions = {
  QUERY: { method: "querySum", parameters: [text] },
  QUERY_COUNT: { method: "queryCount", parameters: [text] },
  BALANCE_OF: { method: "balanceOf", parameters: [text] },
  QUERY_EXTRACT_CATEGORIES: {
    method: "queryExtractCategories",
    sizeOfResultArrayMethod: "queryExtractCategoriesSize",
    parameters: [text],
  },
  QUERY_EXTRACT_TIMEFRAME_START: { method: "queryExtractTimeframeStart", parameters: [text] },
  QUERY_EXTRACT_TIMEFRAME_END: { method: "queryExtractTimeframeEnd", parameters: [text] },
  BUDGET_QUERY: {
    method: "budgetQuery",
    parameters: [text, { argumentType: FunctionArgumentType.RANGE }, text, text],
  },
  INTEGER_TO_AMOUNT: { method: "integerToAmount", parameters: [number, optional(number, 2)] },
  FIXED: { method: "fixed", parameters: [number, optional(number, 0)] },
  FORMATNUMBER: {
    method: "formatNumberFn",
    parameters: [number, optional(number, 2), optional(text, ","), optional(text, ".")],
  },
  FORMATCURRENCY: {
    method: "formatCurrency",
    parameters: [
      number,
      optional(text, "$"),
      optional(number, 2),
      optional(text, ","),
      optional(text, "."),
      optional(text, "before"),
      optional({ argumentType: FunctionArgumentType.BOOLEAN }, false),
    ],
  },
};

const LANGUAGE = "enGB";
let translated = false;

/** Evaluates a formula; an error in it comes back as `error`, not a failure. */
export const evaluateFormula = (
  book: Book,
  input: {
    readonly formula: string;
    readonly queries?: Readonly<Record<string, FormulaQuery>>;
    readonly namedExpressions?: Readonly<Record<string, number | string>>;
  },
): { result: number | string | boolean | null; error: string | null } => {
  if (!input.formula.startsWith("=")) return { result: null, error: "Formula must start with =" };
  if (!translated) {
    HyperFormula.getLanguage(LANGUAGE).extendFunctions(
      Object.fromEntries(Object.keys(BookFunctions.implementedFunctions).map((id) => [id, id])),
    );
    translated = true;
  }
  // The book's functions go on this instance only, so other HyperFormula users keep their own.
  const engine = HyperFormula.buildEmpty({
    licenseKey: "gpl-v3",
    language: LANGUAGE,
    dateFormats: ["DD/MM/YYYY", "YYYY-MM-DD", "YYYY/MM/DD"],
    functionPlugins: [
      ...HyperFormula.getAllFunctionPlugins().filter((plugin) => plugin !== BookFunctions),
      BookFunctions,
    ],
    context: { book, queries: input.queries ?? {} } satisfies Context,
  });
  try {
    const sheet = engine.getSheetId(engine.addSheet("Sheet1"))!;
    for (const [name, value] of Object.entries(input.namedExpressions ?? {}))
      engine.addNamedExpression(name, typeof value === "number" ? value : String(value));
    engine.setCellContents({ sheet, col: 0, row: 0 }, [[input.formula]]);
    const value = engine.getCellValue({ sheet, col: 0, row: 0 });
    if (value !== null && typeof value === "object")
      return { result: null, error: `Formula error: ${value.type}` };
    return { result: value, error: null };
  } catch (error) {
    return { result: null, error: error instanceof Error ? error.message : String(error) };
  } finally {
    engine.destroy();
  }
};
