import * as dateFns from "date-fns";
import { assert } from "./condition.ts";
import { currentDay, formatDate, parseDate } from "./dates.ts";
import { fieldType, type FieldType } from "./fields.ts";
import { amountToInteger, executeFormula } from "./formula.ts";
import { templates } from "./handlebars.ts";

export const ACTION_OPS = [
  "set",
  "set-split-amount",
  "link-schedule",
  "prepend-notes",
  "append-notes",
  "delete-transaction",
] as const;
export type ActionOp = (typeof ACTION_OPS)[number];

export interface ActionOptions {
  readonly template?: string;
  readonly formula?: string;
  readonly splitIndex?: number;
  readonly method?: "fixed-amount" | "fixed-percent" | "remainder" | "formula";
}

const validDate = (value: string): string | null => {
  const parsed = parseDate(value);
  return dateFns.isValid(parsed) ? formatDate(parsed, "yyyy-MM-dd") : null;
};

/** One action of a rule, applied to a transaction shaped as Actual's rules see it. */
export class Action {
  readonly field: string | null;
  readonly op: ActionOp;
  readonly options: ActionOptions | null | undefined;
  readonly rawValue: unknown;
  readonly type: FieldType | null;
  readonly value: any;
  private readonly template: ((context: object) => string) | undefined;

  constructor(op: ActionOp, field: string | null, value: unknown, options?: ActionOptions | null) {
    assert(ACTION_OPS.includes(op), "internal", `Invalid action operation: ${op}`);
    let type: FieldType | null = null;
    let actionField: string | null = null;
    if (op === "set") {
      const typeName = field === null ? undefined : fieldType(field);
      assert(typeName, "internal", `Invalid field for action: ${field}`);
      actionField = field;
      type = typeName;
      if (options?.template) {
        const template = templates.compile(options.template, { noEscape: true });
        try {
          template({});
        } catch {
          assert(false, "invalid-template", "Invalid Handlebars template");
        }
        this.template = template;
      }
    } else if (op === "set-split-amount") type = "number";
    else if (op === "link-schedule") type = "id";
    else if (op === "prepend-notes" || op === "append-notes") {
      actionField = "notes";
      type = "id";
    }
    if (field === "account") assert(value, "no-null", `Field cannot be empty: ${field}`);
    this.op = op;
    this.field = actionField;
    this.type = type;
    this.rawValue = value;
    this.value = value;
    this.options = options;
  }

  exec(object: Record<string, any>): void {
    switch (this.op) {
      case "set": {
        const field = this.field!;
        if (this.options?.formula) this.setFromFormula(object, field, this.options.formula);
        else if (this.template) {
          const text = this.template({ ...object, today: currentDay() });
          switch (this.type) {
            case "number": {
              const number = parseFloat(text);
              object[field] = Number.isNaN(number) ? 0 : number;
              break;
            }
            case "date":
              // An invalid date sticks out rather than failing the transaction.
              object[field] = validDate(text) ?? "9999-12-31";
              break;
            case "boolean":
              object[field] = text === "true";
              break;
            default:
              object[field] = text;
          }
        } else object[field] = this.value;
        if (field === "payee_name") object["payee"] = "new";
        break;
      }
      case "set-split-amount":
        if (this.options?.method === "fixed-amount") object["amount"] = this.value;
        else if (this.options?.method === "formula") {
          const errors = (object["_ruleErrors"] ??= []) as Array<string>;
          if (!this.options.formula) {
            errors.push("Formula method selected but no formula specified");
            break;
          }
          try {
            const result = executeFormula(this.options.formula, object);
            const number = typeof result === "number" ? result : parseFloat(String(result));
            if (Number.isNaN(number))
              errors.push(
                `Formula for split amount must produce a numeric value. Got: ${JSON.stringify(result)}`,
              );
            else object["amount"] = amountToInteger(number);
          } catch (error) {
            errors.push(`Error executing formula for split amount: ${message(error)}`);
          }
        }
        break;
      case "link-schedule":
        object["schedule"] = this.value;
        break;
      case "prepend-notes":
        object["notes"] = object["notes"] ? this.value + object["notes"] : this.value;
        break;
      case "append-notes":
        object["notes"] = object["notes"] ? object["notes"] + this.value : this.value;
        break;
      case "delete-transaction":
        object["tombstone"] = 1;
        break;
    }
  }

  private setFromFormula(object: Record<string, any>, field: string, formula: string) {
    const errors = (object["_ruleErrors"] ??= []) as Array<string>;
    try {
      const result = executeFormula(formula, object);
      switch (this.type) {
        case "number": {
          const number = typeof result === "number" ? result : parseFloat(String(result));
          if (Number.isNaN(number))
            errors.push(
              `Formula for "${field}" must produce a numeric value. Got: ${JSON.stringify(result)}`,
            );
          else object[field] = amountToInteger(number);
          break;
        }
        case "date": {
          const day = validDate(String(result));
          if (day === null)
            errors.push(
              `Formula for "${field}" must produce a valid date. Got: ${JSON.stringify(result)}`,
            );
          else object[field] = day;
          break;
        }
        case "boolean":
          object[field] =
            typeof result === "boolean" ? result : String(result).toLowerCase() === "true";
          break;
        case "string":
          object[field] = String(result);
          break;
        default:
          break;
      }
    } catch (error) {
      errors.push(`Error executing formula for "${field}": ${message(error)}`);
    }
  }

  serialize() {
    return {
      op: this.op,
      field: this.field,
      value: this.value,
      type: this.type,
      ...(this.options ? { options: this.options } : {}),
    };
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
