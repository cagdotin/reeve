import { catalog, type OperationName } from "@reeve/contract/catalog";
import { addMonths } from "@reeve/contract/rules";
import fc from "fast-check";
import { THIS_MONTH, type World } from "./world.ts";

/** Everything a step may name, in order of first sight. Ids that died stay: naming one is refused. */
export interface Pools {
  readonly accounts: Array<string>;
  readonly categories: Array<string>;
  readonly groups: Array<string>;
  readonly payees: Array<string>;
  readonly transactions: Array<string>;
  readonly rules: Array<string>;
  readonly schedules: Array<string>;
  /** The system accounts, which only journal entries and a transfer's category reach. */
  readonly system: Array<string>;
}

export const emptyPools = (): Pools => ({
  accounts: [],
  categories: [],
  groups: [],
  payees: [],
  transactions: [],
  rules: [],
  schedules: [],
  system: [],
});

const remember = (pool: Array<string>, id: unknown) => {
  if (typeof id === "string" && !pool.includes(id)) pool.push(id);
};

/** An entity by index, so a sequence shrinks without carrying ids; a stale or empty pool refuses. */
const pick = (pool: ReadonlyArray<string>, ref: number) =>
  pool.length === 0 ? "nothing-here" : pool[ref % pool.length]!;
/** An entity other than `other`, unless it is the only one. */
const pickOther = (pool: ReadonlyArray<string>, ref: number, other: string) => {
  const chosen = pick(pool, ref);
  return chosen === other ? pick(pool, ref + 1) : chosen;
};
const pickAll = (pool: ReadonlyArray<string>, refs: ReadonlyArray<number>) =>
  refs.map((ref) => pick(pool, ref));
/** An entity, or now and then one that never was, for the steps that have to refuse it. */
const pickOrMissing = (pool: ReadonlyArray<string>, ref: number) =>
  ref % 5 === 4 ? "never-was" : pick(pool, ref);

const ref = fc.nat({ max: 63 });
/** Half the time nothing. */
const maybe = <A>(arbitrary: fc.Arbitrary<A>) => fc.option(arbitrary, { nil: undefined, freq: 2 });
const refs = fc.array(ref, { minLength: 1, maxLength: 3 });
const flag = fc.boolean();
const label = fc.constantFrom("Rewe", "Aldi", "Shell", "Rent", "Broker");
const text = fc.constantFrom("note", "coffee", "#tag");
const amount = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom(-1000, -500, 500, 1000) },
  { weight: 1, arbitrary: fc.integer({ min: -50_000, max: 50_000 }) },
);
const positive = fc.oneof(fc.constantFrom(500, 1000), fc.integer({ min: 0, max: 50_000 }));
const pad = (value: number) => String(value).padStart(2, "0");
const month = fc.integer({ min: -3, max: 3 }).map((offset) => addMonths(THIS_MONTH, offset));
const date = fc
  .tuple(month, fc.integer({ min: 1, max: 28 }))
  .map(([at, day]) => `${at}-${pad(day)}`);

/** The other side of a register line. */
const line = fc.oneof(
  { weight: 1, arbitrary: fc.constant({ to: "nothing" as const }) },
  { weight: 3, arbitrary: fc.record({ to: fc.constant("category" as const), category: ref }) },
  {
    weight: 2,
    arbitrary: fc.record({
      to: fc.constant("transfer" as const),
      account: ref,
      category: maybe(ref),
    }),
  },
);
type Line = typeof line extends fc.Arbitrary<infer A> ? A : never;

const lineInput = (pools: Pools, each: Line, from: string) => {
  if (each.to === "category") return { category: categoryOf(pools, each.category) };
  if (each.to === "transfer")
    return {
      transferAccount: pickOther(pools.accounts, each.account, from),
      ...(each.category === undefined ? {} : { category: categoryOf(pools, each.category) }),
    };
  return {};
};

/** Mostly the book's categories; now and then a system account, which should be refused. */
const categoryOf = (pools: Pools, at: number) =>
  at % 8 === 7 && pools.system.length > 0 ? pick(pools.system, at) : pick(pools.categories, at);

const splits = fc.array(fc.record({ amount, line }), { minLength: 2, maxLength: 3 });
type Splits = typeof splits extends fc.Arbitrary<infer A> ? A : never;
const splitsInput = (pools: Pools, lines: Splits, from: string) =>
  lines.map((each) => ({ amount: each.amount, ...lineInput(pools, each.line, from) }));
const total = (lines: Splits) => lines.reduce((sum, each) => sum + each.amount, 0);

/** Any account of the ledger, as a journal entry may post to. */
const ledgerAccount = (pools: Pools, at: number) =>
  pick([...pools.accounts, ...pools.categories, ...pools.system], at);

const postingLines = fc.array(
  fc.record({
    account: ref,
    amount,
    category: fc.oneof(
      { weight: 6, arbitrary: fc.constant(undefined) },
      { weight: 1, arbitrary: ref },
    ),
    cleared: flag,
  }),
  { minLength: 2, maxLength: 4 },
);
type PostingLines = typeof postingLines extends fc.Arbitrary<infer A> ? A : never;
/** Postings that sum to zero, the last taking up the difference. */
const balancedPostings = (pools: Pools, lines: PostingLines) => {
  const rest = lines.slice(1).reduce((sum, each) => sum + each.amount, 0);
  return lines.map((each, index) => ({
    account: ledgerAccount(pools, each.account),
    amount: index === 0 ? -rest : each.amount,
    cleared: each.cleared,
    ...(each.category === undefined ? {} : { category: categoryOf(pools, each.category) }),
  }));
};

const condition = fc.oneof(
  fc.record({
    field: fc.constantFrom("payee", "category", "account"),
    op: fc.constantFrom("is", "isNot"),
    ref,
  }),
  fc.record({
    field: fc.constantFrom("payee", "category", "account"),
    op: fc.constantFrom("oneOf", "notOneOf"),
    refs,
  }),
  fc.record({ field: fc.constant("category_group"), op: fc.constant("is"), ref }),
  fc.record({ field: fc.constant("amount"), op: fc.constantFrom("lt", "gt"), value: amount }),
  fc.record({ field: fc.constant("notes"), op: fc.constant("contains"), value: text }),
  fc.record({
    field: fc.constantFrom("cleared", "reconciled"),
    op: fc.constant("is"),
    value: flag,
  }),
);
type Condition = typeof condition extends fc.Arbitrary<infer A> ? A : never;

const poolOf = (pools: Pools, field: string): ReadonlyArray<string> =>
  field === "payee"
    ? pools.payees
    : field === "category"
      ? pools.categories
      : field === "category_group"
        ? pools.groups
        : pools.accounts;

const conditionInput = (pools: Pools, each: Condition) =>
  "ref" in each
    ? { field: each.field, op: each.op, value: pick(poolOf(pools, each.field), each.ref) }
    : "refs" in each
      ? { field: each.field, op: each.op, value: pickAll(poolOf(pools, each.field), each.refs) }
      : each;

const action = fc.oneof(
  { weight: 4, arbitrary: fc.record({ set: fc.constant("category"), ref }) },
  { weight: 2, arbitrary: fc.record({ set: fc.constantFrom("payee", "account"), ref }) },
  { weight: 1, arbitrary: fc.record({ set: fc.constant("notes"), value: text }) },
  { weight: 1, arbitrary: fc.record({ set: fc.constant("amount"), value: amount }) },
  { weight: 1, arbitrary: fc.record({ set: fc.constant("cleared"), value: flag }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("append-notes"), value: text }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("delete-transaction") }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("split"), ref }) },
);
type Action = typeof action extends fc.Arbitrary<infer A> ? A : never;

const actionInputs = (pools: Pools, each: Action): Array<Record<string, unknown>> => {
  if ("set" in each) {
    const value =
      "ref" in each ? pick(poolOf(pools, each.set), each.ref) : (each as { value: unknown }).value;
    return [{ op: "set", field: each.set, value }];
  }
  if (each.op === "append-notes")
    return [{ op: each.op, value: (each as { value: string }).value }];
  if (each.op === "delete-transaction") return [{ op: each.op }];
  return [
    { op: "set-split-amount", splitIndex: 1, method: "remainder" },
    {
      op: "set",
      field: "category",
      splitIndex: 1,
      value: pick(pools.categories, (each as { ref: number }).ref),
    },
  ];
};

const rulePart = fc.record({
  conditions: fc.array(condition, { minLength: 1, maxLength: 2 }),
  actions: fc.array(action, { minLength: 1, maxLength: 2 }),
  conditionsOp: fc.constantFrom("and", "or"),
});
type RulePart = typeof rulePart extends fc.Arbitrary<infer A> ? A : never;
const ruleInput = (pools: Pools, rule: RulePart) => ({
  conditions: rule.conditions.map((each) => conditionInput(pools, each)),
  actions: rule.actions.flatMap((each) => actionInputs(pools, each)),
  conditionsOp: rule.conditionsOp,
});

/** What a step's interpreter sees. */
export interface Context {
  readonly world: World;
  readonly pools: Pools;
}

type Result = any;

/** One kind of step: how to draw it and how to run it. Its key is the operation it calls. */
interface StepKind<A> {
  readonly weight: number;
  readonly draw: fc.Arbitrary<A>;
  readonly input: (
    args: A,
    context: Context,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  /** Adds what the operation made to the pools. */
  readonly made?: (result: Result, pools: Pools, args: A) => void;
}

const kind = <A>(step: StepKind<A>): StepKind<any> => step;

const madeTransaction = (result: Result, pools: Pools) => {
  remember(pools.transactions, result?.id);
  remember(pools.payees, result?.payeeId);
};

/** A transaction's postings on the accounts of the register, the sides it can be edited from. */
const sidesOf = (tx: Result, pools: Pools): Array<string> =>
  tx.postings
    .map((posting: Result) => posting.accountId)
    .filter((id: string) => pools.accounts.includes(id));

const readTransaction = ({ world }: Context, id: string): Promise<Result> =>
  world.call("get_transaction", { id }).catch(() => null);

/** Adds transactions an operation made without naming them in its result. */
export const allTransactions = async ({ world, pools }: Context) => {
  const { rows } = await world.call("list_transactions", { limit: 100_000 });
  for (const row of rows) remember(pools.transactions, row.transactionId);
};

/** Two transactions that can merge, sharing an account and amount, looking from `from` on. */
const twinsFrom = async (context: Context, from: number) => {
  const { accounts, transactions } = context.pools;
  const firstWith = new Map<string, string>();
  for (const [index] of transactions.entries()) {
    const id = transactions[(from + index) % transactions.length]!;
    const tx = await readTransaction(context, id);
    for (const posting of tx?.postings ?? []) {
      if (!accounts.includes(posting.accountId)) continue;
      const key = `${posting.accountId}:${posting.amount}`;
      const twin = firstWith.get(key);
      if (twin !== undefined && twin !== id) return { keep: twin, drop: id };
      firstWith.set(key, id);
    }
  }
  return null;
};

/** Where SETUP's transactions land in the pool: what a random index would rarely hit in a run. */
const MARKED_TRANSFERS = [4, 5];
const COPIES = 6;
const BOTH_RECONCILED = 0;
const markedTransfer = fc.constantFrom(...MARKED_TRANSFERS);

const edit = fc.oneof(
  { weight: 3, arbitrary: fc.record({ edit: fc.constant("amount" as const), amount }) },
  {
    weight: 3,
    arbitrary: fc.record({
      edit: fc.constant("category" as const),
      category: fc.option(ref, { nil: null, freq: 2 }),
    }),
  },
  { weight: 3, arbitrary: fc.record({ edit: fc.constant("cleared" as const), cleared: flag }) },
  { weight: 2, arbitrary: fc.record({ edit: fc.constant("transfer" as const), account: ref }) },
  { weight: 2, arbitrary: fc.record({ edit: fc.constant("splits" as const), splits }) },
  { weight: 2, arbitrary: fc.record({ edit: fc.constant("postings" as const), postingLines }) },
  {
    weight: 2,
    arbitrary: fc.record({
      edit: fc.constant("same-postings" as const),
      shift: fc.constantFrom(0, 0, 100),
      memo: fc.option(text, { nil: undefined }),
    }),
  },
  { weight: 4, arbitrary: fc.constant({ edit: "no-postings" as const }) },
  { weight: 2, arbitrary: fc.constant({ edit: "one-posting" as const }) },
  {
    weight: 2,
    arbitrary: fc.record({
      edit: fc.constant("header" as const),
      date: fc.option(date, { nil: undefined }),
      payee: fc.option(label, { nil: undefined }),
      notes: fc.option(text, { nil: undefined }),
    }),
  },
);
type Edit = typeof edit extends fc.Arbitrary<infer A> ? A : never;

const editInput = (each: Edit, pools: Pools, tx: Result, side: string) => {
  const current: Array<Result> = tx?.postings ?? [];
  const asInput = (posting: Result) => ({
    account: posting.accountId,
    amount: posting.amount,
    ...(posting.categoryId === null ? {} : { category: posting.categoryId }),
  });
  switch (each.edit) {
    case "amount":
      return { account: side, amount: each.amount };
    case "category":
      return {
        account: side,
        category: each.category === null ? null : categoryOf(pools, each.category),
      };
    case "cleared":
      return { account: side, cleared: each.cleared };
    case "transfer":
      return { account: side, transferAccount: pickOther(pools.accounts, each.account, side) };
    case "splits":
      return {
        account: side,
        amount: total(each.splits),
        splits: splitsInput(pools, each.splits, side),
      };
    case "postings":
      return { postings: balancedPostings(pools, each.postingLines) };
    case "same-postings":
      return {
        postings: current.map((posting, index) => ({
          ...asInput(posting),
          ...(each.memo === undefined ? {} : { memo: each.memo }),
          amount:
            posting.amount +
            (index === 0 ? each.shift : index === current.length - 1 ? -each.shift : 0),
        })),
      };
    case "no-postings":
      return { postings: [] };
    case "one-posting":
      return { postings: current.slice(0, 1).map(asInput) };
    case "header":
      return {
        ...(each.date === undefined ? {} : { date: each.date }),
        ...(each.payee === undefined ? {} : { payee: each.payee }),
        ...(each.notes === undefined ? {} : { notes: each.notes }),
      };
  }
};

/** Every operation the generator calls. The coverage report reads its keys against the catalog. */
export const STEP_KINDS = {
  create_account: kind({
    weight: 3,
    draw: fc.record({
      name: label,
      type: fc.constantFrom("asset" as const, "liability" as const),
      onBudget: flag,
      balance: fc.oneof(fc.constant(0), amount),
      date,
    }),
    input: (args) => args,
    made: (result, pools) => remember(pools.accounts, result.id),
  }),
  update_account: kind({
    weight: 2,
    draw: fc.record({ account: ref, onBudget: flag }),
    input: ({ account, onBudget }, { pools }) => ({ id: pick(pools.accounts, account), onBudget }),
  }),
  move_account: kind({
    weight: 1,
    draw: fc.record({ account: ref, before: fc.option(ref, { nil: null, freq: 2 }) }),
    input: ({ account, before }, { pools }) => ({
      id: pick(pools.accounts, account),
      before: before === null ? null : pick(pools.accounts, before),
    }),
  }),
  close_account: kind({
    weight: 2,
    draw: fc.record({
      account: ref,
      into: fc.constantFrom("nothing", "account", "category"),
      target: ref,
    }),
    input: ({ account, into, target }, { pools }) => ({
      id: pick(pools.accounts, account),
      ...(into === "account" ? { transferAccount: pick(pools.accounts, target) } : {}),
      ...(into === "category" ? { category: pick(pools.categories, target) } : {}),
    }),
  }),
  reopen_account: kind({
    weight: 1,
    draw: ref,
    input: (account, { pools }) => ({ id: pick(pools.accounts, account) }),
  }),
  reconcile_account: kind({
    weight: 5,
    draw: fc.record({
      account: ref,
      off: fc.oneof(fc.constant(0), fc.constant(0), amount),
      adjust: flag,
    }),
    input: async ({ account, off, adjust }, { world, pools }) => {
      const id = pick(pools.accounts, account);
      const accounts = await world.call("list_accounts", { closed: true });
      const cleared = accounts.find((each: Result) => each.id === id)?.cleared ?? 0;
      return { id, balance: cleared + off, adjust };
    },
  }),

  create_category_group: kind({
    weight: 1,
    draw: fc.record({ name: label, isIncome: flag }),
    input: (args) => args,
    made: (result, pools) => remember(pools.groups, result.id),
  }),
  delete_category_group: kind({
    weight: 1,
    draw: fc.record({ group: ref, transfer: maybe(ref) }),
    input: ({ group, transfer }, { pools }) => ({
      id: pick(pools.groups, group),
      ...(transfer === undefined ? {} : { transferCategory: pick(pools.categories, transfer) }),
    }),
  }),
  create_category: kind({
    weight: 2,
    draw: fc.record({ name: label, group: ref, parent: maybe(ref) }),
    input: ({ name, group, parent }, { pools }) =>
      parent === undefined
        ? { name, groupId: pick(pools.groups, group) }
        : { name, parent: pick(pools.categories, parent) },
    made: (result, pools) => remember(pools.categories, result.id),
  }),
  update_category: kind({
    weight: 1,
    draw: fc.record({ category: ref, hidden: flag }),
    input: ({ category, hidden }, { pools }) => ({
      id: pick(pools.categories, category),
      hidden,
    }),
  }),
  move_category: kind({
    weight: 1,
    draw: fc.record({
      category: ref,
      group: maybe(ref),
      parent: maybe(ref),
    }),
    input: ({ category, group, parent }, { pools }) => ({
      id: pick(pools.categories, category),
      ...(group === undefined ? {} : { groupId: pick(pools.groups, group) }),
      ...(parent === undefined ? {} : { parent: pick(pools.categories, parent) }),
    }),
  }),
  delete_category: kind({
    weight: 2,
    draw: fc.record({ category: ref, transfer: maybe(ref) }),
    input: ({ category, transfer }, { pools }) => ({
      id: pick(pools.categories, category),
      ...(transfer === undefined ? {} : { transferCategory: pick(pools.categories, transfer) }),
    }),
  }),

  create_payee: kind({
    weight: 1,
    draw: label,
    input: (name) => ({ name }),
    made: (result, pools) => remember(pools.payees, result.id),
  }),
  update_payee: kind({
    weight: 1,
    draw: fc.record({ payee: ref, learnCategories: flag }),
    input: ({ payee, learnCategories }, { pools }) => ({
      id: pick(pools.payees, payee),
      learnCategories,
    }),
  }),
  merge_payees: kind({
    weight: 2,
    draw: fc.record({ target: ref, merge: refs }),
    input: ({ target, merge }, { pools }) => ({
      target: pick(pools.payees, target),
      merge: pickAll(pools.payees, merge),
    }),
  }),
  delete_payees: kind({
    weight: 2,
    draw: refs,
    input: (payees, { pools }) => ({ ids: pickAll(pools.payees, payees) }),
  }),

  create_transaction: kind({
    weight: 12,
    draw: fc.record({
      date,
      account: ref,
      payee: fc.option(label, { nil: undefined }),
      cleared: flag,
      entry: fc.oneof(
        { weight: 4, arbitrary: fc.record({ amount, line }) },
        { weight: 1, arbitrary: fc.record({ splits }) },
        { weight: 1, arbitrary: fc.record({ amount, crossing: ref }) },
      ),
    }),
    input: ({ date: day, account, payee, cleared, entry }, { pools }) => {
      if ("crossing" in entry)
        return {
          date: day,
          account: pools.accounts[0],
          amount: entry.amount,
          cleared,
          ...(payee === undefined ? {} : { payee }),
          transferAccount: pools.accounts[1],
          category:
            entry.crossing % 4 === 3
              ? pick(pools.system, entry.crossing)
              : pick(pools.categories, entry.crossing),
        };
      const from = pick(pools.accounts, account);
      return {
        date: day,
        account: from,
        cleared,
        ...(payee === undefined ? {} : { payee }),
        ...("splits" in entry
          ? { amount: total(entry.splits), splits: splitsInput(pools, entry.splits, from) }
          : { amount: entry.amount, ...lineInput(pools, entry.line, from) }),
      };
    },
    made: madeTransaction,
  }),
  create_journal_entry: kind({
    weight: 3,
    draw: fc.record({
      date,
      payee: fc.option(label, { nil: undefined }),
      postingLines,
      unbalanced: fc.constantFrom(0, 0, 0, 0, 1),
    }),
    input: ({ date: day, payee, postingLines: lines, unbalanced }, { pools }) => ({
      date: day,
      ...(payee === undefined ? {} : { payee }),
      postings: balancedPostings(pools, lines).map((posting, index) =>
        index === 0 ? { ...posting, amount: posting.amount + unbalanced } : posting,
      ),
    }),
    made: madeTransaction,
  }),
  update_transaction: kind({
    weight: 10,
    draw: fc.record({
      transaction: fc.oneof(
        { weight: 3, arbitrary: ref },
        { weight: 1, arbitrary: markedTransfer },
      ),
      side: ref,
      edit,
    }),
    input: async ({ transaction, side, edit: each }, context) => {
      const id = pick(context.pools.transactions, transaction);
      const tx = await readTransaction(context, id);
      const sides = tx === null ? [] : sidesOf(tx, context.pools);
      return { id, ...editInput(each, context.pools, tx, pick(sides, side)) };
    },
  }),
  update_transactions: kind({
    weight: 2,
    draw: fc.record({
      transactions: refs,
      account: ref,
      change: fc.oneof(
        fc.record({ cleared: flag }),
        fc.record({ notes: text }),
        fc.record({ payee: label }),
        fc.record({ category: ref }),
      ),
    }),
    input: ({ transactions, account, change }, { pools }) => ({
      ids: pickAll(pools.transactions, transactions),
      account: pick(pools.accounts, account),
      ...("category" in change ? { category: categoryOf(pools, change.category) } : change),
    }),
  }),
  delete_transactions: kind({
    weight: 4,
    draw: fc.record({ transactions: refs, confirmReconciled: fc.option(flag, { nil: undefined }) }),
    input: ({ transactions, confirmReconciled }, { pools }) => ({
      ids: pickAll(pools.transactions, transactions),
      ...(confirmReconciled === undefined ? {} : { confirmReconciled }),
    }),
  }),
  duplicate_transactions: kind({
    weight: 3,
    draw: refs,
    input: (transactions, { pools }) => ({ ids: pickAll(pools.transactions, transactions) }),
    made: (result, pools) => {
      for (const each of result) remember(pools.transactions, each.id);
    },
  }),
  merge_transactions: kind({
    weight: 5,
    draw: fc.record({
      keep: fc.oneof(
        { weight: 3, arbitrary: ref },
        { weight: 1, arbitrary: fc.constantFrom(COPIES, BOTH_RECONCILED) },
      ),
      drop: ref,
      twin: fc.constantFrom(true, true, true, false),
    }),
    input: async ({ keep, drop, twin }, context) => {
      const { pools } = context;
      const twins = twin ? await twinsFrom(context, keep) : null;
      if (twins !== null) return twins;
      const kept = pick(pools.transactions, keep);
      return { keep: kept, drop: pickOther(pools.transactions, drop, kept) };
    },
  }),

  set_budget: kind({
    weight: 4,
    draw: fc.record({ month, category: ref, amount: positive }),
    input: ({ category, ...args }, { pools }) => ({
      ...args,
      category: pick(pools.categories, category),
    }),
  }),
  move_budget: kind({
    weight: 2,
    draw: fc.record({
      month,
      from: fc.option(ref, { nil: null, freq: 2 }),
      to: fc.option(ref, { nil: null, freq: 2 }),
      amount: positive,
    }),
    input: ({ month: at, from, to, amount: size }, { pools }) => ({
      month: at,
      from: from === null ? "to-budget" : pickOrMissing(pools.categories, from),
      to: to === null ? "to-budget" : pickOrMissing(pools.categories, to),
      amount: size,
    }),
  }),
  hold_for_next_month: kind({
    weight: 2,
    draw: fc.record({ month, amount: positive }),
    input: (args) => args,
  }),
  reset_hold: kind({
    weight: 1,
    draw: fc.record({ month }),
    input: (args) => args,
  }),
  set_carryover: kind({
    weight: 2,
    draw: fc.record({ month, category: ref, carryover: flag }),
    input: ({ category, ...args }, { pools }) => ({
      ...args,
      category: pick(pools.categories, category),
    }),
  }),
  cover_overspending: kind({
    weight: 1,
    draw: fc.record({ month, category: ref, from: fc.option(ref, { nil: null, freq: 2 }) }),
    input: ({ month: at, category, from }, { pools }) => ({
      month: at,
      category: pick(pools.categories, category),
      from: from === null ? "to-budget" : pick(pools.categories, from),
    }),
  }),
  cover_overbudgeted: kind({
    weight: 1,
    draw: fc.record({ month, category: ref }),
    input: ({ month: at, category }, { pools }) => ({
      month: at,
      category: pick(pools.categories, category),
    }),
  }),
  apply_budget_action: kind({
    weight: 1,
    draw: fc.record({
      month,
      action: fc.constantFrom("copy-last", "set-zero", "average-3", "set-to-spent"),
      category: maybe(ref),
    }),
    input: ({ category, ...args }, { pools }) => ({
      ...args,
      ...(category === undefined ? {} : { category: pick(pools.categories, category) }),
    }),
  }),
  set_note: kind({
    weight: 3,
    draw: fc.record({
      on: fc.constantFrom("account", "category", "group", "month"),
      at: ref,
      text,
    }),
    input: ({ on, at, text: note }, { pools }) => ({
      id:
        on === "account"
          ? pickOrMissing(pools.accounts, at)
          : on === "category"
            ? pickOrMissing(pools.categories, at)
            : on === "group"
              ? pickOrMissing(pools.groups, at)
              : `budget-${THIS_MONTH}`,
      note,
    }),
  }),

  create_rule: kind({
    weight: 4,
    draw: fc.record({ rule: rulePart, recategorize: flag }),
    input: ({ rule, recategorize }, { pools }) => ({ ...ruleInput(pools, rule), recategorize }),
    made: (result, pools) => {
      remember(pools.rules, result.id);
    },
  }),
  update_rule: kind({
    weight: 1,
    draw: fc.record({ at: ref, rule: rulePart }),
    input: ({ at, rule }, { pools }) => ({ id: pick(pools.rules, at), ...ruleInput(pools, rule) }),
  }),
  delete_rules: kind({
    weight: 2,
    draw: refs,
    input: (rules, { pools }) => ({ ids: pickAll(pools.rules, rules) }),
  }),
  apply_rules: kind({
    weight: 3,
    draw: fc.oneof(
      fc.record({ all: fc.constant(true) }),
      fc.record({ at: ref }),
      fc.record({ transactions: refs }),
      fc.record({ rule: rulePart }),
      fc.record({ deleting: condition }),
    ),
    input: (args, { pools }) =>
      "all" in args
        ? { conditions: [] }
        : "at" in args
          ? { rule: pick(pools.rules, args.at) }
          : "transactions" in args
            ? { ids: pickAll(pools.transactions, args.transactions) }
            : "deleting" in args
              ? {
                  conditions: [conditionInput(pools, args.deleting)],
                  actions: [{ op: "delete-transaction" }],
                }
              : ruleInput(pools, args.rule),
  }),

  update_category_group: kind({
    weight: 1,
    draw: fc.record({ group: ref, hidden: flag }),
    input: ({ group, hidden }, { pools }) => ({ id: pick(pools.groups, group), hidden }),
  }),
  move_category_group: kind({
    weight: 1,
    draw: fc.record({ group: ref, before: fc.option(ref, { nil: null, freq: 2 }) }),
    input: ({ group, before }, { pools }) => ({
      id: pick(pools.groups, group),
      before: before === null ? null : pick(pools.groups, before),
    }),
  }),
  create_payee_rename_rule: kind({
    weight: 1,
    draw: fc.record({ to: ref, from: text }),
    input: ({ to, from }, { pools }) => ({ to: pick(pools.payees, to), fromNames: [from] }),
    made: (result, pools) => remember(pools.rules, result.id),
  }),

  create_schedule: kind({
    weight: 3,
    draw: fc.record({
      payee: maybe(label),
      account: ref,
      amount,
      date,
      category: maybe(ref),
      postsTransaction: flag,
    }),
    input: ({ payee, account, category, ...args }, { pools }) => ({
      ...args,
      account: pick(pools.accounts, account),
      ...(payee === undefined ? {} : { payee }),
      ...(category === undefined ? {} : { category: pick(pools.categories, category) }),
    }),
    made: (result, pools) => {
      remember(pools.schedules, result.id);
      remember(pools.rules, result.ruleId);
    },
  }),
  update_schedule: kind({
    weight: 1,
    draw: fc.record({ at: ref, amount: maybe(amount), date: maybe(date) }),
    input: ({ at, amount: size, date: day }, { pools }) => ({
      id: pick(pools.schedules, at),
      ...(size === undefined ? {} : { amount: size }),
      ...(day === undefined ? {} : { date: day }),
    }),
  }),
  delete_schedule: kind({
    weight: 2,
    draw: ref,
    input: (at, { pools }) => ({ id: pick(pools.schedules, at) }),
  }),
  skip_schedule_date: kind({
    weight: 1,
    draw: ref,
    input: (at, { pools }) => ({ id: pick(pools.schedules, at) }),
  }),
  post_schedule_transaction: kind({
    weight: 3,
    draw: fc.record({ at: ref, today: flag }),
    input: ({ at, today }, { pools }) => ({ id: pick(pools.schedules, at), today }),
    made: madeTransaction,
  }),
  complete_schedule: kind({
    weight: 1,
    draw: ref,
    input: (at, { pools }) => ({ id: pick(pools.schedules, at) }),
  }),
  restore_schedule: kind({
    weight: 1,
    draw: ref,
    input: (at, { pools }) => ({ id: pick(pools.schedules, at) }),
  }),
  run_schedules: kind({ weight: 1, draw: fc.constant({}), input: () => ({}) }),

  import_transactions: kind({
    weight: 3,
    draw: fc.record({
      account: ref,
      reconcile: flag,
      rows: fc.array(
        fc.record({
          date,
          amount,
          payee: maybe(label),
          importedId: maybe(fc.constantFrom("bank-1", "bank-2", "bank-3")),
          cleared: flag,
        }),
        { minLength: 1, maxLength: 3 },
      ),
    }),
    input: ({ account, reconcile, rows }, { pools }) => ({
      account: pick(pools.accounts, account),
      reconcile,
      rows: rows.map(({ payee, importedId, ...row }) => ({
        ...row,
        ...(payee === undefined ? {} : { payee }),
        ...(importedId === undefined ? {} : { importedId }),
      })),
    }),
  }),

  undo: kind({ weight: 5, draw: fc.constant({}), input: () => ({}) }),
  redo: kind({ weight: 3, draw: fc.constant({}), input: () => ({}) }),
} satisfies Partial<Record<OperationName, StepKind<any>>>;

export type StepOp = keyof typeof STEP_KINDS;
export interface Step {
  readonly op: StepOp;
  readonly args: unknown;
}

/** The operations `allTransactions` follows. */
export const refreshTransactionsAfter: ReadonlySet<string> = new Set([
  "reconcile_account",
  "close_account",
  "apply_rules",
  "import_transactions",
  "run_schedules",
  "undo",
  "redo",
]);

export const stepArbitrary: fc.Arbitrary<Step> = fc.oneof(
  ...Object.entries(STEP_KINDS).map(([op, each]) => ({
    weight: each.weight,
    arbitrary: each.draw.map((args): Step => ({ op: op as StepOp, args })),
  })),
);

/** The book every sequence starts on, through operations as any other step. */
export const SETUP: ReadonlyArray<Step> = [
  {
    op: "create_account",
    args: { name: "Checking", type: "asset", onBudget: true, balance: 100_000, date: "2026-05-01" },
  },
  {
    op: "create_account",
    args: { name: "Savings", type: "asset", onBudget: false, balance: 50_000, date: "2026-05-01" },
  },
  {
    op: "create_account",
    args: { name: "Card", type: "liability", onBudget: true, balance: 0, date: "2026-05-01" },
  },
  { op: "create_payee", args: "Rewe" },
  { op: "create_payee", args: "Aldi" },
  {
    op: "create_rule",
    args: {
      rule: {
        conditions: [{ field: "payee", op: "is", ref: 0 }],
        actions: [{ set: "category", ref: 1 }],
        conditionsOp: "and",
      },
      recategorize: false,
    },
  },
  {
    op: "create_transaction",
    args: {
      date: "2026-06-01",
      account: 0,
      cleared: true,
      entry: { amount: -1000, line: { to: "nothing" } },
    },
  },
  {
    op: "create_transaction",
    args: {
      date: "2026-06-02",
      account: 0,
      payee: "Aldi",
      cleared: true,
      entry: { amount: -500, line: { to: "category", category: 0 } },
    },
  },
  {
    op: "create_transaction",
    args: {
      date: "2026-06-03",
      account: 0,
      cleared: true,
      entry: { amount: -1000, line: { to: "transfer", account: 1, category: 0 } },
    },
  },
  { op: "reconcile_account", args: { account: 0, off: 0, adjust: false } },
  {
    op: "create_schedule",
    args: {
      payee: "Rent",
      account: 0,
      amount: -1000,
      date: "2026-06-01",
      category: 2,
      postsTransaction: false,
    },
  },
  { op: "post_schedule_transaction", args: { at: 0, today: false } },
  // Transfers whose far side a person marked: reconciled, then only cleared.
  ...[-2000, -3000].flatMap((size, index): Array<Step> => {
    const transfer = MARKED_TRANSFERS[index]!;
    return [
      {
        op: "create_transaction",
        args: {
          date: "2026-06-04",
          account: 0,
          cleared: false,
          entry: { amount: size, line: { to: "transfer", account: 1, category: 1 } },
        },
      },
      {
        op: "update_transaction",
        args: { transaction: transfer, side: 1, edit: { edit: "cleared", cleared: true } },
      },
      ...(index === 0
        ? ([{ op: "reconcile_account", args: { account: 1, off: 0, adjust: false } }] as const)
        : []),
    ];
  }),
  // Two copies of one purchase, one uncategorized, for a merge to bring together.
  {
    op: "create_transaction",
    args: {
      date: "2026-06-05",
      account: 0,
      cleared: false,
      entry: { amount: -700, line: { to: "nothing" } },
    },
  },
  {
    op: "create_transaction",
    args: {
      date: "2026-06-05",
      account: 0,
      cleared: false,
      entry: { amount: -700, line: { to: "category", category: 2 } },
    },
  },
  // A habit with Aldi, and a rule for every other payee that learning must leave alone.
  ...[0, 1].map((): Step => ({
    op: "create_transaction",
    args: {
      date: "2026-06-06",
      account: 0,
      payee: "Aldi",
      cleared: false,
      entry: { amount: -500, line: { to: "category", category: 0 } },
    },
  })),
  {
    op: "create_rule",
    args: {
      rule: {
        conditions: [{ field: "payee", op: "isNot", ref: 1 }],
        actions: [{ set: "category", ref: 3 }],
        conditionsOp: "and",
      },
      recategorize: false,
    },
  },
  // An empty account with a rule and a note, which closing it has to take along.
  {
    op: "create_account",
    args: { name: "Empty", type: "asset", onBudget: true, balance: 0, date: "2026-05-01" },
  },
  {
    op: "create_rule",
    args: {
      rule: {
        conditions: [{ field: "account", op: "is", ref: 3 }],
        actions: [{ set: "notes", value: "note" }],
        conditionsOp: "and",
      },
      recategorize: false,
    },
  },
  { op: "set_note", args: { on: "account", at: 3, text: "note" } },
];

const writes = Object.entries(catalog).flatMap(([name, operation]) =>
  operation.readonly ? [] : [name],
);

/** The catalog's write operations against the generator's; nothing else keeps this list. */
export const coverage = () => {
  const generated = new Set<string>(Object.keys(STEP_KINDS));
  return {
    writes,
    covered: writes.filter((name) => generated.has(name)),
    notCovered: writes.filter((name) => !generated.has(name)),
    notWrites: [...generated].filter((name) => !writes.includes(name)),
  };
};
