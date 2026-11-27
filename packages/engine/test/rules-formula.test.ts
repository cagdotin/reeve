// Ported from Actual's loot-core rules tests: formula-action.test.ts, split-parent-context.test.ts
// and shared/rules.test.ts.
import { beforeEach, describe, expect, it, test } from "vitest";
import { Action } from "../src/rules/action.ts";
import { getValidOps, isValidOp } from "../src/rules/fields.ts";
import { executeFormula, setFormulaPreferences } from "../src/rules/formula.ts";
import { Rule } from "../src/rules/rule.ts";

describe("Formula-based rule actions", () => {
  beforeEach(() => {
    setFormulaPreferences({
      currencySymbol: "$",
      decimalPlaces: 2,
      thousandsSeparator: ",",
      decimalSeparator: ".",
      currencySymbolPosition: "before",
      currencySpaceBetweenAmountAndSymbol: false,
    });
  });

  it("should execute a simple math formula", () => {
    const transaction: Record<string, any> = { amount: 500 };
    const result = executeFormula("=100 + 200", transaction);

    expect(result).toBe(300);
  });

  it("should use transaction field variables", () => {
    const transaction = { amount: 5000 };
    const result = executeFormula("=amount", transaction);

    expect(result).toBe(50);
  });

  it("should provide amount and parent_amount as amounts, not integers", () => {
    const transaction: Record<string, any> = {
      amount: -4567,
      parent_amount: 20000,
    };

    expect(executeFormula("=amount", transaction)).toBe(-45.67);
    expect(executeFormula("=parent_amount * 0.5", transaction)).toBe(100);
  });

  it("should leave non-monetary numeric fields alone", () => {
    const transaction: Record<string, any> = {
      amount: 100,
      sort_order: 1234,
    };

    expect(executeFormula("=sort_order", transaction)).toBe(1234);
  });

  it("should support IF function with transaction fields", () => {
    const transaction1 = { amount: 1000 };
    const result1 = executeFormula('=IF(amount > 0, "Income", "Expense")', transaction1);
    expect(result1).toBe("Income");

    const transaction2 = { amount: -1000 };
    const result2 = executeFormula('=IF(amount > 0, "Income", "Expense")', transaction2);
    expect(result2).toBe("Expense");
  });

  it("should support UPPER string function", () => {
    const transaction = { notes: "hello world" };
    const result = executeFormula("=UPPER(notes)", transaction);

    expect(result).toBe("HELLO WORLD");
  });

  it("should support CONCATENATE function", () => {
    const transaction = {
      imported_payee: "Store Name",
      notes: "Purchase",
    };
    const result = executeFormula('=CONCATENATE(imported_payee, " - ", notes)', transaction);

    expect(result).toBe("Store Name - Purchase");
  });

  it("should support LEFT function", () => {
    const transaction = { imported_payee: "Store Name" };
    const result = executeFormula("=LEFT(imported_payee, 5)", transaction);

    expect(result).toBe("Store");
  });

  it("should provide today variable", () => {
    const transaction = { date: "2024-01-01" };
    const result = executeFormula('=TEXT(today,"YYYY-MM-DD")', transaction);

    // Should be a date string in YYYY-MM-DD format
    expect(typeof result).toBe("string");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("should throw error for invalid formula", () => {
    const transaction = { amount: 100 };

    expect(() => {
      executeFormula("=INVALID_FUNCTION()", transaction);
    }).toThrow("Formula error");
  });

  it("should throw error for formula without = prefix", () => {
    const transaction = { amount: 100 };

    expect(() => {
      executeFormula("amount + 100", transaction);
    }).toThrow("Formula must start with =");
  });

  it("should support balance field variable", () => {
    const transaction: Record<string, any> = {
      balance: 1500,
      notes: "original",
    };
    const result = executeFormula("=balance * 2", transaction);

    expect(result).toBe(30);
  });

  it("should support BALANCE_OF with prefetched map", () => {
    const transaction: Record<string, any> = {
      notes: "original",
      _balanceOfPrefetched: new Map([
        ["Savings", 50000],
        ["550e8400-e29b-41d4-a716-446655440000", 1200],
      ]),
    };
    const byName = executeFormula('=BALANCE_OF("Savings") + 100', transaction);
    expect(byName).toBe(600);

    const byId = executeFormula('=BALANCE_OF("550e8400-e29b-41d4-a716-446655440000")', transaction);
    expect(byId).toBe(12);
  });

  it("should return 0 for BALANCE_OF when literal missing from prefetch map", () => {
    const transaction: Record<string, any> = {
      amount: 100,
      _balanceOfPrefetched: new Map(),
    };
    const result = executeFormula('=BALANCE_OF("Unknown")', transaction);
    expect(result).toBe(0);
  });

  it("should execute formula and convert to number type", () => {
    const action = new Action("set", "amount", null, {
      formula: "=500 + 250",
    });

    const transaction = { amount: 100 };
    action.exec(transaction);

    expect(transaction.amount).toBe(75000);
  });

  it("should round-trip the amount field through a formula", () => {
    const action = new Action("set", "amount", null, { formula: "=amount" });

    const transaction = { amount: 12345 };
    action.exec(transaction);

    expect(transaction.amount).toBe(12345);
  });

  it("should apply a percentage to the amount field", () => {
    const action = new Action("set", "amount", null, {
      formula: "=amount * 1.05",
    });

    const transaction = { amount: -10000 };
    action.exec(transaction);

    expect(transaction.amount).toBe(-10500);
  });

  it("should execute formula and convert to string type", () => {
    const action = new Action("set", "notes", null, {
      formula: '=UPPER("hello")',
    });

    const transaction = { notes: "original" };
    action.exec(transaction);

    expect(transaction.notes).toBe("HELLO");
  });

  it("should handle formula errors gracefully", () => {
    const action = new Action("set", "notes", null, {
      formula: "=1/0", // Division by zero
    });

    const transaction = { notes: "original" };

    // Should not throw, but keep original value on error
    expect(() => {
      action.exec(transaction);
    }).not.toThrow();

    // Original value should be preserved
    expect(transaction.notes).toBe("original");
  });

  it("should validate numeric field output", () => {
    const action = new Action("set", "amount", null, {
      formula: '=UPPER("test")', // Returns string for numeric field
    });

    const transaction = { amount: 100 };
    action.exec(transaction);

    // Should keep original value when formula produces non-numeric result
    expect(transaction.amount).toBe(100);
  });

  it("should convert non-string results to string for text fields", () => {
    const action = new Action("set", "notes", null, {
      formula: "=500 + 250", // Returns number
    });

    const transaction = { notes: "original" };
    action.exec(transaction);

    // Text fields get the number the formula produced, not an amount scaled
    // up for storage
    expect(transaction.notes).toBe("750");
  });

  it("should format numbers with thousands separators using FORMATNUMBER", () => {
    const action = new Action("set", "notes", null, {
      formula: "=FORMATNUMBER(1234567.89, 2)",
    });

    const transaction = { notes: "original" };
    action.exec(transaction);

    expect(transaction.notes).toBe("1,234,567.89");
  });

  it("should format numbers using number-format preferences with FORMATNUMBER", () => {
    setFormulaPreferences({
      currencySymbol: "$",
      decimalPlaces: 2,
      thousandsSeparator: ".",
      decimalSeparator: ",",
      currencySymbolPosition: "before",
      currencySpaceBetweenAmountAndSymbol: false,
    });

    const action = new Action("set", "notes", null, {
      formula: "=FORMATNUMBER(1234567.89, 2)",
    });

    const transaction = { notes: "original" };
    action.exec(transaction);

    expect(transaction.notes).toBe("1.234.567,89");
  });

  it("should format numbers using decimal-place preferences with FORMATNUMBER", () => {
    setFormulaPreferences({
      currencySymbol: "¥",
      decimalPlaces: 0,
      thousandsSeparator: ",",
      decimalSeparator: ".",
      currencySymbolPosition: "before",
      currencySpaceBetweenAmountAndSymbol: false,
    });

    const action = new Action("set", "notes", null, {
      formula: "=FORMATNUMBER(1234567.89)",
    });

    const transaction = { notes: "original" };
    action.exec(transaction);

    expect(transaction.notes).toBe("1,234,568");
  });

  it("should let FORMATNUMBER decimals override decimal-place preferences", () => {
    setFormulaPreferences({
      currencySymbol: "¥",
      decimalPlaces: 0,
      thousandsSeparator: ",",
      decimalSeparator: ".",
      currencySymbolPosition: "before",
      currencySpaceBetweenAmountAndSymbol: false,
    });

    const action = new Action("set", "notes", null, {
      formula: "=FORMATNUMBER(1234567.89, 2)",
    });

    const transaction = { notes: "original" };
    action.exec(transaction);

    expect(transaction.notes).toBe("1,234,567.89");
  });

  it("should format numbers with custom separators using FORMATNUMBER", () => {
    const action = new Action("set", "notes", null, {
      formula: '=FORMATNUMBER(1234567.89, 2, ".", ",")',
    });

    const transaction = { notes: "original" };
    action.exec(transaction);

    expect(transaction.notes).toBe("1.234.567,89");
  });

  it("should format numbers without decimals using FORMATNUMBER", () => {
    const action = new Action("set", "notes", null, {
      formula: "=FORMATNUMBER(1234567, 0)",
    });

    const transaction = { notes: "original" };
    action.exec(transaction);

    expect(transaction.notes).toBe("1,234,567");
  });

  it("should let IFERROR catch invalid FORMATNUMBER values", () => {
    const action = new Action("set", "notes", null, {
      formula: '=IFERROR(FORMATNUMBER("not a number"), "fallback")',
    });

    const transaction = { notes: "original" };
    action.exec(transaction);

    expect(transaction.notes).toBe("fallback");
  });

  it("should format currency with default settings using FORMATCURRENCY", () => {
    const action = new Action("set", "notes", null, {
      formula: "=FORMATCURRENCY(1234567.89)",
    });

    const transaction = { notes: "original" };
    action.exec(transaction);

    expect(transaction.notes).toBe("$1,234,567.89");
  });

  it("should use cached currency preferences when FORMATCURRENCY arguments are omitted", () => {
    setFormulaPreferences({
      currencySymbol: "R$",
      decimalPlaces: 2,
      thousandsSeparator: ".",
      decimalSeparator: ",",
      currencySymbolPosition: "before",
      currencySpaceBetweenAmountAndSymbol: false,
    });

    const action = new Action("set", "notes", null, {
      formula: "=FORMATCURRENCY(SUM(1, 2, 3))",
    });

    const transaction = { notes: "original" };
    action.exec(transaction);

    expect(transaction.notes).toBe("R$6,00");
  });

  it("should use cached currency symbol position and spacing preferences", () => {
    setFormulaPreferences({
      currencySymbol: "R$",
      decimalPlaces: 2,
      thousandsSeparator: ".",
      decimalSeparator: ",",
      currencySymbolPosition: "after",
      currencySpaceBetweenAmountAndSymbol: true,
    });

    const action = new Action("set", "notes", null, {
      formula: "=FORMATCURRENCY(SUM(1, 2, 3))",
    });

    const transaction = { notes: "original" };
    action.exec(transaction);

    expect(transaction.notes).toBe("6,00\u202FR$");
  });

  it("should format currency with custom symbol using FORMATCURRENCY", () => {
    const action = new Action("set", "notes", null, {
      formula: '=FORMATCURRENCY(1234567.89, "€")',
    });

    const transaction = { notes: "original" };
    action.exec(transaction);

    expect(transaction.notes).toBe("€1,234,567.89");
  });

  it("should use cached currency position and spacing preferences with custom symbols", () => {
    setFormulaPreferences({
      currencySymbol: "R$",
      decimalPlaces: 2,
      thousandsSeparator: ".",
      decimalSeparator: ",",
      currencySymbolPosition: "after",
      currencySpaceBetweenAmountAndSymbol: true,
    });

    const action = new Action("set", "notes", null, {
      formula: '=FORMATCURRENCY(1234567.89, "€")',
    });

    const transaction = { notes: "original" };
    action.exec(transaction);

    expect(transaction.notes).toBe("1.234.567,89\u202F€");
  });

  it("should override cached currency position and spacing preferences with custom arguments", () => {
    setFormulaPreferences({
      currencySymbol: "R$",
      decimalPlaces: 2,
      thousandsSeparator: ".",
      decimalSeparator: ",",
      currencySymbolPosition: "after",
      currencySpaceBetweenAmountAndSymbol: true,
    });

    const action = new Action("set", "notes", null, {
      formula: '=FORMATCURRENCY(1234567.89, "€", 2, ".", ",", "before", FALSE())',
    });

    const transaction = { notes: "original" };
    action.exec(transaction);

    expect(transaction.notes).toBe("€1.234.567,89");
  });

  it("should format negative currency correctly using FORMATCURRENCY", () => {
    const action = new Action("set", "notes", null, {
      formula: "=FORMATCURRENCY(-1234567.89)",
    });

    const transaction = { notes: "original" };
    action.exec(transaction);

    expect(transaction.notes).toBe("-$1,234,567.89");
  });

  it("should format currency with custom separators using FORMATCURRENCY", () => {
    const action = new Action("set", "notes", null, {
      formula: '=FORMATCURRENCY(1234567.89, "€", 2, ".", ",")',
    });

    const transaction = { notes: "original" };
    action.exec(transaction);

    expect(transaction.notes).toBe("€1.234.567,89");
  });

  it("should let IFERROR catch invalid FORMATCURRENCY values", () => {
    const action = new Action("set", "notes", null, {
      formula: '=IFERROR(FORMATCURRENCY("not a number"), "fallback")',
    });

    const transaction = { notes: "original" };
    action.exec(transaction);

    expect(transaction.notes).toBe("fallback");
  });
});

function splitRule(formula: string) {
  return new Rule({
    conditionsOp: "and",
    conditions: [{ field: "amount", op: "lt", value: 0 }],
    actions: [
      {
        op: "set",
        field: "notes",
        value: "child notes",
        options: { splitIndex: 1 },
      },
      {
        op: "set-split-amount",
        field: "amount",
        value: 0,
        options: { splitIndex: 1, method: "formula", formula },
      },
      {
        op: "set-split-amount",
        field: "amount",
        value: 0,
        options: { splitIndex: 2, method: "remainder" },
      },
    ],
  });
}

const parent = {
  id: "parent",
  account: "source-account",
  payee: "source-payee",
  amount: -3000,
  notes: "ITEM: 25.50USD FEE: 4.50USD",
  imported_payee: "Imported bank",
  imported_id: "bank-id",
  cleared: true,
  schedule: "schedule-id",
  date: "2024-01-15",
};

describe("split parent formula context", () => {
  test("reads parent_amount as an amount", () => {
    expect(splitRule("=parent_amount / 2").exec(parent)).toMatchObject({
      subtransactions: [{ amount: -1500 }, { amount: -1500 }],
    });
  });

  test("reads parent notes independently of child notes", () => {
    expect(
      splitRule('=IF(parent_notes="' + parent.notes + '", -1, -2)').exec(parent),
    ).toMatchObject({
      subtransactions: [{ amount: -100, notes: "child notes" }, { amount: -2900 }],
    });
  });

  test("parses a decimal amount from parent notes using native functions", async () => {
    const result = splitRule(
      '=-VALUE(MID(parent_notes, SEARCH("ITEM: ", parent_notes)+6, SEARCH("USD", parent_notes, SEARCH("ITEM: ", parent_notes))-SEARCH("ITEM: ", parent_notes)-6))',
    ).apply(parent);
    expect(result).toMatchObject({
      ...parent,
      payee: null,
      is_parent: true,
      subtransactions: [{ amount: -2550 }, { amount: -450 }],
    });
  });

  test.each(["parent_imported_payee", "parent_payee", "parent_account"] as const)(
    "exposes %s without overwriting child fields",
    (field) => {
      const original = {
        parent_imported_payee: parent.imported_payee,
        parent_payee: parent.payee,
        parent_account: parent.account,
      };
      expect(splitRule(`=IF(${field}="${original[field]}", -1, -2)`).exec(parent)).toMatchObject({
        subtransactions: [{ amount: -100 }, { amount: -2900 }],
      });
    },
  );

  test.each(["=1+1", "00123", "2024-01-15", "'quoted"])(
    "treats parent text %s literally",
    (notes) => {
      expect(
        splitRule(`=IF(parent_notes="${notes}", -1, -2)`).exec({
          ...parent,
          notes,
        }),
      ).toMatchObject({
        subtransactions: [{ amount: -100 }, { amount: -2900 }],
      });
    },
  );

  test("absent parent text is empty", () => {
    expect(splitRule('=IF(parent_notes="", -1, -2)').exec({ amount: -300 })).toMatchObject({
      subtransactions: [{ amount: -100 }, { amount: -200 }],
    });
  });
});

describe("rules", () => {
  describe("isValidOp", () => {
    it("should return false for oneOf operation on notes field", () => {
      expect(isValidOp("notes", "oneOf")).toBe(false);
    });

    it("should return false for notOneOf operation on notes field", () => {
      expect(isValidOp("notes", "notOneOf")).toBe(false);
    });

    it("should return true for valid string operations on notes field", () => {
      expect(isValidOp("notes", "is")).toBe(true);
      expect(isValidOp("notes", "isNot")).toBe(true);
      expect(isValidOp("notes", "contains")).toBe(true);
      expect(isValidOp("notes", "doesNotContain")).toBe(true);
      expect(isValidOp("notes", "matches")).toBe(true);
      expect(isValidOp("notes", "hasTags")).toBe(true);
      expect(isValidOp("notes", "hasAnyTag")).toBe(true);
    });

    it("should return true for oneOf operation on payee field", () => {
      expect(isValidOp("payee", "oneOf")).toBe(true);
    });

    it("should return true for notOneOf operation on payee field", () => {
      expect(isValidOp("payee", "notOneOf")).toBe(true);
    });
  });

  describe("getValidOps", () => {
    it("should not include oneOf and notOneOf for notes field", () => {
      const validOps = getValidOps("notes");
      expect(validOps).not.toContain("oneOf");
      expect(validOps).not.toContain("notOneOf");
    });

    it("should include other valid string operations for notes field", () => {
      const validOps = getValidOps("notes");
      expect(validOps).toContain("is");
      expect(validOps).toContain("isNot");
      expect(validOps).toContain("contains");
      expect(validOps).toContain("doesNotContain");
      expect(validOps).toContain("matches");
      expect(validOps).toContain("hasTags");
      expect(validOps).toContain("hasAnyTag");
    });

    it("should include oneOf and notOneOf for payee field", () => {
      const validOps = getValidOps("payee");
      expect(validOps).toContain("oneOf");
      expect(validOps).toContain("notOneOf");
    });
  });
});
