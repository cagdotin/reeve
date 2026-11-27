import type {
  Receipt,
  ReceiptCheck,
  ReceiptOverview,
  ReceiptSort,
  ReceiptStatus,
  ReceiptSummary,
} from "@reeve/contract/catalog";
import {
  RECEIPT_STAGES,
  receiptStage,
  receiptTotals,
  type ReceiptStage,
} from "@reeve/contract/receipts";
import { daysInMonth } from "@reeve/contract/rules";
import { format as formatDate, parseISO } from "date-fns";
import type { AttentionCheck } from "@/components/insights/attention-alerts";
import { chosen, type FacetGroup, type FacetValue } from "./facets.ts";
import type { Sort } from "./insights.ts";

export const DEFAULT_MONTHS = 3;
export const PAGE_SIZE = 50;
export const NO_STORE = "none";

export type ReceiptSortState = Sort<ReceiptSort>;
export const DEFAULT_SORT: ReceiptSortState = { key: "date", descending: true };
export const DESCENDING_FIRST: ReadonlySet<ReceiptSort> = new Set(["date", "lines", "total"]);

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

// ---- The steps -------------------------------------------------------------------------------

type Flag = "balanced" | "matched" | "categorized" | "applied";

/** The four steps in order: the flag each sets, and the words for having it or not. */
export const STEPS: ReadonlyArray<{
  readonly stage: Exclude<ReceiptStage, "finished">;
  readonly flag: Flag;
  readonly done: string;
  readonly open: string;
  readonly waiting: string;
}> = [
  {
    stage: "balance",
    flag: "balanced",
    done: "Balanced",
    open: "Unbalanced",
    waiting: "balance next",
  },
  { stage: "match", flag: "matched", done: "Matched", open: "Unmatched", waiting: "match next" },
  {
    stage: "categorize",
    flag: "categorized",
    done: "Categorized",
    open: "Uncategorized",
    waiting: "categorize next",
  },
  { stage: "apply", flag: "applied", done: "Applied", open: "Not applied", waiting: "apply next" },
];

/** The four flags in words, for whoever cannot see the marks. */
export const statusWords = (status: Pick<ReceiptStatus, Flag>) =>
  STEPS.map((step) => (status[step.flag] ? step.done : step.open));

export interface NextStep {
  readonly stage: ReceiptStage;
  /** What is left, in a few words: "1.20 off", "Link a payment". */
  readonly label: string;
  /** The same in a sentence. */
  readonly detail: string;
}

type StepStatus = Pick<
  ReceiptStatus,
  Flag | "difference" | "expectedTotal" | "lineCount" | "paidAmount" | "uncategorizedLines"
>;

/** What a receipt needs next, in its stage's terms. */
export const nextStep = (
  status: StepStatus,
  total: number,
  format: (amount: number) => string,
): NextStep => {
  const stage = receiptStage(status);
  // New receipts can't have one, but a book may hold an older receipt that does.
  if (total === 0)
    return {
      stage,
      label: "Total is zero",
      detail: "A receipt's total can't be zero. Enter what was paid.",
    };
  switch (stage) {
    case "balance":
      return status.lineCount === 0
        ? {
            stage,
            label: "No lines yet",
            detail: `Type the lines as the receipt prints them, up to ${format(total)}.`,
          }
        : {
            stage,
            label: `${format(Math.abs(status.difference))} off`,
            detail: `The lines and adjustments come to ${format(status.expectedTotal)}, the total is ${format(total)}.`,
          };
    case "match": {
      if (status.paidAmount === 0)
        return {
          stage,
          label: "Link a payment",
          detail: "No transaction pays this receipt yet.",
        };
      const left = Math.abs(total) - Math.abs(status.paidAmount);
      return {
        stage,
        label: left > 0 ? `${format(left)} left to link` : `${format(-left)} overpaid`,
        detail: `Linked payments come to ${format(status.paidAmount)} of ${format(total)}.`,
      };
    }
    case "categorize":
      return status.lineCount === 0
        ? { stage, label: "Add lines", detail: "A receipt with no lines has nothing to split." }
        : {
            stage,
            label: `Categorize ${plural(status.uncategorizedLines, "line")}`,
            detail: "Applying needs a budget category for every line.",
          };
    case "apply":
      return {
        stage,
        label: "Apply it",
        detail: "It adds up and is paid. Its transaction does not carry the split yet.",
      };
    case "finished":
      return {
        stage,
        label: "Finished",
        detail: "It adds up, is paid, and its transaction carries the split.",
      };
  }
};

/** A receipt's status with the line totals being typed, so what is left follows the typing. */
export const liveStatus = (
  receipt: Pick<Receipt, "lines" | "adjustments" | "payments" | "total" | "status">,
  liveTotals: ReadonlyMap<string, number>,
): ReceiptStatus => ({
  ...receipt.status,
  ...receiptTotals({
    lines: receipt.lines.map((line) => ({ lineTotal: liveTotals.get(line.id) ?? line.lineTotal })),
    adjustments: receipt.adjustments,
    payments: receipt.payments,
    total: receipt.total,
  }),
});

// ---- The pipeline ----------------------------------------------------------------------------

export interface FlowStage {
  readonly stage: ReceiptStage;
  /** Receipts that have come this far. */
  readonly arriving: number;
  /** Those waiting here. */
  readonly waiting: number;
  /** Those that went on. */
  readonly passing: number;
}

/** The receipts through the steps: each step keeps those waiting at it and passes on the rest. */
export const pipelineFlow = (pipeline: ReceiptOverview["pipeline"]): Array<FlowStage> => {
  let arriving = RECEIPT_STAGES.reduce((sum, stage) => sum + pipeline[stage], 0);
  return RECEIPT_STAGES.map((stage) => {
    const waiting = pipeline[stage];
    const flow = { stage, arriving, waiting, passing: arriving - waiting };
    arriving -= waiting;
    return flow;
  });
};

/**
 * The band of a flow as SVG paths in a box of `columns`×100 wide by 100 high, on a baseline: `band`
 * is what goes on through the columns, and `waiting` what each column leaves above it.
 */
export const flowPaths = (flow: ReadonlyArray<FlowStage>) => {
  const most = Math.max(1, flow[0]?.arriving ?? 0);
  const y = (count: number) => 100 - (count / most) * 94;
  const going = flow.map((each) =>
    each.stage === "finished" ? { ...each, passing: each.arriving } : each,
  );
  const edge = going.map(({ arriving, passing }, index) => {
    const x = index * 100;
    return `C${x + 35},${y(arriving)} ${x + 65},${y(passing)} ${x + 100},${y(passing)}`;
  });
  const width = flow.length * 100;
  return {
    width,
    band: `M0,100 L0,${y(flow[0]?.arriving ?? 0)} ${edge.join(" ")} L${width},100 Z`,
    waiting: going.flatMap(({ arriving, passing }, index) => {
      if (arriving === passing) return [];
      const x = index * 100;
      return [
        `M${x},${y(arriving)} L${x + 100},${y(arriving)} L${x + 100},${y(passing)} C${x + 65},${y(passing)} ${x + 35},${y(arriving)} ${x},${y(arriving)} Z`,
      ];
    }),
  };
};

// ---- The table's filters ---------------------------------------------------------------------

/** What the insights narrow the table to: a step, or an open check. */
export type ReceiptFocus =
  | { readonly kind: "stage"; readonly stage: ReceiptStage | "unfinished" }
  | { readonly kind: "check"; readonly check: ReceiptCheck };

export interface CategoryFocus {
  readonly id: string | null;
  readonly name: string;
}

export const sameFocus = (a: ReceiptFocus | null, b: ReceiptFocus | null) =>
  a === null || b === null
    ? a === b
    : a.kind === "stage"
      ? b.kind === "stage" && a.stage === b.stage
      : b.kind === "check" && a.check === b.check;

export const stageIs = (focus: ReceiptFocus | null, stage: ReceiptStage | "unfinished") =>
  sameFocus(focus, { kind: "stage", stage });

const CHECK_NAMES: Record<ReceiptCheck, string> = {
  off: "Doesn't add up",
  no_lines: "No lines",
  no_payment: "No payment",
  uncategorized_lines: "Lines to categorize",
  unapplied: "Not applied",
  line_mismatch: "Line differs from price",
  old: "Old and unfinished",
};

/** What a chip calls what the table is narrowed to. */
export const focusName = (focus: ReceiptFocus) => {
  if (focus.kind === "check") return CHECK_NAMES[focus.check];
  if (focus.stage === "unfinished") return "Still to finish";
  if (focus.stage === "finished") return "Finished";
  const words = STEPS.find((step) => step.stage === focus.stage)?.waiting ?? focus.stage;
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const MISSING_GROUP: FacetGroup = {
  id: "missing",
  label: "Status",
  options: [
    { value: "unbalanced", label: "Unbalanced" },
    { value: "unmatched", label: "Unmatched" },
    { value: "uncategorized", label: "Uncategorized" },
    { value: "unapplied", label: "Matched, not applied" },
  ],
};

export const storeGroup = (
  choices: ReceiptOverview["storeChoices"],
  anyWithoutStore: boolean,
): FacetGroup => ({
  id: "store",
  label: "Store",
  options: [
    ...choices.map((each) => ({ value: each.id, label: each.name })),
    ...(anyWithoutStore ? [{ value: NO_STORE, label: "No store" }] : []),
  ],
});

export const monthLabel = (month: string) => formatDate(parseISO(`${month}-01`), "MMMM yyyy");

/** The first and last day of a month. */
export const monthDays = (month: string) => ({
  from: `${month}-01`,
  to: `${month}-${String(daysInMonth(month)).padStart(2, "0")}`,
});

export interface ReceiptListState {
  readonly query: string;
  readonly filters: FacetValue;
  readonly since: string | undefined;
  readonly until?: string | undefined;
  readonly month: string | null;
  readonly focus: ReceiptFocus | null;
  readonly category: CategoryFocus | null;
  readonly sort: ReceiptSortState;
  readonly limit: number;
}

/** What the page asks `list_receipts`, which filters and sorts on the server. */
export const listInput = (state: ReceiptListState) => {
  const missing = new Set(chosen(state.filters, "missing") ?? []);
  const stores = chosen(state.filters, "store") ?? [];
  const payeeIds = stores.filter((each) => each !== NO_STORE);
  const { focus, category, month, since, until, sort } = state;
  const query = state.query.trim();
  return {
    ...(query === "" ? {} : { query }),
    ...(payeeIds.length === 0 ? {} : { payeeIds }),
    ...(stores.includes(NO_STORE) ? { noStore: true } : {}),
    // A search looks everywhere: a line bought before the range is still a line to find.
    ...(month === null
      ? query !== ""
        ? {}
        : {
            ...(since === undefined ? {} : { from: since }),
            ...(until === undefined ? {} : { to: until }),
          }
      : monthDays(month)),
    ...(missing.has("unbalanced") ? { unbalanced: true } : {}),
    ...(missing.has("unmatched") ? { unmatched: true } : {}),
    ...(missing.has("uncategorized") ? { uncategorized: true } : {}),
    ...(missing.has("unapplied") ? { unapplied: true } : {}),
    ...(focus?.kind === "stage" ? { stage: focus.stage } : {}),
    ...(focus?.kind === "check" ? { check: focus.check } : {}),
    ...(category === null
      ? {}
      : category.id === null
        ? { noItemCategory: true }
        : { itemCategoryId: category.id }),
    sort: sort.key,
    descending: sort.descending,
    limit: state.limit,
  };
};

/** Whether a search is looking past the range the page is on. */
export const searchesPastRange = ({
  query,
  since,
  until,
  month,
}: Pick<ReceiptListState, "query" | "since" | "until" | "month">) =>
  query.trim() !== "" && (since !== undefined || until !== undefined) && month === null;

/** What the table says with no rows, and whether all time could still hold some. */
export const emptyTable = (
  state: Pick<ReceiptListState, "query" | "since" | "until" | "month">,
  narrowed: boolean,
  anyReceipts: boolean,
): { readonly text: string; readonly offerAllTime: boolean } => {
  if (!anyReceipts)
    return {
      text: "Receipts itemize what a transaction bought. Add one here, or let an agent add them with the receipts operations.",
      offerAllTime: false,
    };
  if (state.month !== null)
    return { text: `No receipt matches in ${monthLabel(state.month)}.`, offerAllTime: true };
  if (state.query.trim() !== "")
    return { text: "No receipt matches, in all time.", offerAllTime: false };
  if (state.since === undefined && state.until === undefined)
    return { text: "No receipt matches.", offerAllTime: false };
  return {
    text: narrowed ? "No receipt matches in this range." : "No receipt in this range.",
    offerAllTime: true,
  };
};

// ---- The checks ------------------------------------------------------------------------------

export interface ReceiptAttention extends AttentionCheck {
  readonly check: ReceiptCheck;
}

/** The open problems across the book, each a list `list_receipts` holds as many of. */
export const attentionItems = (
  attention: ReceiptOverview["attention"],
  format: (amount: number) => string,
): Array<ReceiptAttention> => [
  {
    id: "off",
    check: "off",
    count: attention.off,
    open: `don't add up, ${format(attention.offAmount)} off in all`,
    done: "Every receipt with lines adds up to its total",
    title: "Their lines and adjustments miss the total by more than a cent.",
  },
  {
    id: "no_lines",
    check: "no_lines",
    count: attention.noLines,
    open: attention.noLines === 1 ? "has no lines yet" : "have no lines yet",
    done: "Every receipt has lines",
    title: "A total with nothing on it: it says nothing about what was bought.",
  },
  {
    id: "no_payment",
    check: "no_payment",
    count: attention.noPayment,
    open: "not tied to a payment",
    done: "Every receipt is tied to its payment",
    title:
      "No transaction pays them, or the payments linked don't match the total. A cash purchase needs a transaction on a cash account to link to. A zero total has nothing to pay and stays here.",
  },
  {
    id: "uncategorized",
    check: "uncategorized_lines",
    count: attention.uncategorizedLines,
    open: `with ${plural(attention.uncategorizedLineCount, "line")} to categorize`,
    done: "Every line has a budget category",
    title: "Lines with no budget category of their own or through an item category or product.",
  },
  {
    id: "unapplied",
    check: "unapplied",
    count: attention.unapplied,
    open: "matched but not applied",
    done: "Every matched receipt is on its transaction",
    title:
      "Paid, but the transaction does not carry the receipt's split. One you split by hand on purpose also reads this way: applying rewrites it.",
  },
  {
    id: "mismatch",
    check: "line_mismatch",
    count: attention.lineMismatch,
    open: "with a line that differs from quantity × price",
    done: "Every line total agrees with its quantity and price",
    title: "A line's total is more than a cent from its quantity × price: often a misread number.",
  },
  {
    id: "old",
    check: "old",
    count: attention.old,
    open: `unfinished after ${attention.oldDays} days`,
    done: `Nothing has stayed unfinished for ${attention.oldDays} days`,
    title: `Dated more than ${attention.oldDays} days ago and not finished. They also count in the checks above.`,
  },
];

// ---- The cards -------------------------------------------------------------------------------

const TOP = 6;

export const topStores = (stores: ReceiptOverview["stores"]) =>
  stores.filter((store) => store.spent > 0).slice(0, TOP);

export const topCategories = (categories: ReceiptOverview["categories"]) =>
  categories.filter((category) => category.spent > 0).slice(0, TOP);

export const OTHER = "other";
const STACKED = 5;

export interface StackPart {
  readonly key: string;
  readonly name: string;
  /** Its categorical slot, which stays with the category whatever the range. */
  readonly slot: number;
  readonly spent: number;
}

export interface StackMonth {
  readonly month: string;
  readonly total: number;
  readonly parts: ReadonlyArray<StackPart>;
}

/**
 * Twelve months by category: the largest five over the twelve months, the rest as "Other". Months
 * only count what came out above zero, since a stack cannot draw a refund.
 */
export const categoryStack = (
  months: ReceiptOverview["months"],
): { legend: ReadonlyArray<Omit<StackPart, "spent">>; months: ReadonlyArray<StackMonth> } => {
  const keyOf = (id: string | null) => id ?? "none";
  const overall = new Map<string, number>();
  for (const month of months)
    for (const part of month.categories)
      overall.set(keyOf(part.id), (overall.get(keyOf(part.id)) ?? 0) + part.spent);
  const named = new Map(
    months.flatMap((month) => month.categories.map((each) => [keyOf(each.id), each.name] as const)),
  );
  const ranked = [...overall]
    .filter(([, spent]) => spent > 0)
    .toSorted(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([key]) => key);
  const legend = ranked
    .slice(0, STACKED)
    .map((key, slot) => ({ key, name: named.get(key) ?? "", slot }));
  const fold = ranked.length > STACKED;
  const other = { key: OTHER, name: "Other", slot: STACKED };
  return {
    legend: fold ? [...legend, other] : legend,
    months: months.map((month) => {
      const spent = new Map<string, number>();
      for (const part of month.categories) {
        const key = keyOf(part.id);
        const shown = legend.some((each) => each.key === key) ? key : OTHER;
        spent.set(shown, (spent.get(shown) ?? 0) + Math.max(0, part.spent));
      }
      const parts = [...legend, other].flatMap((each) => {
        const value = spent.get(each.key) ?? 0;
        return value > 0 ? [{ ...each, spent: value }] : [];
      });
      return {
        month: month.month,
        total: parts.reduce((sum, part) => sum + part.spent, 0),
        parts,
      };
    }),
  };
};

/** The share of recorded spending that receipts account for, 0 to 100. */
export const coverageShare = ({ recorded, covered }: ReceiptOverview["coverage"]) =>
  recorded <= 0 ? null : Math.min(100, Math.max(0, Math.round((covered / recorded) * 100)));

// ---- Deleting --------------------------------------------------------------------------------

export interface DeleteTarget {
  readonly id: string;
  readonly payee: string | null;
  readonly date: string;
  readonly photoCount: number;
  readonly paymentCount: number;
  readonly applied: boolean;
}

export const deleteTargetOf = (receipt: ReceiptSummary): DeleteTarget => ({
  id: receipt.id,
  payee: receipt.payee,
  date: receipt.date,
  photoCount: receipt.photoCount,
  paymentCount: receipt.transactionIds.length,
  applied: receipt.status.applied,
});

/** What deleting a receipt does, as `delete_receipt` does it: the ledger is not touched. */
export const deleteConsequences = ({
  photoCount,
  paymentCount,
  applied,
}: Pick<DeleteTarget, "photoCount" | "paymentCount" | "applied">): ReadonlyArray<string> => {
  const links =
    paymentCount === 1
      ? "The transaction it is linked to"
      : `The ${paymentCount} transactions it is linked to`;
  return [
    photoCount === 0
      ? "Its lines and adjustments go with it."
      : `Its lines, adjustments and ${plural(photoCount, "photo")} go with it.`,
    paymentCount === 0
      ? "No transaction is linked, so the ledger does not change."
      : applied
        ? `${paymentCount === 1 ? "The transaction it was applied to stays, and keeps" : `The ${paymentCount} transactions it was applied to stay, and keep`} the split this receipt wrote. Deleting does not put back one category; change that in the register.`
        : `${links} ${paymentCount === 1 ? "stays" : "stay"} as ${paymentCount === 1 ? "it is" : "they are"}, along with any split already on ${paymentCount === 1 ? "it" : "them"}.`,
    "You can undo this.",
  ];
};
