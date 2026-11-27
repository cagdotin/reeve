/** Rules: conditions and actions that change transactions as they are added or imported. */
import { Schema } from "effect";
import { Amount, Day, EntryFields, Id, RegisterPage, SplitInput, Transaction } from "../domain.ts";
import { AccountScopeFields, BookField, IdField, inBook, type Operation } from "../operation.ts";

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

export const RuleField = Schema.Literals([
  "account",
  "category",
  "category_group",
  "date",
  "payee",
  "payee_name",
  "imported_payee",
  "counterparty_account",
  "notes",
  "amount",
  "amount_inflow",
  "amount_outflow",
  "cleared",
  "reconciled",
  "transfer",
]);
export type RuleField = typeof RuleField.Type;

export const RuleOp = Schema.Literals([
  "is",
  "isNot",
  "oneOf",
  "notOneOf",
  "contains",
  "doesNotContain",
  "matches",
  "gt",
  "gte",
  "lt",
  "lte",
  "isapprox",
  "isbetween",
  "onBudget",
  "offBudget",
  "hasTags",
  "hasAnyTag",
]);
export type RuleOp = typeof RuleOp.Type;

export const RuleCondition = Schema.Struct({
  field: RuleField,
  op: RuleOp,
  /**
   * An id or ids for account, category, category_group and payee (null for none); a string or
   * strings for text (`matches` is a regular expression, `hasTags` names `#tags`; counterparty_account
   * is the other party's IBAN or account number on the bank line, compared without spaces or case,
   * and never matches a transaction without a bank line); an amount in
   * minor units, or `{ num1, num2 }` for isbetween (amount_inflow and amount_outflow compare the
   * size of money in or out); a day, `YYYY-MM` or `YYYY` for `is`, or a `Recurrence` for a
   * schedule's date; a boolean for cleared, reconciled and transfer.
   */
  value: Schema.Unknown,
});
export type RuleCondition = typeof RuleCondition.Type;

export const RuleSetField = Schema.Literals([
  "account",
  "category",
  "date",
  "payee",
  "payee_name",
  "imported_payee",
  "notes",
  "amount",
  "cleared",
  "transfer_account",
]);
export type RuleSetField = typeof RuleSetField.Type;

export const RuleAction = Schema.Union([
  Schema.Struct({
    op: Schema.Literal("set"),
    field: RuleSetField,
    /**
     * An id for account, category, payee and transfer_account; a name for payee_name, which creates
     * the payee. transfer_account makes the transaction a transfer to that account.
     */
    value: Schema.Unknown,
    /** A Handlebars template that computes the value from the transaction. */
    template: Schema.optionalKey(Schema.String),
    /** A spreadsheet formula (`=...`) that computes the value; amounts read in major units. */
    formula: Schema.optionalKey(Schema.String),
    /** Set it on this split line (1 is the first) of the split the rule makes. */
    splitIndex: Schema.optionalKey(Schema.Int),
  }),
  Schema.Struct({
    op: Schema.Literal("set-split-amount"),
    /** The split line, 1 for the first. */
    splitIndex: Schema.Int,
    /** A fixed amount, a percent of what fixed amounts leave, an equal share of the rest, or a formula. */
    method: Schema.Literals(["fixed-amount", "fixed-percent", "remainder", "formula"]),
    value: Schema.optionalKey(Schema.Number),
    formula: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ op: Schema.Literal("link-schedule"), value: Id }),
  Schema.Struct({ op: Schema.Literal("prepend-notes"), value: Schema.String }),
  Schema.Struct({ op: Schema.Literal("append-notes"), value: Schema.String }),
  Schema.Struct({ op: Schema.Literal("delete-transaction") }),
]);
export type RuleAction = typeof RuleAction.Type;

/** pre runs first (renaming payees), then default, then post. */
export const RuleStage = Schema.Literals(["pre", "default", "post"]);
export type RuleStage = typeof RuleStage.Type;

export const RuleConditionsOp = Schema.Literals(["and", "or"]);

export const Rule = Schema.Struct({
  id: Id,
  stage: RuleStage,
  conditionsOp: RuleConditionsOp,
  conditions: Schema.Array(RuleCondition),
  actions: Schema.Array(RuleAction),
});
export type Rule = typeof Rule.Type;

const RuleId = IdField("Rule id");

/** How much a rule's conditions match among existing transactions, since no firing is logged. */
export const RuleActivity = Schema.Struct({
  ...Rule.fields,
  /** Its place in the run order, from 1. */
  position: Schema.Int,
  schedule: Schema.NullOr(
    Schema.Struct({ id: Id, name: Schema.NullOr(Schema.String), completed: Schema.Boolean }),
  ),
  /** No account condition limits it, so it can act on any account. */
  everyAccount: Schema.Boolean,
  /** Transactions its conditions match in the range; all of them over all time. */
  matches: Schema.Int,
  /** Over all time, whatever the range. */
  totalMatches: Schema.Int,
  lastMatch: Schema.NullOr(Day),
  /** Matches in each of the twelve months the overview's `months` lists. */
  months: Schema.Array(Schema.Int),
  /** For a rule that sets one category, the categorized matches, and how many carry that one. */
  categorized: Schema.Int,
  carryingCategory: Schema.Int,
  problems: Schema.Struct({
    /** Another rule has the same conditions and sets a different category. */
    conflict: Schema.Boolean,
    /** Another rule in its stage has the same conditions and the same actions. */
    duplicate: Schema.Boolean,
    /** No match in twelve months, and nothing explains that away. */
    quiet: Schema.Boolean,
    /** Most of its latest matches carry a different category from the one it sets. */
    disagrees: Schema.Boolean,
    /** What it names that is hidden, closed or gone. */
    stale: Schema.Array(
      Schema.Struct({
        state: Schema.Literals(["hidden", "closed", "deleted"]),
        field: Schema.Literals(["account", "category", "category_group", "payee"]),
        name: Schema.NullOr(Schema.String),
      }),
    ),
  }),
});
export type RuleActivity = typeof RuleActivity.Type;

const RuleTotals = Schema.Struct({
  /** Rules with a match. */
  active: Schema.Int,
  /** Transactions that could carry a category: no transfers or opening balances. */
  transactions: Schema.Int,
  /** Of those, the ones some rule's conditions match. */
  covered: Schema.Int,
  uncategorized: Schema.Int,
});

export const RuleOverview = Schema.Struct({
  rules: Schema.Array(RuleActivity),
  summary: Schema.Struct({
    ...RuleTotals.fields,
    previous: Schema.NullOr(RuleTotals),
  }),
  months: Schema.Array(Schema.Struct({ month: Schema.String, ...RuleTotals.fields })),
  /** Payees most worth a rule: recent transactions that no category rule matches. */
  suggestions: Schema.Array(
    Schema.Struct({
      id: Id,
      name: Schema.String,
      /** In the last twelve months, not matched by any rule that sets a category. */
      unmatched: Schema.Int,
      uncategorized: Schema.Int,
      lastTransaction: Day,
      /** The category most of its transactions carry; null when none has a clear majority. */
      category: Schema.NullOr(Id),
      categoryName: Schema.NullOr(Schema.String),
    }),
  ),
  /** How many suggestions the book has beyond the ones listed. */
  suggestionCount: Schema.Int,
  /** How many of them have uncategorized transactions to clear up. */
  uncategorizedPayees: Schema.Int,
});
export type RuleOverview = typeof RuleOverview.Type;

/** A saved rule with the transactions it recategorized. */
export const SavedRule = Schema.Struct({
  ...Rule.fields,
  recategorized: Schema.Array(Id).annotate({
    description: "The existing transactions that got the rule's category",
  }),
  categorized: Schema.Array(Id).annotate({
    description:
      "For a rule that sets a payee: uncategorized transactions it matches that got the category today's rules give them",
  }),
});
export type SavedRule = typeof SavedRule.Type;

/** What a rule changed on a transaction, with ids as names. */
export const RuleChange = Schema.Struct({
  field: Schema.Literals([
    "payee",
    "imported_payee",
    "category",
    "transfer_account",
    "split",
    "notes",
    "account",
    "date",
    "amount",
    "cleared",
    "schedule",
    "deleted",
  ]),
  from: Schema.NullOr(Schema.Union([Schema.String, Schema.Number, Schema.Boolean])),
  to: Schema.NullOr(Schema.Union([Schema.String, Schema.Number, Schema.Boolean])),
  /** The transaction still carries what the rule set. */
  holds: Schema.Boolean,
});
export type RuleChange = typeof RuleChange.Type;

/** The rules behind one transaction: how it came to be as it is, and what matches it now. */
export const TransactionRules = Schema.Struct({
  /** Imported: the replay starts from the bank's line; entered: from the transaction without its category. */
  origin: Schema.Literals(["imported", "entered"]),
  /** Each rule that changes the transaction on the replay, in run order, with what it changed. */
  applied: Schema.Array(Schema.Struct({ rule: Rule, changes: Schema.Array(RuleChange) })),
  /** The rules whose conditions match the transaction as it is now, in run order. */
  matching: Schema.Array(Rule),
});
export type TransactionRules = typeof TransactionRules.Type;

const Recategorize = Schema.optionalKey(Schema.Boolean).annotate({
  description:
    "false to save the rule without setting its category on existing transactions; true by default",
});

const ConditionFields = {
  conditionsOp: Schema.optionalKey(RuleConditionsOp).annotate({
    description: "Whether every condition must hold (and, the default) or any (or)",
  }),
  conditions: Schema.optionalKey(Schema.Array(RuleCondition)),
};

export const rules = {
  list_rules: {
    description:
      "List rules in the order they run: stage pre, default, post, and within a stage from the least to the most specific, so the most specific rule has the last word.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      payee: Schema.optionalKey(Id).annotate({
        description: "Only rules whose conditions or actions name this payee id",
      }),
    }),
    success: Schema.Array(Rule),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/rules" },
    cli: { command: ["rules", "list"], aliases: ["ls"], description: "List rules in run order" },
  },
  rule_activity: {
    description:
      "How rules do: for each rule in run order, the existing transactions its conditions match today in a range and per month, its last match, and what is wrong with it; how many transactions some rule matches; and the payees most worth a rule. reeve keeps no log of rule firings, so a match says what the conditions match now, not that the rule ran. Leave out since for all time, with no comparison. With a scope, only the rules that can act on its accounts, with matches and totals counted on those accounts; a rule that names only other accounts is left out, and one with everyAccount stays even with no match there.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      ...AccountScopeFields,
      since: Schema.optionalKey(Day).annotate({
        description: "Count matches on or after this day, against as many days before it",
      }),
    }),
    success: RuleOverview,
    error: inBook(),
    http: { method: "GET", path: "/books/:book/rules/activity" },
    cli: { command: ["rules", "activity"], description: "Show how rules do" },
  },
  get_rule: {
    description: "Read one rule.",
    readonly: true,
    input: Schema.Struct({ book: BookField, id: RuleId }),
    success: Rule,
    error: inBook(),
    http: { method: "GET", path: "/books/:book/rules/:id" },
    cli: { command: ["rules", "show"], description: "Show a rule" },
  },
  create_rule: {
    description:
      'Create a rule: when a transaction is added (or rules are applied), its actions change it if its conditions match. The accounts, categories, groups and payees it names must exist. A rule with no conditions never matches on its own. A rule that sets a category also recategorizes: that category goes on every existing transaction its conditions match (not splits, transfers, or transactions an applied receipt splits), and nothing else about them changes, in the same undo step; recategorized lists them. A rule that sets a category turns learning off for each payee its "payee is" or "payee is one of" conditions name, so learning never rewrites it. A rule that sets a payee also puts on the uncategorized transactions it matches the category the rules of today give them (categorized).',
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      stage: Schema.optionalKey(RuleStage),
      conditionsOp: ConditionFields.conditionsOp,
      conditions: Schema.Array(RuleCondition),
      actions: Schema.Array(RuleAction),
      recategorize: Recategorize,
    }),
    success: SavedRule,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/rules" },
  },
  update_rule: {
    description:
      "Change a rule: the fields given replace the rule's. When the change gives it a category to set (a new one, or a different one), the rule recategorizes as create_rule does, with its conditions as saved; a change that keeps its category recategorizes nothing. A schedule's rule keeps its payee, account, amount and date conditions, its link-schedule action and matching all conditions (change those with update_schedule); its other conditions, actions and stage may change. As with create_rule, a rule that sets a category turns learning off for the payees its conditions name.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book: BookField,
      id: RuleId,
      stage: Schema.optionalKey(RuleStage),
      ...ConditionFields,
      actions: Schema.optionalKey(Schema.Array(RuleAction)),
      recategorize: Recategorize,
    }),
    success: SavedRule,
    error: inBook(),
    http: { method: "PATCH", path: "/books/:book/rules/:id" },
  },
  delete_rules: {
    description:
      "Delete rules. A rule that belongs to a schedule stays: delete the schedule instead; it is listed in kept.",
    readonly: false,
    destructive: true,
    input: Schema.Struct({ book: BookField, ids: Schema.Array(Schema.String) }),
    success: Schema.Struct({
      deleted: Schema.Array(Schema.String),
      kept: Schema.Array(Schema.String),
    }),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/rules/delete" },
    cli: { command: ["rules", "delete"], description: "Delete rules" },
  },
  apply_rules: {
    description:
      "Run rules on existing transactions now. With rule (or actions), apply that rule's actions to the transactions, as Actual's 'apply actions'; otherwise run every rule on them, as the register's 'run rules'. The transactions are ids, or those matching conditions; with rule and neither, those matching the rule's conditions. A transaction a rule makes a transfer takes in the other account's plain copy of the movement, as an import does, and that copy is listed as deleted. With rule or actions, the uncategorized transactions among them then get the category today's rules give them, so a rename's category rules hold. Answers with the transactions that changed.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      rule: Schema.optionalKey(Id).annotate({ description: "Apply this rule's actions only" }),
      actions: Schema.optionalKey(Schema.Array(RuleAction)),
      ids: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
        description: "Transaction ids",
      }),
      account: Schema.optionalKey(Id).annotate({
        description: "Only the transactions as this account's register shows them",
      }),
      ...ConditionFields,
    }),
    success: Schema.Struct({
      updated: Schema.Array(Transaction),
      deleted: Schema.Array(Schema.String),
    }),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/rules/apply" },
    cli: {
      command: ["rules", "apply"],
      description: "Run rules on existing transactions",
      examples: [
        { command: "reeve rules apply --ids <id>,<id>", description: "Run every rule on two" },
        {
          command: "reeve rules apply --rule <id>",
          description: "Apply a rule to every transaction it matches",
        },
      ],
    },
  },
  preview_rule: {
    description:
      "The register rows a rule's conditions match among existing transactions, newest first: give a rule id or conditions. Text conditions on account, category and payee match their names, as Actual's rule editor shows.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      rule: Schema.optionalKey(Id),
      ...ConditionFields,
      account: Schema.optionalKey(Id).annotate({ description: "Only this account's register" }),
      onBudget: AccountScopeFields.onBudget,
      limit: Schema.optionalKey(Schema.Int).annotate({
        description: "At most this many rows; 200 by default",
      }),
      category: Schema.optionalKey(Id).annotate({
        description:
          "Also count, in recategorizes, the transactions saving the rule with this category would recategorize (in every account)",
      }),
    }),
    success: Schema.Struct({
      ...RegisterPage.fields,
      transactions: Schema.Int.annotate({
        description:
          "The distinct transactions matched; total counts register rows, two for a transfer whose sides both match",
      }),
      recategorizes: Schema.optionalKey(Schema.Int),
    }),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/rules/preview" },
    cli: { command: ["rules", "preview"], description: "Show what a rule matches" },
  },
  transaction_rules: {
    description:
      "The rules behind one transaction. reeve keeps no log of rule firings, so applied replays today's rules on the transaction as it arrived (an imported one from the bank's payee, date and amount, with no category; one entered by hand as it is, without its category) and lists each rule that changed something, with each change and whether the transaction still carries it. matching lists the rules whose conditions match the transaction as it is now.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      id: IdField("Transaction id"),
      account: Schema.optionalKey(Id).annotate({
        description:
          "The side of a transfer to look from; the first asset or liability account by default",
      }),
    }),
    success: TransactionRules,
    error: inBook(),
    http: { method: "GET", path: "/books/:book/transactions/:id/rules" },
    cli: { command: ["transactions", "rules"], description: "Show the rules behind a transaction" },
  },
  run_rules: {
    description:
      "Run every rule on a transaction that is not saved, and answer with what it would become; null when a rule deletes it. Nothing is written.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      ...EntryFields,
      importedPayee: Schema.optionalKey(Schema.NullOr(Schema.String)),
      counterpartyAccount: Schema.optionalKey(Schema.NullOr(Schema.String)).annotate({
        description: "The other party's IBAN or account number, as on a bank line",
      }),
      scheduleId: Schema.optionalKey(Schema.NullOr(Id)),
    }),
    success: Schema.NullOr(
      Schema.Struct({
        date: Day,
        account: Id,
        amount: Amount,
        payee: Schema.NullOr(Schema.String),
        category: Schema.NullOr(Id),
        transferAccount: Schema.NullOr(Id),
        splits: Schema.NullOr(Schema.Array(SplitInput)),
        notes: Schema.NullOr(Schema.String),
        cleared: Schema.Boolean,
        importedPayee: Schema.NullOr(Schema.String),
        scheduleId: Schema.NullOr(Id),
      }),
    ),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/rules/run" },
  },
  pending_rule_categories: {
    description:
      "Uncategorized transactions that today's rules would give a category: on budget accounts, neither split nor transfer. Rules run on each as it is now and only the category they end on counts. Categories set by hand are never in it.",
    readonly: true,
    input: Schema.Struct({ book: BookField, ...AccountScopeFields }),
    success: Schema.Struct({
      transactions: Schema.Array(
        Schema.Struct({
          id: Id,
          account: Id,
          category: Id.annotate({ description: "Category id" }),
        }),
      ),
    }),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/rules/pending-categories" },
    cli: {
      command: ["rules", "pending"],
      description: "List uncategorized transactions a rule would categorize",
    },
  },
  apply_rule_categories: {
    description:
      "Put on each uncategorized transaction in scope the category today's rules give it, as pending_rule_categories lists them, in one undo step. Only the category is written; categorized transactions, splits and transfers stay as they are. Answers with the ids categorized.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      ...AccountScopeFields,
      ids: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
        description: "Only these transactions",
      }),
    }),
    success: Schema.Struct({ categorized: Schema.Array(Id) }),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/rules/apply-categories" },
    cli: {
      command: ["rules", "apply-categories"],
      description: "Categorize uncategorized transactions by today's rules",
    },
  },
  create_payee_rename_rule: {
    description:
      "Rename imported payees: the pre-stage rule that sets payee to `to` when the imported payee is one of fromNames gets those names added, or is created. The renamed transactions and any still uncategorized that the rule matches get the category today's rules give them; categorized lists them.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      fromNames: Schema.Array(Schema.String),
      to: Id.annotate({ description: "Payee id" }),
    }),
    success: Schema.Struct({ ...Rule.fields, categorized: SavedRule.fields.categorized }),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/rules/payee-rename" },
  },
} satisfies Record<string, Operation>;
