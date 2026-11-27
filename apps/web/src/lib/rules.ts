import type {
  Rule,
  RuleAction,
  RuleActivity,
  RuleCondition,
  RuleOverview,
  RuleStage,
} from "@reeve/contract/catalog";
import { accountLimits, ruleCategory } from "@reeve/contract/rules";
import {
  describeValue,
  fieldLabel,
  idsNamed,
  newAction,
  newCondition,
  OP_LABELS,
  valueShape,
  type Names,
} from "../components/rules/rule-model.ts";
import { chosen, type FacetGroup, type FacetOption, type FacetValue } from "./facets.ts";
import type { Sort } from "./insights.ts";

export const DEFAULT_MONTHS = 3;

// -------------------------------------------------------------------------------------------------
// A rule in words
// -------------------------------------------------------------------------------------------------

/** One part of a rule's sentence: the words around it, then the value that matters. */
export interface Clause {
  readonly lead: string;
  readonly value: string;
}

type Format = (amount: number) => string;

const lowerField = (field: string) => fieldLabel(field).toLowerCase();

export const conditionClause = (
  condition: RuleCondition,
  names: Names,
  format: Format,
): Clause => ({
  lead: `${lowerField(condition.field)} ${OP_LABELS[condition.op]}`,
  value:
    valueShape(condition.op) === "none"
      ? ""
      : describeValue(condition.field, condition.value, names, format),
});

const SPLIT_METHODS = {
  "fixed-amount": "a fixed amount of",
  "fixed-percent": "a percent of",
  remainder: "what remains",
  formula: "the formula",
} as const;

export const actionClause = (action: RuleAction, names: Names, format: Format): Clause => {
  switch (action.op) {
    case "set": {
      const split =
        action.splitIndex === undefined || action.splitIndex === 0
          ? ""
          : ` on split ${action.splitIndex}`;
      const lead = `set ${lowerField(action.field)}${split} to`;
      if (action.template !== undefined)
        return { lead: `${lead} the template`, value: action.template };
      if (action.formula !== undefined)
        return { lead: `${lead} the formula`, value: action.formula };
      return { lead, value: describeValue(action.field, action.value, names, format) };
    }
    case "set-split-amount": {
      const lead = `give split ${action.splitIndex} ${SPLIT_METHODS[action.method]}`;
      if (action.method === "formula") return { lead, value: action.formula ?? "" };
      if (action.method === "fixed-percent") return { lead, value: `${action.value ?? 0}%` };
      if (action.method === "fixed-amount") return { lead, value: format(action.value ?? 0) };
      return { lead, value: "" };
    }
    case "link-schedule":
      return { lead: "link it to its schedule", value: "" };
    case "prepend-notes":
      return { lead: "put before its notes", value: action.value };
    case "append-notes":
      return { lead: "add to its notes", value: action.value };
    case "delete-transaction":
      return { lead: "delete it", value: "" };
  }
};

const clauseText = ({ lead, value }: Clause) => (value === "" ? lead : `${lead} ${value}`);

/** The rule as one sentence, for a title, a search or a confirmation. */
export const ruleSentence = (rule: Rule, names: Names, format: Format) => {
  const conditions = rule.conditions
    .map((each) => clauseText(conditionClause(each, names, format)))
    .join(rule.conditionsOp === "and" ? " and " : " or ");
  const actions = rule.actions
    .map((each) => clauseText(actionClause(each, names, format)))
    .join(" and ");
  return `If ${conditions === "" ? "nothing, which never matches" : conditions}, ${actions === "" ? "do nothing" : actions}`;
};

/**
 * Which accounts a rule acts on, as its conditions say, whatever accounts the page shows. With "or",
 * an account condition limits nothing while another condition can match on any account.
 */
export const reachText = (
  { conditions, conditionsOp }: Pick<Rule, "conditions" | "conditionsOp">,
  names: Names,
  format: Format,
) => {
  const limits = accountLimits({ conditions, conditionsOp });
  if (limits.length > 0)
    return `Applies only where ${limits
      .map((each) => clauseText(conditionClause(each, names, format)))
      .join(conditionsOp === "and" ? " and " : " or ")}.`;
  return conditions.some((each) => each.field === "account")
    ? "Applies to every account: with Match any, its other conditions can match on any account."
    : "Applies to every account.";
};

// -------------------------------------------------------------------------------------------------
// The stages
// -------------------------------------------------------------------------------------------------

export const STAGES: ReadonlyArray<{
  readonly value: RuleStage;
  readonly label: string;
  readonly about: string;
}> = [
  { value: "pre", label: "Pre", about: "Runs first, to clean up payees" },
  { value: "default", label: "Default", about: "Runs next, where most rules belong" },
  { value: "post", label: "Post", about: "Runs last, and has the last word" },
];

// -------------------------------------------------------------------------------------------------
// What rules set
// -------------------------------------------------------------------------------------------------

const SET_ITEMS = {
  notes: "Notes",
  split: "Splits",
  delete: "Deletes it",
} as const;

/** The things a rule's actions change, as filter values: a field, or one of `SET_ITEMS`. */
const setsOf = (rule: Rule): ReadonlySet<string> =>
  new Set(
    rule.actions.flatMap((action) => {
      switch (action.op) {
        case "set":
          return action.splitIndex === undefined || action.splitIndex === 0
            ? [action.field]
            : ["split"];
        case "set-split-amount":
          return ["split"];
        case "link-schedule":
          return [];
        case "prepend-notes":
        case "append-notes":
          return ["notes"];
        case "delete-transaction":
          return ["delete"];
      }
    }),
  );

const setLabel = (set: string) =>
  set in SET_ITEMS ? SET_ITEMS[set as keyof typeof SET_ITEMS] : fieldLabel(set);

// -------------------------------------------------------------------------------------------------
// What needs attention
// -------------------------------------------------------------------------------------------------

type StatusValue =
  | "conflict"
  | "duplicate"
  | "quiet"
  | "disagrees"
  | "stale"
  | "unmatched"
  | "scheduled"
  | "plain";

const PROBLEM_PASSES: Record<StatusValue, (rule: RuleActivity) => boolean> = {
  conflict: (rule) => rule.problems.conflict,
  duplicate: (rule) => rule.problems.duplicate,
  quiet: (rule) => rule.problems.quiet,
  disagrees: (rule) => rule.problems.disagrees,
  stale: (rule) => rule.problems.stale.length > 0,
  unmatched: (rule) => rule.matches === 0,
  scheduled: (rule) => rule.schedule !== null,
  plain: (rule) => rule.schedule === null,
};

const count = (rules: ReadonlyArray<RuleActivity>, status: StatusValue) =>
  rules.filter(PROBLEM_PASSES[status]).length;

const plural = (amount: number, one: string, many = `${one}s`) => (amount === 1 ? one : many);

export interface AttentionItem {
  readonly id: string;
  readonly count: number;
  readonly open: string;
  readonly done: string;
  /** The filters that list these rules; a check about payees shows them in their card instead. */
  readonly filters: FacetValue | null;
}

/** The checklist; each check is done while its count is zero. */
export const attentionItems = (overview: RuleOverview): Array<AttentionItem> => {
  const { rules, uncategorizedPayees } = overview;
  const conflict = count(rules, "conflict");
  const duplicate = count(rules, "duplicate");
  const quiet = count(rules, "quiet");
  const disagrees = count(rules, "disagrees");
  const stale = count(rules, "stale");
  return [
    {
      id: "conflict",
      count: conflict,
      open: `${plural(conflict, "conflicts", "conflict")}: same conditions, other category`,
      done: "No rules conflict",
      filters: { status: ["conflict"] },
    },
    {
      id: "duplicate",
      count: duplicate,
      open: `${plural(duplicate, "is a duplicate", "are duplicates")}`,
      done: "No duplicate rules",
      filters: { status: ["duplicate"] },
    },
    {
      id: "disagrees",
      count: disagrees,
      open: `${plural(disagrees, "disagrees", "disagree")} with recent categories`,
      done: "Rules agree with how you categorize",
      filters: { status: ["disagrees"] },
    },
    {
      id: "stale",
      count: stale,
      open: `${plural(stale, "names", "name")} something hidden, closed or deleted`,
      done: "Rules name only what is in use",
      filters: { status: ["stale"] },
    },
    {
      id: "quiet",
      count: quiet,
      open: `matched nothing in 12 months`,
      done: "Every rule has matched within 12 months",
      filters: { status: ["quiet"] },
    },
    {
      id: "uncategorized-payees",
      count: uncategorizedPayees,
      open: `uncategorized ${plural(uncategorizedPayees, "payee")} with no rule`,
      done: "No repeat uncategorized payee lacks a rule",
      filters: null,
    },
  ];
};

/** What is wrong with a rule, in words, for its row's tooltip. */
export const problemsOf = (rule: RuleActivity, names: Names): Array<string> => {
  const { conflict, duplicate, quiet, disagrees, stale } = rule.problems;
  const category = ruleCategory(rule.actions);
  return [
    ...(conflict
      ? [
          "Another rule with these conditions sets a different category. The one that runs later wins.",
        ]
      : []),
    ...(duplicate ? ["Another rule in this stage does exactly the same."] : []),
    ...(disagrees && category !== null
      ? [
          `Sets ${names.categories.get(category) ?? "a category"}, but only ${rule.carryingCategory} of its ${rule.categorized} categorized matches carry it.`,
        ]
      : []),
    ...stale.map(
      ({ state, field, name }) =>
        `Names ${state === "deleted" ? `a deleted ${fieldLabel(field).toLowerCase()}` : `${name ?? "an item"}, which is ${state}`}.`,
    ),
    ...(quiet
      ? [
          rule.lastMatch === null
            ? "Its conditions match no transaction."
            : "Its conditions match nothing from the last 12 months.",
        ]
      : []),
  ];
};

// -------------------------------------------------------------------------------------------------
// Filters, search and sort
// -------------------------------------------------------------------------------------------------

const STATUS_OPTIONS: ReadonlyArray<{ readonly value: StatusValue; readonly label: string }> = [
  { value: "conflict", label: "Conflicts" },
  { value: "duplicate", label: "Duplicate" },
  { value: "disagrees", label: "Disagrees with recent categories" },
  { value: "stale", label: "Names something hidden, closed or deleted" },
  { value: "quiet", label: "No match in 12 months" },
  { value: "unmatched", label: "No match in this range" },
  { value: "scheduled", label: "Belongs to a schedule" },
  { value: "plain", label: "Not on a schedule" },
];

const NAMED = [
  { id: "account", label: "Account", choices: "accounts" },
  { id: "category", label: "Category", choices: "categories" },
  { id: "payee", label: "Payee", choices: "payees" },
] as const;

type Pickers = Readonly<
  Record<(typeof NAMED)[number]["choices"], ReadonlyArray<Omit<FacetOption, "count">>>
>;

/** A hint for a condition left on "Nothing", which matches every transaction without that field. */
export const unfilledCondition = (conditions: ReadonlyArray<RuleCondition>) => {
  const open = conditions.find((each) => each.op === "is" && each.value === null);
  return open === undefined
    ? null
    : `"Nothing" matches every transaction with no ${fieldLabel(open.field).toLowerCase()}. Choose one to narrow it.`;
};

const countedOptions = (options: ReadonlyArray<FacetOption>): ReadonlyArray<FacetOption> =>
  options.filter((option) => (option.count ?? 0) > 0);

/** The filters over the rules at hand, each option with how many rules it would keep. */
export const ruleFilterGroups = (
  rules: ReadonlyArray<RuleActivity>,
  pickers: Pickers,
  names: Names,
): Array<FacetGroup> => {
  const sets = new Map<string, number>();
  const categories = new Map<string, number>();
  for (const rule of rules) {
    for (const set of setsOf(rule)) sets.set(set, (sets.get(set) ?? 0) + 1);
    const category = ruleCategory(rule.actions);
    if (category !== null) categories.set(category, (categories.get(category) ?? 0) + 1);
  }
  return [
    {
      id: "status",
      label: "Status",
      options: countedOptions(
        STATUS_OPTIONS.map(({ value, label }) => ({
          value,
          label,
          count: count(rules, value),
        })),
      ),
    },
    {
      id: "stage",
      label: "Stage",
      options: countedOptions(
        STAGES.map(({ value, label }) => ({
          value,
          label,
          count: rules.filter((rule) => rule.stage === value).length,
        })),
      ),
    },
    {
      id: "sets",
      label: "Sets",
      options: [...sets]
        .map(([value, amount]) => ({ value, label: setLabel(value), count: amount }))
        .toSorted((a, b) => a.label.localeCompare(b.label)),
    },
    {
      id: "setsCategory",
      label: "Sets category",
      options: [...categories]
        .map(([value, amount]) => ({
          value,
          label: names.categories.get(value) ?? "(deleted)",
          count: amount,
        }))
        .toSorted((a, b) => a.label.localeCompare(b.label)),
    },
    ...NAMED.map(({ id, label, choices }) => {
      const counts = new Map<string, number>();
      for (const rule of rules)
        for (const each of idsNamed(rule, id)) counts.set(each, (counts.get(each) ?? 0) + 1);
      return {
        id,
        label: `Names ${label.toLowerCase()}`,
        options: pickers[choices]
          .filter((option) => counts.has(option.value))
          .map((option) => ({ ...option, count: counts.get(option.value) ?? 0 })),
      };
    }),
  ].filter((group) => group.options.length > 0);
};

/** Whether a rule passes the filters: within a group any chosen value, across groups all. */
export const passesRuleFilters = (rule: RuleActivity, filters: FacetValue) => {
  const stages = chosen(filters, "stage");
  if (stages !== undefined && !stages.includes(rule.stage)) return false;
  const status = chosen(filters, "status");
  if (status !== undefined && !status.some((each) => PROBLEM_PASSES[each as StatusValue]?.(rule)))
    return false;
  const sets = chosen(filters, "sets");
  if (sets !== undefined) {
    const own = setsOf(rule);
    if (!sets.some((each) => own.has(each))) return false;
  }
  const setsCategory = chosen(filters, "setsCategory");
  if (setsCategory !== undefined) {
    const category = ruleCategory(rule.actions);
    if (category === null || !setsCategory.includes(category)) return false;
  }
  return NAMED.every(({ id }) => {
    const values = chosen(filters, id);
    if (values === undefined) return true;
    const named = idsNamed(rule, id);
    return values.some((value) => named.has(value));
  });
};

export const matchesRuleSearch = (sentence: string, query: string) =>
  sentence.toLowerCase().includes(query.trim().toLowerCase());

export type RuleSortKey = "run" | "condition" | "action" | "matches" | "last";

export type RuleSort = Sort<RuleSortKey>;

export const DEFAULT_SORT: RuleSort = { key: "run", descending: false };

export const DESCENDING_FIRST: ReadonlySet<RuleSortKey> = new Set(["matches", "last"]);

const compareText = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "base" });

export const sortRules = (
  rows: ReadonlyArray<RuleActivity>,
  { key, descending }: RuleSort,
  names: Names,
  format: Format,
) => {
  const direction = descending ? -1 : 1;
  const conditions = (rule: Rule) =>
    rule.conditions.map((each) => clauseText(conditionClause(each, names, format))).join(" ");
  const actions = (rule: Rule) =>
    rule.actions.map((each) => clauseText(actionClause(each, names, format))).join(" ");
  const byRun = (a: RuleActivity, b: RuleActivity) => a.position - b.position;
  return rows.toSorted((a, b) => {
    switch (key) {
      case "run":
        return direction * byRun(a, b);
      case "condition":
        return direction * compareText(conditions(a), conditions(b)) || byRun(a, b);
      case "action":
        return direction * compareText(actions(a), actions(b)) || byRun(a, b);
      case "matches":
        return direction * (a.matches - b.matches) || byRun(a, b);
      case "last":
        if (a.lastMatch === null || b.lastMatch === null)
          return Number(a.lastMatch === null) - Number(b.lastMatch === null) || byRun(a, b);
        return direction * compareText(a.lastMatch, b.lastMatch) || byRun(a, b);
    }
  });
};

// -------------------------------------------------------------------------------------------------
// Drafts for the editor
// -------------------------------------------------------------------------------------------------

/** A new rule from an account's page: the condition to delete, and the one to fill in. */
export const draftForAccount = (account: string): Partial<Rule> => ({
  conditions: [{ field: "account", op: "is", value: account }, newCondition()],
});

/** A new rule for a payee: "payee is this", then set this category, or one left to pick. */
export const draftForPayee = (payee: string, category: string | null): Partial<Rule> => ({
  stage: "default",
  conditionsOp: "and",
  conditions: [{ field: "payee", op: "is", value: payee }],
  actions: [category === null ? newAction() : { op: "set", field: "category", value: category }],
});

/** A copy to change and save; it does not belong to the schedule the original does. */
export const duplicateDraft = (rule: Rule): Partial<Rule> => {
  const actions = rule.actions.filter((action) => action.op !== "link-schedule");
  return {
    stage: rule.stage,
    conditionsOp: rule.conditionsOp,
    conditions: rule.conditions,
    actions: actions.length === 0 ? [newAction()] : actions,
  };
};

const SCHEDULE_FIELDS: ReadonlyArray<{ field: string; ops: ReadonlyArray<string> }> = [
  { field: "payee", ops: ["is"] },
  { field: "account", ops: ["is"] },
  { field: "amount", ops: ["is", "isapprox", "isbetween"] },
  { field: "date", ops: ["is", "isapprox"] },
];

/**
 * The conditions a schedule reads its payee, account, amount and date from, as its engine picks
 * them: changing one here would change the schedule without resetting its next date.
 */
export const scheduleConditions = (conditions: ReadonlyArray<RuleCondition>): Set<RuleCondition> =>
  new Set(
    SCHEDULE_FIELDS.flatMap(({ field, ops }) => {
      const found = conditions.find((each) => each.field === field && ops.includes(each.op));
      return found === undefined ? [] : [found];
    }),
  );

const TEXT_FIELDS = new Set(["imported_payee", "counterparty_account", "payee_name", "notes"]);

const conditionsKey = (conditions: ReadonlyArray<RuleCondition>, op: "and" | "or") =>
  `${conditions.length < 2 ? "" : op}:${conditions
    .map((each) => {
      const lower = (value: unknown) =>
        TEXT_FIELDS.has(each.field) && typeof value === "string" ? value.toLowerCase() : value;
      return JSON.stringify({
        field: each.field,
        op: each.op,
        value: Array.isArray(each.value)
          ? each.value.map(lower).map(String).toSorted()
          : lower(each.value),
      });
    })
    .toSorted()
    .join()}`;

/** Another rule with exactly these conditions, for the editor to mention. */
export const ruleWithConditions = <R extends Rule>(
  rules: ReadonlyArray<R>,
  conditions: ReadonlyArray<RuleCondition>,
  conditionsOp: "and" | "or",
  except: string | undefined,
): R | undefined => {
  if (conditions.length === 0) return undefined;
  const key = conditionsKey(conditions, conditionsOp);
  return rules.find(
    (rule) => rule.id !== except && conditionsKey(rule.conditions, rule.conditionsOp) === key,
  );
};

const FILTER_KEYS = { payee: "payees", category: "categories", account: "accounts" } as const;

/**
 * The register's own filters for what a rule matches, when they can say the same: every condition
 * names ids of a different field, all together. Null for anything else.
 */
export const registerSearchFor = (
  rule: Rule,
): { payees?: Array<string>; categories?: Array<string>; accounts?: Array<string> } | null => {
  if (rule.conditions.length === 0) return null;
  if (rule.conditions.length > 1 && rule.conditionsOp === "or") return null;
  const search: { payees?: Array<string>; categories?: Array<string>; accounts?: Array<string> } =
    {};
  for (const { field, op, value } of rule.conditions) {
    if (field !== "payee" && field !== "category" && field !== "account") return null;
    const key = FILTER_KEYS[field];
    if (search[key] !== undefined) return null;
    if (op === "is" && typeof value === "string") search[key] = [value];
    else if (
      op === "oneOf" &&
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((each) => typeof each === "string")
    )
      search[key] = value as Array<string>;
    else return null;
  }
  return search;
};
