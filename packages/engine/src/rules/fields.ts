/** Which operators each field takes, as Actual's `shared/rules.ts`. */

export type FieldType = "date" | "id" | "string" | "number" | "boolean";

export const TYPE_OPS: Record<FieldType, ReadonlyArray<string>> = {
  date: ["is", "isapprox", "gt", "gte", "lt", "lte"],
  id: [
    "is",
    "contains",
    "matches",
    "oneOf",
    "isNot",
    "doesNotContain",
    "notOneOf",
    "onBudget",
    "offBudget",
  ],
  string: [
    "is",
    "contains",
    "matches",
    "oneOf",
    "isNot",
    "doesNotContain",
    "notOneOf",
    "hasTags",
    "hasAnyTag",
  ],
  number: ["is", "isapprox", "isbetween", "gt", "gte", "lt", "lte"],
  boolean: ["is"],
};

interface FieldInfo {
  readonly type: FieldType;
  readonly disallowedOps?: ReadonlySet<string>;
  readonly internalOps?: ReadonlySet<string>;
  /** An account number from a bank line: compared without spaces, and never matched without one. */
  readonly accountNumber?: true;
}

const FIELD_INFO: Record<string, FieldInfo> = {
  imported_payee: { type: "string", disallowedOps: new Set(["hasTags", "hasAnyTag"]) },
  counterparty_account: {
    type: "string",
    disallowedOps: new Set(["hasTags", "hasAnyTag"]),
    accountNumber: true,
  },
  payee: { type: "id", disallowedOps: new Set(["onBudget", "offBudget"]) },
  payee_name: { type: "string" },
  date: { type: "date" },
  notes: { type: "string", disallowedOps: new Set(["oneOf", "notOneOf"]) },
  amount: { type: "number" },
  category: {
    type: "id",
    disallowedOps: new Set(["onBudget", "offBudget"]),
    internalOps: new Set(["and"]),
  },
  category_group: {
    type: "id",
    disallowedOps: new Set(["onBudget", "offBudget"]),
    internalOps: new Set(["and"]),
  },
  account: { type: "id" },
  transfer_account: { type: "id" },
  cleared: { type: "boolean" },
  reconciled: { type: "boolean" },
  transfer: { type: "boolean" },
  parent: { type: "boolean" },
};

export const fieldType = (field: string): FieldType | undefined => FIELD_INFO[field]?.type;

export const isAccountNumber = (field: string): boolean =>
  FIELD_INFO[field]?.accountNumber === true;

export const isValidOp = (field: string, op: string): boolean => {
  const info = FIELD_INFO[field];
  if (info === undefined) return false;
  if (info.disallowedOps?.has(op)) return false;
  return TYPE_OPS[info.type].includes(op) || (info.internalOps?.has(op) ?? false);
};

export const getValidOps = (field: string): Array<string> => {
  const info = FIELD_INFO[field];
  if (info === undefined) return [];
  return TYPE_OPS[info.type].filter((op) => !info.disallowedOps?.has(op));
};

export const sortNumbers = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a]);

/** How far from an amount `isapprox` still matches: 7.5% of it. */
export const getApproxNumberThreshold = (number: number): number =>
  Math.round(Math.abs(number) * 0.075);

/** The `#tags` a hasTags value names, each with its hash. */
export const extractTagsForFilter = (value: string): Array<string> => {
  if (!value) return [];
  const tags: Array<string> = [];
  for (const [, tag] of value.matchAll(/#*([^#\s]+)/g)) {
    const withHash = `#${tag}`;
    if (!tags.includes(withHash)) tags.push(withHash);
  }
  return tags;
};
