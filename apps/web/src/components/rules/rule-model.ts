import type {
  Rule,
  RuleAction,
  RuleCondition,
  RuleField,
  RuleOp,
  RuleSetField,
} from "@reeve/contract/catalog";

/** What kind of value a rule field holds, which decides its operators and its editor. */
export type FieldKind = "id" | "text" | "amount" | "date" | "boolean";

export const CONDITION_FIELDS: ReadonlyArray<{
  readonly field: RuleField;
  readonly label: string;
  readonly kind: FieldKind;
}> = [
  { field: "payee", label: "Payee", kind: "id" },
  { field: "imported_payee", label: "Imported payee", kind: "text" },
  { field: "counterparty_account", label: "Counterparty account", kind: "text" },
  { field: "account", label: "Account", kind: "id" },
  { field: "category", label: "Category", kind: "id" },
  { field: "category_group", label: "Category group", kind: "id" },
  { field: "notes", label: "Notes", kind: "text" },
  { field: "date", label: "Date", kind: "date" },
  { field: "amount", label: "Amount", kind: "amount" },
  { field: "amount_inflow", label: "Amount (inflow)", kind: "amount" },
  { field: "amount_outflow", label: "Amount (outflow)", kind: "amount" },
  { field: "cleared", label: "Cleared", kind: "boolean" },
  { field: "reconciled", label: "Reconciled", kind: "boolean" },
  { field: "transfer", label: "Is a transfer", kind: "boolean" },
];

export const SET_FIELDS: ReadonlyArray<{
  readonly field: RuleSetField;
  readonly label: string;
  readonly kind: FieldKind;
}> = [
  { field: "category", label: "Category", kind: "id" },
  { field: "payee", label: "Payee", kind: "id" },
  { field: "payee_name", label: "Payee name", kind: "text" },
  { field: "notes", label: "Notes", kind: "text" },
  { field: "account", label: "Account", kind: "id" },
  { field: "date", label: "Date", kind: "date" },
  { field: "amount", label: "Amount", kind: "amount" },
  { field: "cleared", label: "Cleared", kind: "boolean" },
  { field: "imported_payee", label: "Imported payee", kind: "text" },
  { field: "transfer_account", label: "Transfer to", kind: "id" },
];

export const OP_LABELS: Record<RuleOp, string> = {
  is: "is",
  isNot: "is not",
  oneOf: "is one of",
  notOneOf: "is not one of",
  contains: "contains",
  doesNotContain: "does not contain",
  matches: "matches",
  gt: "is greater than",
  gte: "is greater than or equal to",
  lt: "is less than",
  lte: "is less than or equal to",
  isapprox: "is approximately",
  isbetween: "is between",
  onBudget: "is on budget",
  offBudget: "is off budget",
  hasTags: "has tags",
  hasAnyTag: "has any tag",
};

/** The operators Actual offers for each field. */
export const opsFor = (field: RuleField): ReadonlyArray<RuleOp> => {
  switch (kindOf(field)) {
    case "id":
      return field === "account"
        ? ["is", "isNot", "oneOf", "notOneOf", "onBudget", "offBudget"]
        : ["is", "isNot", "oneOf", "notOneOf"];
    case "text":
      return field === "notes"
        ? [
            "is",
            "isNot",
            "contains",
            "doesNotContain",
            "matches",
            "oneOf",
            "notOneOf",
            "hasTags",
            "hasAnyTag",
          ]
        : ["is", "isNot", "contains", "doesNotContain", "matches", "oneOf", "notOneOf"];
    case "amount":
      return ["is", "isapprox", "isbetween", "gt", "gte", "lt", "lte"];
    case "date":
      return ["is", "isapprox", "gt", "gte", "lt", "lte"];
    case "boolean":
      return ["is"];
  }
};

export const kindOf = (field: string): FieldKind =>
  CONDITION_FIELDS.find((each) => each.field === field)?.kind ??
  SET_FIELDS.find((each) => each.field === field)?.kind ??
  "text";

export const fieldLabel = (field: string) =>
  CONDITION_FIELDS.find((each) => each.field === field)?.label ??
  SET_FIELDS.find((each) => each.field === field)?.label ??
  field;

/** Whether an operator takes a list, no value, or a range. */
export const valueShape = (op: RuleOp): "one" | "many" | "none" | "range" =>
  op === "oneOf" || op === "notOneOf"
    ? "many"
    : op === "onBudget" || op === "offBudget" || op === "hasAnyTag"
      ? "none"
      : op === "isbetween"
        ? "range"
        : "one";

/** A sensible empty value for a field and operator, used when either changes. */
export const emptyValue = (kind: FieldKind, op: RuleOp): unknown => {
  const shape = valueShape(op);
  if (shape === "none") return null;
  if (shape === "many") return [];
  if (shape === "range") return { num1: 0, num2: 0 };
  return kind === "amount" ? 0 : kind === "boolean" ? true : kind === "id" ? null : "";
};

export const newCondition = (): RuleCondition => ({ field: "payee", op: "is", value: null });

export const newAction = (): RuleAction => ({ op: "set", field: "category", value: null });

export interface Names {
  readonly accounts: ReadonlyMap<string, string>;
  readonly categories: ReadonlyMap<string, string>;
  readonly groups: ReadonlyMap<string, string>;
  readonly payees: ReadonlyMap<string, string>;
}

const namesFor = (field: string, names: Names) =>
  field === "account" || field === "transfer_account"
    ? names.accounts
    : field === "category"
      ? names.categories
      : field === "category_group"
        ? names.groups
        : field === "payee"
          ? names.payees
          : undefined;

/** A condition or action value in words, with ids as names and amounts as money. */
export const describeValue = (
  field: string,
  value: unknown,
  names: Names,
  format: (amount: number) => string,
): string => {
  if (value === null || value === undefined) return "nothing";
  if (Array.isArray(value))
    return value.map((each) => describeValue(field, each, names, format)).join(", ");
  const kind = kindOf(field);
  if (typeof value === "object" && "num1" in value && "num2" in value)
    return `${describeValue(field, value.num1, names, format)} and ${describeValue(field, value.num2, names, format)}`;
  if (typeof value === "object" && "frequency" in value) return String(value.frequency);
  if (kind === "amount" && typeof value === "number") return format(value);
  if (kind === "id" && typeof value === "string")
    return namesFor(field, names)?.get(value) ?? "(deleted)";
  return String(value);
};

export const describeCondition = (
  condition: RuleCondition,
  names: Names,
  format: (amount: number) => string,
) => {
  const shape = valueShape(condition.op);
  return `${fieldLabel(condition.field)} ${OP_LABELS[condition.op]}${
    shape === "none" ? "" : ` ${describeValue(condition.field, condition.value, names, format)}`
  }`;
};

export const describeAction = (
  action: RuleAction,
  names: Names,
  format: (amount: number) => string,
) => {
  switch (action.op) {
    case "set":
      return action.template !== undefined
        ? `Set ${fieldLabel(action.field).toLowerCase()} to template ${action.template}`
        : action.formula !== undefined
          ? `Set ${fieldLabel(action.field).toLowerCase()} to ${action.formula}`
          : `Set ${fieldLabel(action.field).toLowerCase()} to ${describeValue(action.field, action.value, names, format)}`;
    case "set-split-amount":
      return `Split ${action.splitIndex}: ${action.method.replace("-", " ")}${action.value === undefined ? "" : ` ${action.value}`}`;
    case "link-schedule":
      return "Link to a schedule";
    case "prepend-notes":
      return `Prepend to notes "${action.value}"`;
    case "append-notes":
      return `Append to notes "${action.value}"`;
    case "delete-transaction":
      return "Delete the transaction";
  }
};

/** The ids of `field` a rule's conditions and actions name. */
export const idsNamed = (rule: Rule, field: "account" | "category" | "payee"): Set<string> => {
  const values = [
    ...rule.conditions.filter((each) => each.field === field).map((each) => each.value),
    ...rule.actions.flatMap((each) =>
      each.op === "set" && each.field === field ? [each.value] : [],
    ),
  ];
  return new Set(
    values
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .filter((value): value is string => typeof value === "string"),
  );
};
