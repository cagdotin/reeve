import { Schema } from "effect";
import { Category, CategoryGroup, Day, Payee, PayeeOverview } from "../domain.ts";
import {
  AccountScopeFields,
  BookField,
  IdField,
  cli,
  inBook,
  type Operation,
} from "../operation.ts";

const Before = Schema.optionalKey(Schema.NullOr(Schema.String)).annotate({
  description: "Place it before this id; last when null or left out",
});

const Description = Schema.optionalKey(Schema.NullOr(Schema.String)).annotate({
  description:
    "What it is for, so people and agents file transactions alike; blank or null for none",
});

const PayeeDescription = Schema.optionalKey(Schema.NullOr(Schema.String)).annotate({
  description: "Who it is, for a name that does not say; blank or null for none",
});

export const categories = {
  list_categories: {
    description:
      "List the category groups in budget order, each with its categories; the income group last.",
    readonly: true,
    input: Schema.Struct({ book: BookField }),
    success: Schema.Array(CategoryGroup),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/categories" },
    cli: { command: ["categories", "list"], description: "List categories by group" },
  },
  create_category_group: {
    description: "Create a category group.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      name: Schema.NonEmptyString.annotate(cli({ positional: true })),
      isIncome: Schema.optionalKey(Schema.Boolean),
      description: Description,
    }),
    success: CategoryGroup,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/category-groups" },
    cli: { command: ["categories", "create-group"], description: "Create a category group" },
  },
  update_category_group: {
    description: "Rename, describe or hide a category group.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book: BookField,
      id: IdField("Group id"),
      name: Schema.optionalKey(Schema.NonEmptyString),
      hidden: Schema.optionalKey(Schema.Boolean),
      description: Description,
    }),
    success: CategoryGroup,
    error: inBook(),
    http: { method: "PATCH", path: "/books/:book/category-groups/:id" },
  },
  move_category_group: {
    description: "Place a category group before another one.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({ book: BookField, id: IdField("Group id"), before: Before }),
    success: Schema.Array(CategoryGroup),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/category-groups/:id/move" },
  },
  delete_category_group: {
    description:
      "Delete a category group and its categories. Transactions and budgets of its categories move to transferCategory, which is required when any of them has transactions.",
    readonly: false,
    destructive: true,
    input: Schema.Struct({
      book: BookField,
      id: IdField("Group id"),
      transferCategory: Schema.optionalKey(Schema.String),
    }),
    success: Schema.Struct({ deleted: Schema.String }),
    error: inBook(),
    http: { method: "DELETE", path: "/books/:book/category-groups/:id" },
  },
  create_category: {
    description:
      "Create a category in a group, or under a parent category (whose group it takes), up to the book's categoryDepth levels.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      name: Schema.NonEmptyString.annotate(cli({ positional: true })),
      groupId: Schema.optionalKey(
        Schema.String.annotate({ description: "Group id; required without parent" }),
      ),
      parent: Schema.optionalKey(
        Schema.NullOr(Schema.String).annotate({ description: "Parent category id" }),
      ),
      before: Before,
      description: Description,
    }),
    success: Category,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/categories" },
    cli: { command: ["categories", "create"], description: "Create a category" },
  },
  update_category: {
    description: "Rename, describe or hide a category.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book: BookField,
      id: IdField("Category id"),
      name: Schema.optionalKey(Schema.NonEmptyString),
      hidden: Schema.optionalKey(Schema.Boolean),
      description: Description,
    }),
    success: Category,
    error: inBook(),
    http: { method: "PATCH", path: "/books/:book/categories/:id" },
    cli: { command: ["categories", "update"], description: "Rename, describe or hide a category" },
  },
  move_category: {
    description:
      "Move a category with its subcategories into a group, under parent (null or left out: the top of the group), before another sibling or last.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book: BookField,
      id: IdField("Category id"),
      groupId: Schema.optionalKey(
        Schema.String.annotate({ description: "Group id; required without parent" }),
      ),
      parent: Schema.optionalKey(
        Schema.NullOr(Schema.String).annotate({ description: "Parent category id" }),
      ),
      before: Before,
    }),
    success: Schema.Array(CategoryGroup),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/categories/:id/move" },
  },
  delete_category: {
    description:
      "Delete a category. Its transactions and budgets move to transferCategory, which is required when it has transactions; its subcategories move up to its parent.",
    readonly: false,
    destructive: true,
    input: Schema.Struct({
      book: BookField,
      id: IdField("Category id"),
      transferCategory: Schema.optionalKey(Schema.String),
    }),
    success: Schema.Struct({ deleted: Schema.String }),
    error: inBook(),
    http: { method: "DELETE", path: "/books/:book/categories/:id" },
    cli: { command: ["categories", "delete"], description: "Delete a category" },
  },
  list_payees: {
    description: "List payees by name, with how many transactions name each.",
    readonly: true,
    input: Schema.Struct({ book: BookField }),
    success: Schema.Array(Payee),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/payees" },
    cli: { command: ["payees", "list"], description: "List payees" },
  },
  payee_activity: {
    description:
      "How payees are used: transactions and spending in a range against the period before, twelve months of totals, their last transaction, categories and rules, the largest changes in spending, settled price changes, regular payees gone quiet, and what needs attention across the book. Leave out since for every payee, unused ones too, with no comparison. With a scope, only payees with a transaction on its accounts, closed ones too, and every count and total is of those transactions; rule facts stay the whole book's.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      ...AccountScopeFields,
      since: Schema.optionalKey(Day).annotate({
        description: "List only payees with a transaction on or after this day",
      }),
    }),
    success: PayeeOverview,
    error: inBook(),
    http: { method: "GET", path: "/books/:book/payees/activity" },
    cli: { command: ["payees", "activity"], description: "Show how payees are used" },
  },
  create_payee: {
    description:
      "Create a payee, or return the one with that name; a description given replaces its own.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book: BookField,
      name: Schema.NonEmptyString.annotate(cli({ positional: true })),
      description: PayeeDescription,
    }),
    success: Payee,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/payees" },
  },
  update_payee: {
    description:
      "Rename or describe a payee, or mark it favorite or as one whose categories rules should learn. A name another payee has is refused: merge them instead. A new name puts on its uncategorized transactions the category today's rules give them, in the same undo step.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book: BookField,
      id: IdField("Payee id"),
      name: Schema.optionalKey(Schema.NonEmptyString),
      description: PayeeDescription,
      favorite: Schema.optionalKey(Schema.Boolean),
      learnCategories: Schema.optionalKey(Schema.Boolean).annotate({
        description:
          'Whether a category picked for 3 of its latest 5 transactions makes or updates its "payee is" category rule. A category rule written by hand for it turns this off; turning it on again hands that rule back to learning',
      }),
      renameImports: Schema.optionalKey(Schema.Boolean).annotate({
        description:
          "Also send what later imports call it, under its old name too to this payee: the names on its imported transactions join its rename rule",
      }),
    }),
    success: Payee,
    error: inBook(),
    http: { method: "PATCH", path: "/books/:book/payees/:id" },
  },
  merge_payees: {
    description:
      "Merge payees into one: their transactions and rules name target, target takes the first description when it has none, and they are deleted. With name, target is renamed too, in the same undo step; a name another payee keeps is refused. Target's uncategorized transactions then get the category today's rules give them.",
    readonly: false,
    destructive: true,
    input: Schema.Struct({
      book: BookField,
      target: Schema.String,
      merge: Schema.Array(Schema.String).annotate({
        description: "The payees to merge into target",
      }),
      name: Schema.optionalKey(Schema.NonEmptyString).annotate({
        description: "A new name for target",
      }),
      renameImports: Schema.optionalKey(Schema.Boolean).annotate({
        description:
          "Also send what later imports call the merged payees to target: the names on its imported transactions join its rename rule",
      }),
    }),
    success: Payee,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/payees/merge" },
  },
  suggest_payee_merges: {
    description:
      "Groups of payees that look like one: the words of the first, without digits and punctuation, begin the words of the others. Each group is a suggestion to merge, the most used payee first; payees kept apart are never grouped together. With a scope, only groups with a payee that has a transaction on its accounts, closed ones too; the groups and counts stay the whole book's.",
    readonly: true,
    input: Schema.Struct({ book: BookField, ...AccountScopeFields }),
    success: Schema.Struct({ groups: Schema.Array(Schema.Array(Payee)) }),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/payees/suggested-merges" },
  },
  keep_payees_apart: {
    description:
      "Say payees are not one, so suggest_payee_merges does not group them together again.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book: BookField,
      payees: Schema.Array(Schema.String).annotate({ description: "Two or more payees" }),
    }),
    success: Schema.Struct({ pairs: Schema.Number }),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/payees/apart" },
  },
  delete_payees: {
    description:
      "Delete payees; their transactions keep no payee. A rule that needs one is deleted with it, one listing several only loses it. A payee a schedule's rule names is refused.",
    readonly: false,
    destructive: true,
    input: Schema.Struct({ book: BookField, ids: Schema.Array(Schema.String) }),
    success: Schema.Struct({ deleted: Schema.Array(Schema.String) }),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/payees/delete" },
  },
} satisfies Record<string, Operation>;
