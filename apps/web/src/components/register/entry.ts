import type { Account, CategoryGroup, RegisterRow } from "@reeve/contract";
import { categoryLevels } from "@reeve/contract/rules";
import { findItem, type PickerGroup } from "@/components/picker-items";

export const SPLIT = "split";

/** What the category cell may name: a category, a transfer account, or a split. */
export const counterpartGroups = (
  groups: ReadonlyArray<CategoryGroup>,
  accounts: ReadonlyArray<Account>,
  exclude: string | undefined,
  withSplit: boolean,
): Array<PickerGroup> => [
  ...(withSplit ? [{ value: "", items: [{ value: SPLIT, label: "Split transaction" }] }] : []),
  ...groups
    .filter((group) => group.categories.length > 0)
    .map((group) => {
      const levels = categoryLevels(group.categories);
      return {
        value: group.name,
        items: group.categories.map((category) => ({
          value: `c:${category.id}`,
          label: category.name,
          depth: levels.get(category.id) ?? 0,
        })),
      };
    }),
  {
    value: "Transfer to/from",
    items: accounts
      .filter((account) => !account.closed && account.id !== exclude)
      .map((account) => ({ value: `t:${account.id}`, label: `Transfer: ${account.name}` })),
  },
];

/** What a row sits on that no one can pick, such as Opening Balances: it may stay as it is. */
export const heldGroups = (row: RegisterRow | null): Array<PickerGroup> => {
  const items =
    row === null
      ? []
      : [
          ...(row.counterpart.kind === "other"
            ? [{ value: `c:${row.counterpart.id}`, label: row.counterpart.name }]
            : []),
          ...row.splits
            .filter((line) => line.kind === "other")
            .map((line) => ({ value: `c:${line.accountId}`, label: line.name })),
        ];
  return items.length === 0 ? [] : [{ value: "", items }];
};

export interface Line {
  readonly key: number;
  counterpart: string;
  amount: string;
  memo: string;
}

export interface EntryValue {
  readonly account: string;
  readonly date: string;
  readonly payee: string | null;
  readonly notes: string | null;
  readonly amount: number;
  readonly cleared: boolean;
  readonly category: string | null;
  readonly transferAccount: string | null;
  readonly splits: ReadonlyArray<{
    category?: string | null;
    transferAccount?: string | null;
    amount: number;
    memo?: string | null;
  }> | null;
}

const lineLabel = (line: RegisterRow["splits"][number], groups: ReadonlyArray<PickerGroup>) =>
  line.kind === "transfer"
    ? (findItem(groups, `Transfer: ${line.name}`)?.label ?? `Transfer: ${line.name}`)
    : line.kind === "uncategorized"
      ? ""
      : line.name;

/** What a row's category cell shows when it opens for editing. */
export const counterpartLabel = (row: RegisterRow | null) => {
  switch (row?.counterpart.kind) {
    case "split":
      return "Split transaction";
    case "transfer":
      return `Transfer: ${row.counterpart.name}`;
    case "category":
    case "other":
      return row.counterpart.name;
    default:
      return "";
  }
};

/** What a register row's category column says; null when it has no category. */
export const counterpartText = (row: RegisterRow) => {
  switch (row.counterpart.kind) {
    case "category":
    case "other":
      return row.counterpart.name;
    case "transfer":
      return `Transfer: ${row.counterpart.name}`;
    case "split":
      return `Split (${row.counterpart.count})`;
    case "uncategorized":
      return null;
  }
};

/** A split row's lines, as the editor shows them. */
export const splitLines = (
  row: RegisterRow | null,
  groups: ReadonlyArray<PickerGroup>,
  format: (amount: number) => string,
): Array<Line> =>
  row !== null && row.counterpart.kind === "split"
    ? row.splits.map((line, key) => ({
        key,
        counterpart: lineLabel(line, groups),
        amount: format(line.amount),
        memo: line.memo ?? "",
      }))
    : [];

/** The category or transfer account a category cell's text names; undefined when it names neither. */
const resolve = (text: string, from: ReadonlyArray<PickerGroup>) => {
  if (text.trim() === "") return { category: null, transferAccount: null };
  const item = findItem(from, text);
  if (item === undefined) return undefined;
  return item.value.startsWith("t:")
    ? { category: null, transferAccount: item.value.slice(2) }
    : { category: item.value.slice(2), transferAccount: null };
};

/** The payment and deposit fields as one signed amount, or null when either is not a number. */
export const entryTotal = (
  payment: string,
  deposit: string,
  parse: (text: string) => number | null,
) => {
  const out = payment.trim() === "" ? 0 : parse(payment);
  const into = deposit.trim() === "" ? 0 : parse(deposit);
  return out === null || into === null ? null : into - out;
};

export interface EntryFields {
  readonly owner: string | undefined;
  readonly date: string;
  readonly payee: string;
  readonly notes: string;
  readonly cleared: boolean;
  readonly counterpart: string;
  readonly payment: string;
  readonly deposit: string;
  readonly splitting: boolean;
  readonly lines: ReadonlyArray<Line>;
}

/** The entry the editor's fields describe, or the message saying why they describe none. */
export const toEntry = (
  fields: EntryFields,
  options: ReadonlyArray<PickerGroup>,
  lineOptions: ReadonlyArray<PickerGroup>,
  parse: (text: string) => number | null,
  format: (amount: number) => string,
): EntryValue | string => {
  const total = entryTotal(fields.payment, fields.deposit, parse);
  if (fields.owner === undefined) return "Choose the account";
  if (total === null) return "The amount is not a number";
  const base = {
    account: fields.owner,
    date: fields.date,
    payee: fields.payee.trim() === "" ? null : fields.payee.trim(),
    notes: fields.notes.trim() === "" ? null : fields.notes.trim(),
    amount: total,
    cleared: fields.cleared,
  };
  if (!fields.splitting) {
    const target = resolve(fields.counterpart, options);
    if (target === undefined) return `No category or account "${fields.counterpart}"`;
    return { ...base, ...target, splits: null };
  }
  const splits = [];
  for (const line of fields.lines) {
    const target = resolve(line.counterpart, lineOptions);
    const value = parse(line.amount);
    if (target === undefined) return `No category or account "${line.counterpart}"`;
    if (value === null) return `"${line.amount}" is not an amount`;
    splits.push({ ...target, amount: value, memo: line.memo.trim() || null });
  }
  if (splits.length === 0) return "Add split lines";
  const lineSum = fields.lines.reduce((sum, line) => sum + (parse(line.amount) ?? 0), 0);
  if (lineSum !== total)
    return `The split lines add up to ${format(lineSum)}, not ${format(total)}`;
  return { ...base, category: null, transferAccount: null, splits };
};
/** A new transaction's input; a category or transfer account is left out when there is none. */
export const createInput = (value: EntryValue) => ({
  date: value.date,
  account: value.account,
  amount: value.amount,
  payee: value.payee,
  notes: value.notes,
  cleared: value.cleared,
  ...(value.splits !== null
    ? { splits: value.splits }
    : {
        ...(value.category === null ? {} : { category: value.category }),
        ...(value.transferAccount === null ? {} : { transferAccount: value.transferAccount }),
      }),
});

export const updateInput = (row: RegisterRow, value: EntryValue) => ({
  id: row.transactionId,
  account: row.accountId,
  date: value.date,
  payee: value.payee,
  notes: value.notes,
  amount: value.amount,
  cleared: value.cleared,
  ...(value.splits !== null
    ? { splits: value.splits }
    : { category: value.category, transferAccount: value.transferAccount }),
});
