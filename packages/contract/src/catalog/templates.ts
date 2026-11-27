/** Budget targets: #template, #goal and #cleanup lines in category notes (docs/rules/budget.md). */
import { Schema } from "effect";
import { Day, Month } from "../domain.ts";
import { BookField, inBook, type Operation } from "../operation.ts";

const MonthField = Month.annotate({ description: "Month, YYYY-MM" });

export const TemplatesApplied = Schema.Struct({
  month: Month,
  /** templates-applied, templates-up-to-date (nothing to apply), or template-errors (nothing written). */
  message: Schema.Literals(["templates-applied", "templates-up-to-date", "template-errors"]),
  /** How many categories the templates budgeted. */
  applied: Schema.Int,
  /** "Category: why", for each category whose templates could not run. */
  errors: Schema.Array(Schema.String),
});
export type TemplatesApplied = typeof TemplatesApplied.Type;

export const CleanupApplied = Schema.Struct({
  month: Month,
  /** cleanup-applied, cleanup-up-to-date (nothing to move), or cleanup-no-funds (see warnings). */
  message: Schema.Literals(["cleanup-applied", "cleanup-up-to-date", "cleanup-no-funds"]),
  sources: Schema.Int,
  sinks: Schema.Int,
  warnings: Schema.Array(Schema.String),
});
export type CleanupApplied = typeof CleanupApplied.Type;

export const TemplateCheck = Schema.Struct({
  ok: Schema.Boolean,
  problems: Schema.Array(
    Schema.Struct({ category: Schema.String, name: Schema.String, message: Schema.String }),
  ),
});
export type TemplateCheck = typeof TemplateCheck.Type;

// ---------------------------------------------------------------------------------------------
// Targets as structured data: the shape of contract/src/targets.ts
// ---------------------------------------------------------------------------------------------

const Cents = Schema.Int.annotate({ description: "Money in cents: 90000 is 900.00" });
const Count = Schema.Int.annotate({ description: "A whole number, at least 1" });
const Priority = Schema.Int.annotate({
  description:
    "Lower runs first when To Budget is short; 0 is a plain #template. A category's schedule and by targets share one priority.",
});

const TargetCap = Schema.Struct({
  amount: Cents,
  period: Schema.Literals(["monthly", "weekly", "daily"]),
  start: Schema.NullOr(Day).annotate({ description: "The first day of a weekly cap's weeks" }),
  hold: Schema.Boolean.annotate({
    description: "Keep what is above the cap instead of giving it back",
  }),
}).annotate({ description: "The balance the category stops at (Actual's `up to`)" });

const Adjustment = Schema.NullOr(
  Schema.Struct({
    by: Schema.Finite.annotate({ description: "Positive raises, negative lowers" }),
    unit: Schema.Literals(["percent", "fixed"]).annotate({
      description: "percent, or fixed cents",
    }),
  }),
);

export const TargetSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("simple"),
    priority: Priority,
    monthly: Schema.NullOr(Cents).annotate({
      description: "The amount each month; null with a cap means: top up to the cap",
    }),
    cap: Schema.NullOr(TargetCap),
  }).annotate({ description: "`#template 50`, or `#template up to 300` to top up" }),
  Schema.Struct({
    type: Schema.Literal("periodic"),
    priority: Priority,
    amount: Cents,
    period: Schema.Literals(["day", "week", "month", "year"]),
    every: Count,
    starting: Day,
    cap: Schema.NullOr(TargetCap),
  }).annotate({ description: "An amount every N days, weeks, months or years from a day" }),
  Schema.Struct({
    type: Schema.Literal("by"),
    priority: Priority,
    amount: Cents,
    month: Month,
    repeat: Schema.NullOr(
      Schema.Struct({ unit: Schema.Literals(["month", "year"]), every: Count }),
    ),
    spendFrom: Schema.NullOr(Month).annotate({
      description: "Start spending it from this month",
    }),
  }).annotate({ description: "Save an amount by a month, optionally repeating" }),
  Schema.Struct({
    type: Schema.Literal("percentage"),
    priority: Priority,
    percent: Schema.Finite,
    of: Schema.String.annotate({
      description: "An income category id, or `all income`, or `available funds`",
    }),
    previous: Schema.Boolean.annotate({ description: "Last month's income" }),
  }),
  Schema.Struct({
    type: Schema.Literal("schedule"),
    priority: Priority,
    schedule: Schema.String.annotate({ description: "The schedule's name" }),
    full: Schema.Boolean.annotate({
      description: "Budget the whole bill in its month instead of saving up for it",
    }),
    adjustment: Adjustment,
  }),
  Schema.Struct({
    type: Schema.Literal("average"),
    priority: Priority,
    months: Count,
    adjustment: Adjustment,
  }).annotate({ description: "The average spent over the last N months" }),
  Schema.Struct({ type: Schema.Literal("copy"), priority: Priority, monthsAgo: Count }).annotate({
    description: "What was budgeted N months ago",
  }),
  Schema.Struct({
    type: Schema.Literal("remainder"),
    weight: Count,
    cap: Schema.NullOr(TargetCap),
  }).annotate({ description: "A share, by weight, of what is left after every other target" }),
  Schema.Struct({ type: Schema.Literal("goal"), amount: Cents }).annotate({
    description: "A long-term balance to reach; budgets nothing (`#goal`)",
  }),
]);

export const LeftoverSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("give-back") }).annotate({
    description: "Give leftover money back to To Budget (`#cleanup source`)",
  }),
  Schema.Struct({ kind: Schema.Literal("send"), to: Schema.String }).annotate({
    description:
      "Send leftover money to the category `to`: a pool named after it, which this category gives to and it takes from",
  }),
  Schema.Struct({ kind: Schema.Literal("receive"), weight: Count }).annotate({
    description: "Collect, by weight, what is in To Budget after cleanup (`#cleanup sink`)",
  }),
  Schema.Struct({ kind: Schema.Literal("pool-give"), pool: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("pool-receive"), pool: Schema.String, weight: Count }),
  Schema.Struct({ kind: Schema.Literal("pool-cover"), pool: Schema.String }).annotate({
    description: "Cover this category's overspending from the pool",
  }),
]);

export const CategoryTargets = Schema.Struct({
  category: Schema.String,
  name: Schema.String,
  targets: Schema.Array(TargetSchema),
  leftovers: Schema.Array(LeftoverSchema),
  /** Each target, then each leftover rule, as a plain sentence. */
  sentences: Schema.Array(Schema.String),
  /** The note lines the targets are kept as. */
  lines: Schema.Array(Schema.String),
  /** Template lines of the note that do not parse: left in the note untouched. */
  unreadable: Schema.Array(Schema.Struct({ line: Schema.String, error: Schema.String })),
});
export type CategoryTargets = typeof CategoryTargets.Type;

export const TargetPreview = Schema.Struct({
  month: Month,
  /** What the targets would budget this month, in cents; null when they cannot run. */
  budgeted: Schema.NullOr(Schema.Int),
  /** What each target adds, in order; null for a goal or a remainder. */
  perTarget: Schema.Array(Schema.NullOr(Schema.Int)),
  /** The month's goal the balance is measured against. */
  goal: Schema.NullOr(Schema.Int),
  problems: Schema.Array(Schema.String),
});
export type TargetPreview = typeof TargetPreview.Type;

const CategoryField = Schema.String.annotate({ description: "Category id" });

const TARGETS =
  "To read or change a category's targets, use get_category_targets and set_category_targets instead of writing note lines.";

const SYNTAX =
  "Templates are lines of a category's notes, as in Actual: `#template 50`, `#template up to 200`, `#template 1200 by 2026-12 repeat every year`, `#template 300 by 2026-12 spend from 2026-06`, `#template 25 repeat every week starting 2026-01-05`, `#template 10% of Salary` (or `of previous`, `all income`, `available funds`), `#template schedule [full] Rent [increase 5%]`, `#template average 6 months`, `#template copy from 12 months ago`, `#template remainder 2`, `#template-2 …` for a priority, `up to N [per day|per week starting DAY] [hold]` limits, and `#goal 1000` for a long-term goal.";

export const templates = {
  list_targets: {
    description:
      "Every category that has budget targets (goal templates or end-of-month leftover rules), each with its structured targets, leftover rules and plain sentences.",
    readonly: true,
    input: Schema.Struct({ book: BookField }),
    success: Schema.Array(CategoryTargets),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/targets" },
    cli: { command: ["targets", "list"], description: "List every category's targets" },
  },
  get_category_targets: {
    description:
      "A category's budget targets as structured data: what its #template, #goal and #cleanup note lines say, with a plain sentence for each, the lines themselves and any line that does not parse.",
    readonly: true,
    input: Schema.Struct({ book: BookField, category: CategoryField }),
    success: CategoryTargets,
    error: inBook(),
    http: { method: "GET", path: "/books/:book/targets/:category" },
    cli: { command: ["targets", "show"], description: "Show a category's targets" },
  },
  set_category_targets: {
    description:
      "Replace a category's budget targets, validated as the target editor does. It rewrites only the note's #template/#goal lines (and its #cleanup lines when leftovers is given), keeping the rest of the note and any line that does not parse. Target kinds: simple (the same amount monthly, or monthly null with a cap to top up to), periodic, by (save by a month; repeat; spendFrom), percentage, schedule, average, copy, remainder, goal. Leftover rules: give-back, send (to a category, which is marked to receive too), receive, and pool-give / pool-receive / pool-cover for named pools; an empty list keeps leftovers in the category. Amounts are cents. Apply them to a month with apply_category_templates.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      category: CategoryField,
      targets: Schema.optionalKey(
        Schema.Array(TargetSchema).annotate({
          description: "The category's targets, in order; left out, they stay as they are",
        }),
      ),
      leftovers: Schema.optionalKey(
        Schema.Array(LeftoverSchema).annotate({
          description: "End-of-month rules; left out, the #cleanup lines stay as they are",
        }),
      ),
      content: Schema.optionalKey(
        Schema.String.annotate({
          description:
            'Targets and leftovers as JSON text, {"targets": [...], "leftovers": [...]}, instead of the fields (for the command line)',
        }),
      ),
    }),
    success: CategoryTargets,
    error: inBook(),
    http: { method: "PUT", path: "/books/:book/targets/:category" },
    cli: {
      command: ["targets", "set"],
      description: "Replace a category's targets",
      examples: [
        {
          command: `reeve targets set --category <id> --content '{"targets":[{"type":"by","priority":0,"amount":90000,"month":"2027-02","repeat":null,"spendFrom":null}]}'`,
          description: "Save 900.00 by February 2027",
        },
      ],
    },
  },
  preview_category_targets: {
    description:
      "What targets would budget a category in a month, writing nothing: the total, each target's part, the goal, and the problems that stop them. Pass targets to try unsaved ones; left out, the saved ones.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      category: CategoryField,
      month: MonthField,
      targets: Schema.optionalKey(Schema.Array(TargetSchema)),
    }),
    success: TargetPreview,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/targets/:category/preview" },
    cli: {
      command: ["targets", "preview"],
      description: "Preview what a category's targets budget in a month",
    },
  },
  apply_templates: {
    description: `Apply the targets (templates) of every category that has nothing budgeted in a month yet, priority by priority within To Budget, then remainders; also sets each category's goal. ${SYNTAX} ${TARGETS}`,
    readonly: false,
    input: Schema.Struct({ book: BookField, month: MonthField }),
    success: TemplatesApplied,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/budget/:month/templates/apply" },
    cli: {
      command: ["templates", "apply"],
      description: "Fill a month's empty categories from their templates",
      examples: [{ command: "reeve templates apply --month 2026-11", description: "November" }],
    },
  },
  overwrite_templates: {
    description:
      "Apply the templates of every category in a month, replacing what is budgeted already.",
    readonly: false,
    input: Schema.Struct({ book: BookField, month: MonthField }),
    success: TemplatesApplied,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/budget/:month/templates/overwrite" },
    cli: {
      command: ["templates", "overwrite"],
      description: "Budget every category of a month from its templates",
    },
  },
  apply_category_templates: {
    description: "Apply one category's templates to a month, replacing what it has budgeted.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      month: MonthField,
      category: Schema.String.annotate({ description: "Category id" }),
    }),
    success: TemplatesApplied,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/budget/:month/templates/categories/:category" },
    cli: { command: ["templates", "category"], description: "Apply one category's templates" },
  },
  apply_group_templates: {
    description:
      "Apply the templates of a category group's categories to a month, replacing what they have budgeted.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      month: MonthField,
      group: Schema.String.annotate({ description: "Category group id" }),
    }),
    success: TemplatesApplied,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/budget/:month/templates/groups/:group" },
    cli: { command: ["templates", "group"], description: "Apply a group's templates" },
  },
  cleanup_templates: {
    description:
      "End-of-month cleanup of an envelope budget from #cleanup lines in category notes: `#cleanup source` gives a category's leftover back to To Budget, overspent categories are covered, and `#cleanup sink [weight]` categories share what To Budget then holds; `#cleanup <group> source`, `#cleanup <group> sink [weight]` and `#cleanup <group>` (cover overspending) do the same within a named group first.",
    readonly: false,
    input: Schema.Struct({ book: BookField, month: MonthField }),
    success: CleanupApplied,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/budget/:month/templates/cleanup" },
    cli: { command: ["templates", "cleanup"], description: "Run end-of-month cleanup" },
  },
  check_templates: {
    description:
      "Check every category's template lines: report each line that does not parse and each schedule a template names that does not exist.",
    readonly: true,
    input: Schema.Struct({ book: BookField }),
    success: TemplateCheck,
    error: inBook(),
    http: { method: "GET", path: "/books/:book/templates/check" },
    cli: { command: ["templates", "check"], description: "Check the templates in category notes" },
  },
} satisfies Record<string, Operation>;
