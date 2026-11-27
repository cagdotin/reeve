import {
  CellError,
  ErrorType,
  FunctionArgumentType,
  FunctionPlugin,
  HyperFormula,
} from "hyperformula";
import enUS from "hyperformula/i18n/languages/enUS";

// HyperFormula does not export its AST and interpreter state types.
type ProcedureAst = { readonly args: Array<any> };
type InterpreterState = any;
import { currentDay } from "./dates.ts";

/** How FORMATNUMBER and FORMATCURRENCY write numbers when their arguments leave it open. */
export interface FormulaPreferences {
  readonly currencySymbol: string;
  readonly decimalPlaces: number;
  readonly thousandsSeparator: string;
  readonly decimalSeparator: string;
  readonly currencySymbolPosition: "before" | "after";
  readonly currencySpaceBetweenAmountAndSymbol: boolean;
}

export const DEFAULT_FORMULA_PREFERENCES: FormulaPreferences = {
  currencySymbol: "$",
  decimalPlaces: 2,
  thousandsSeparator: ",",
  decimalSeparator: ".",
  currencySymbolPosition: "before",
  currencySpaceBetweenAmountAndSymbol: false,
};

let preferences: FormulaPreferences = DEFAULT_FORMULA_PREFERENCES;

/** The book's number format for the formulas that run next, as Actual caches its preferences. */
export const setFormulaPreferences = (next: FormulaPreferences) => {
  preferences = next;
};

const SEPARATORS: Record<string, readonly [string, string]> = {
  "comma-dot": [",", "."],
  "dot-comma": [".", ","],
  "space-comma": [" ", ","],
  "apostrophe-dot": ["’", "."],
  "comma-dot-in": [",", "."],
};

const symbolOf = (currency: string): string => {
  if (currency === "") return "";
  try {
    const parts = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((part) => part.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
};

const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "HUF", "TWD", "UGX", "PYG"]);

/** Formula preferences from a book's currency and number format. */
export const formulaPreferencesFor = (
  currency: string,
  numberFormat: string,
): FormulaPreferences => {
  const [thousandsSeparator, decimalSeparator] = SEPARATORS[numberFormat] ?? [",", "."];
  return {
    ...DEFAULT_FORMULA_PREFERENCES,
    currencySymbol: symbolOf(currency),
    decimalPlaces: ZERO_DECIMAL.has(currency) ? 0 : 2,
    thousandsSeparator,
    decimalSeparator,
  };
};

const groupThousands = (value: number, decimals: number, thousands: string, decimal: string) => {
  const [integerPart = "", decimalPart] = Math.abs(value).toFixed(decimals).split(".");
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  return decimals > 0 && decimalPart ? `${grouped}${decimal}${decimalPart}` : grouped;
};

export const integerToAmount = (value: number, decimals = 2): number =>
  Number((value / 10 ** decimals).toFixed(decimals));

export const amountToInteger = (value: number, decimals = 2): number =>
  Math.round(value * 10 ** decimals);

interface FormulaContext {
  readonly balanceOfPrefetch?: Map<string, number>;
}

/** Actual's custom functions that make sense in a rule: balances and number formatting. */
class CustomFunctionsPlugin extends FunctionPlugin {
  static override implementedFunctions = {
    BALANCE_OF: {
      method: "balanceOf",
      parameters: [{ argumentType: FunctionArgumentType.STRING }],
    },
    FIXED: {
      method: "fixed",
      parameters: [
        { argumentType: FunctionArgumentType.NUMBER },
        { argumentType: FunctionArgumentType.NUMBER, optionalArg: true, defaultValue: 0 },
      ],
    },
    INTEGER_TO_AMOUNT: {
      method: "integerToAmount",
      parameters: [
        { argumentType: FunctionArgumentType.NUMBER },
        { argumentType: FunctionArgumentType.NUMBER, optionalArg: true, defaultValue: 2 },
      ],
    },
    FORMATNUMBER: {
      method: "formatNumber",
      parameters: [
        { argumentType: FunctionArgumentType.NUMBER },
        { argumentType: FunctionArgumentType.NUMBER, optionalArg: true, defaultValue: 2 },
        { argumentType: FunctionArgumentType.STRING, optionalArg: true, defaultValue: "," },
        { argumentType: FunctionArgumentType.STRING, optionalArg: true, defaultValue: "." },
      ],
    },
    FORMATCURRENCY: {
      method: "formatCurrency",
      parameters: [
        { argumentType: FunctionArgumentType.NUMBER },
        { argumentType: FunctionArgumentType.STRING, optionalArg: true, defaultValue: "$" },
        { argumentType: FunctionArgumentType.NUMBER, optionalArg: true, defaultValue: 2 },
        { argumentType: FunctionArgumentType.STRING, optionalArg: true, defaultValue: "," },
        { argumentType: FunctionArgumentType.STRING, optionalArg: true, defaultValue: "." },
        { argumentType: FunctionArgumentType.STRING, optionalArg: true, defaultValue: "before" },
        { argumentType: FunctionArgumentType.BOOLEAN, optionalArg: true, defaultValue: false },
      ],
    },
  };

  balanceOf(ast: ProcedureAst, state: InterpreterState) {
    return this.runFunction(ast.args, state, this.metadata("BALANCE_OF"), (key: string) => {
      const context = this.config.context as FormulaContext | undefined;
      return context?.balanceOfPrefetch?.get(key) ?? 0;
    });
  }

  fixed(ast: ProcedureAst, state: InterpreterState) {
    return this.runFunction(
      ast.args,
      state,
      this.metadata("FIXED"),
      (number: number, decimals: number = 0) => Number(number).toFixed(decimals),
    );
  }

  integerToAmount(ast: ProcedureAst, state: InterpreterState) {
    return this.runFunction(
      ast.args,
      state,
      this.metadata("INTEGER_TO_AMOUNT"),
      (value: number, decimals: number = 2) => integerToAmount(value, decimals),
    );
  }

  formatNumber(ast: ProcedureAst, state: InterpreterState) {
    const count = ast.args.length;
    return this.runFunction(
      ast.args,
      state,
      this.metadata("FORMATNUMBER"),
      (value: number, decimals?: number, thousands?: string, decimal?: string) => {
        const number = Number(value);
        if (Number.isNaN(number)) return new CellError(ErrorType.VALUE);
        const places = count > 1 ? (decimals ?? 2) : preferences.decimalPlaces;
        const text = groupThousands(
          number,
          places,
          count > 2 && thousands !== undefined ? thousands : preferences.thousandsSeparator,
          count > 3 && decimal !== undefined ? decimal : preferences.decimalSeparator,
        );
        return number < 0 ? `-${text}` : text;
      },
    );
  }

  formatCurrency(ast: ProcedureAst, state: InterpreterState) {
    const count = ast.args.length;
    return this.runFunction(
      ast.args,
      state,
      this.metadata("FORMATCURRENCY"),
      (
        value: number,
        symbol?: string,
        decimals?: number,
        thousands?: string,
        decimal?: string,
        position?: string,
        space?: boolean,
      ) => {
        const number = Number(value);
        if (Number.isNaN(number)) return new CellError(ErrorType.VALUE);
        const amount = groupThousands(
          number,
          count > 2 ? (decimals ?? 2) : preferences.decimalPlaces,
          count > 3 && thousands !== undefined ? thousands : preferences.thousandsSeparator,
          count > 4 && decimal !== undefined ? decimal : preferences.decimalSeparator,
        );
        const currency = count > 1 ? (symbol ?? "") : preferences.currencySymbol;
        const after =
          count > 5 && (position === "before" || position === "after")
            ? position === "after"
            : preferences.currencySymbolPosition === "after";
        const gap = (
          count > 6 && space !== undefined ? space : preferences.currencySpaceBetweenAmountAndSymbol
        )
          ? " "
          : "";
        const text = after ? `${amount}${gap}${currency}` : `${currency}${gap}${amount}`;
        return number < 0 ? `-${text}` : text;
      },
    );
  }
}

if (!HyperFormula.getRegisteredLanguagesCodes().includes("enUS"))
  HyperFormula.registerLanguage("enUS", enUS);
HyperFormula.registerFunctionPlugin(CustomFunctionsPlugin, {
  enUS: {
    BALANCE_OF: "BALANCE_OF",
    FIXED: "FIXED",
    INTEGER_TO_AMOUNT: "INTEGER_TO_AMOUNT",
    FORMATNUMBER: "FORMATNUMBER",
    FORMATCURRENCY: "FORMATCURRENCY",
  },
});

/** Transaction fields stored as minor units that a formula reads as the amounts people see. */
const MONETARY = new Set(["amount", "balance", "parent_amount"]);

/**
 * Evaluates a formula (`=...`) against a transaction, as Actual's `executeFormulaSync`: each field
 * is a named expression, amounts in major units; `today`, `account_name` and `category_name` too.
 */
export const executeFormula = (formula: string, transaction: Record<string, any>): unknown => {
  if (!formula || !formula.startsWith("=")) throw new Error("Formula must start with =");
  const balanceOfPrefetch = new Map<string, number>();
  for (const [key, value] of (transaction["_balanceOfPrefetched"] as Map<string, number>) ?? [])
    balanceOfPrefetch.set(key, integerToAmount(value));
  const hf = HyperFormula.buildEmpty({
    licenseKey: "gpl-v3",
    language: "enUS",
    dateFormats: ["DD/MM/YYYY", "YYYY-MM-DD", "YYYY/MM/DD"],
    context: { balanceOfPrefetch } satisfies FormulaContext,
  });
  try {
    const sheet = hf.getSheetId(hf.addSheet("Sheet1"));
    if (sheet === undefined) throw new Error("Failed to create sheet");
    const values: Record<string, unknown> = {
      ...transaction,
      today: currentDay(),
      account_name: transaction["_account_name"] || "",
      category_name: transaction["_category_name"] || "",
    };
    for (const [key, raw] of Object.entries(values)) {
      if (key.startsWith("_")) continue;
      let cell: string | number | boolean =
        raw === undefined || raw === null || typeof raw === "object"
          ? ""
          : MONETARY.has(key) && typeof raw === "number"
            ? integerToAmount(raw)
            : (raw as string | number | boolean);
      // Parent text is data even when it looks like a formula, a date or a number.
      if (key.startsWith("parent_") && typeof cell === "string") cell = `'${cell}`;
      hf.addNamedExpression(key, cell);
    }
    hf.setCellContents({ sheet, col: 0, row: 0 }, [[formula]]);
    const value = hf.getCellValue({ sheet, col: 0, row: 0 });
    if (value instanceof CellError || (value && typeof value === "object" && "type" in value))
      throw new Error(`Formula error: ${(value as CellError).message}`);
    return value;
  } finally {
    hf.destroy();
  }
};

/** Distinct account names or ids named in `BALANCE_OF("...")` calls. */
export const extractBalanceOfLiterals = (formula: string): Array<string> => {
  const found: Array<string> = [];
  for (const match of formula.matchAll(/BALANCE_OF\s*\(\s*"((?:[^"\\]|\\.)*)"\s*\)/gi)) {
    const decoded = match[1]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    if (!found.includes(decoded)) found.push(decoded);
  }
  return found;
};
