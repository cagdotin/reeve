import * as dateFns from "date-fns";
import {
  addDays,
  formatDate,
  isAfter,
  isBefore,
  parseDate,
  recurSchedule,
  subDays,
  type RecurSchedule,
  type Recurrence,
} from "./dates.ts";
import {
  extractTagsForFilter,
  fieldType,
  getApproxNumberThreshold,
  isAccountNumber,
  isValidOp,
  sortNumbers,
  type FieldType,
} from "./fields.ts";

/** A rule that cannot work as written: `type` says what is wrong, as Actual's `RuleError`. */
export class RuleError extends Error {
  readonly type: string;
  constructor(type: string, message: string) {
    super(message);
    this.type = type;
  }
}

export function assert(test: unknown, type: string, message: string): asserts test {
  if (!test) throw new RuleError(type, message);
}

export type ParsedDate =
  | { readonly type: "date" | "month" | "year"; readonly date: string }
  | { readonly type: "recur"; readonly schedule: RecurSchedule };

export type ParsedNumber =
  | { readonly type: "literal"; readonly value: number }
  | { readonly type: "between"; readonly num1: number; readonly num2: number };

export const parseDateString = (value: unknown): ParsedDate | null => {
  if (typeof value !== "string") return null;
  if (value.length === 10)
    return dateFns.isValid(dateFns.parseISO(value)) ? { type: "date", date: value } : null;
  if (value.length === 7)
    return dateFns.isValid(dateFns.parseISO(`${value}-01`)) ? { type: "month", date: value } : null;
  if (value.length === 4)
    return dateFns.isValid(dateFns.parseISO(`${value}-01-01`))
      ? { type: "year", date: value }
      : null;
  return null;
};

export const parseRecurDate = (value: Recurrence): ParsedDate => {
  try {
    return { type: "recur", schedule: recurSchedule(value) };
  } catch (error) {
    throw new RuleError("parse-recur-date", error instanceof Error ? error.message : String(error));
  }
};

export const parseBetweenAmount = (value: unknown): ParsedNumber | null => {
  if (typeof value !== "object" || value === null) return null;
  const { num1, num2 } = value as { num1?: unknown; num2?: unknown };
  if (typeof num1 !== "number" || typeof num2 !== "number") return null;
  return { type: "between", num1, num2 };
};

const parseValue = (type: FieldType, op: string, value: any, field: string): unknown => {
  switch (type) {
    case "date": {
      const parsed =
        typeof value === "string"
          ? parseDateString(value)
          : value?.frequency != null
            ? parseRecurDate(value)
            : null;
      assert(parsed, "date-format", `Invalid date format (field: ${field})`);
      if (op === "isapprox")
        assert(
          parsed.type === "date" || parsed.type === "recur",
          "date-format",
          `Invalid date value for "isapprox" (field: ${field})`,
        );
      else if (op === "gt" || op === "gte" || op === "lt" || op === "lte")
        assert(
          parsed.type === "date",
          "date-format",
          `Invalid date value for "${op}" (field: ${field})`,
        );
      return parsed;
    }
    case "id":
      if (op === "oneOf" || op === "notOneOf" || op === "and")
        assert(
          Array.isArray(value),
          "no-empty-array",
          `oneOf must have an array value (field: ${field})`,
        );
      return value;
    case "string": {
      if (op === "oneOf" || op === "notOneOf") {
        assert(
          Array.isArray(value),
          "no-empty-array",
          `oneOf must have an array value (field: ${field}): ${JSON.stringify(value)}`,
        );
        return value.filter(Boolean).map((each: string) => String(each).toLowerCase());
      }
      assert(typeof value === "string", "not-string", `Invalid string value (field: ${field})`);
      if (["contains", "matches", "doesNotContain", "hasTags", "hasAnyTag"].includes(op))
        assert(
          value.length > 0,
          "no-empty-string",
          `${op} must have non-empty string (field: ${field})`,
        );
      return op === "hasTags" || op === "hasAnyTag" ? value : value.toLowerCase();
    }
    case "number": {
      const parsed: ParsedNumber | null =
        typeof value === "number" ? { type: "literal", value } : parseBetweenAmount(value);
      assert(
        parsed !== null,
        "not-number",
        `Value must be a number or between amount: ${JSON.stringify(value)} (field: ${field})`,
      );
      if (op === "isbetween")
        assert(
          parsed.type === "between",
          "number-format",
          `Invalid between value for "${op}" (field: ${field})`,
        );
      else
        assert(
          parsed.type === "literal",
          "number-format",
          `Invalid number value for "${op}" (field: ${field})`,
        );
      return parsed;
    }
    case "boolean":
      assert(
        typeof value === "boolean",
        "not-boolean",
        `Value must be a boolean: ${value} (field: ${field})`,
      );
      return value;
  }
};

export interface ConditionOptions {
  readonly inflow?: boolean;
  readonly outflow?: boolean;
}

const withoutSpaces = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(withoutSpaces)
    : typeof value === "string"
      ? value.replace(/\s+/g, "")
      : value;

const tagPattern = (tag: string) =>
  new RegExp(`(?<!#)${tag.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([\\s#]|$)`);

/** One condition of a rule, checked against a transaction shaped as Actual's rules see it. */
export class Condition {
  readonly field: string;
  readonly op: string;
  readonly options: ConditionOptions | null | undefined;
  readonly rawValue: unknown;
  readonly type: FieldType;
  readonly value: any;

  constructor(op: string, field: string, value: unknown, options?: ConditionOptions | null) {
    const type = fieldType(field);
    assert(type, "internal", `Invalid condition field: ${field}`);
    assert(
      isValidOp(field, op),
      "internal",
      `Invalid condition operator: ${op} (type: ${type}, field: ${field})`,
    );
    if (type !== "id" && type !== "string")
      assert(value != null, "no-null", `Field cannot be empty: ${field}`);
    this.rawValue = value;
    this.op = op;
    this.field = field;
    const parsed = parseValue(type, op, value, field);
    this.value = isAccountNumber(field) && op !== "matches" ? withoutSpaces(parsed) : parsed;
    this.options = options;
    this.type = type;
  }

  eval(object: Record<string, any>): boolean {
    let fieldValue = object[this.field];
    const { type } = this;
    if (isAccountNumber(this.field)) {
      if (!fieldValue) return false;
      fieldValue = withoutSpaces(fieldValue);
    }
    if (type === "string") fieldValue ??= "";
    if (fieldValue === undefined) return false;
    if (typeof fieldValue === "string") fieldValue = fieldValue.toLowerCase();

    if (type === "number" && this.options) {
      if (this.options.outflow) {
        if (fieldValue > 0) return false;
        fieldValue = -fieldValue;
      } else if (this.options.inflow && fieldValue < 0) return false;
    }

    const extract = (value: any) => (type === "number" ? value.value : value);

    switch (this.op) {
      case "isapprox":
      case "is":
        if (type === "date") {
          if (fieldValue == null) return false;
          if (this.value.type === "recur") {
            const schedule = this.value.schedule as RecurSchedule;
            const fieldDate = parseDate(fieldValue);
            return this.op === "isapprox"
              ? schedule.occursBetween(dateFns.subDays(fieldDate, 2), dateFns.addDays(fieldDate, 2))
              : schedule.occursOn({ date: fieldDate });
          }
          const { date } = this.value;
          if (this.op === "isapprox")
            return fieldValue >= subDays(date, 2) && fieldValue <= addDays(date, 2);
          switch (this.value.type) {
            case "date":
              return fieldValue === date;
            case "month":
              return formatDate(fieldValue, "yyyy-MM") === date;
            case "year":
              return formatDate(fieldValue, "yyyy") === date;
          }
          return false;
        }
        if (type === "number") {
          const number = this.value.value;
          if (this.op === "isapprox") {
            const threshold = getApproxNumberThreshold(number);
            return fieldValue >= number - threshold && fieldValue <= number + threshold;
          }
          return fieldValue === number;
        }
        return fieldValue === this.value;
      case "isNot":
        return fieldValue !== this.value;
      case "isbetween": {
        const [low, high] = sortNumbers(this.value.num1, this.value.num2);
        return fieldValue >= low && fieldValue <= high;
      }
      case "contains":
        return fieldValue !== null && String(fieldValue).includes(this.value);
      case "doesNotContain":
        return fieldValue !== null && !String(fieldValue).includes(this.value);
      case "oneOf":
        return fieldValue !== null && this.value.includes(fieldValue);
      case "notOneOf":
        return fieldValue !== null && !this.value.includes(fieldValue);
      case "hasTags":
        return (
          fieldValue !== null &&
          extractTagsForFilter(this.value).every((tag) => tagPattern(tag).test(String(fieldValue)))
        );
      case "hasAnyTag":
        return (
          fieldValue !== null &&
          extractTagsForFilter(this.value).some((tag) => tagPattern(tag).test(String(fieldValue)))
        );
      case "gt":
        if (fieldValue === null) return false;
        return type === "date"
          ? isAfter(fieldValue, this.value.date)
          : fieldValue > extract(this.value);
      case "gte":
        if (fieldValue === null) return false;
        return type === "date"
          ? fieldValue === this.value.date || isAfter(fieldValue, this.value.date)
          : fieldValue >= extract(this.value);
      case "lt":
        if (fieldValue === null) return false;
        return type === "date"
          ? isBefore(fieldValue, this.value.date)
          : fieldValue < extract(this.value);
      case "lte":
        if (fieldValue === null) return false;
        return type === "date"
          ? fieldValue === this.value.date || isBefore(fieldValue, this.value.date)
          : fieldValue <= extract(this.value);
      case "matches":
        if (fieldValue === null) return false;
        try {
          return new RegExp(this.value).test(fieldValue);
        } catch {
          return false;
        }
      case "onBudget":
        return object["_account"] ? object["_account"].offbudget === 0 : false;
      case "offBudget":
        return object["_account"] ? object["_account"].offbudget === 1 : false;
    }
    return false;
  }

  serialize() {
    return {
      op: this.op,
      field: this.field,
      value: this.rawValue,
      type: this.type,
      ...(this.options ? { options: this.options } : null),
    };
  }
}
