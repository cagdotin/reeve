import { availableCatalog, CLI_ANNOTATION, type Operation } from "@reeve/contract/catalog";
import { FEATURES } from "@reeve/contract/features";
import { SchemaAST } from "effect";

const firstSentence = (text: string) => text.split(/(?<=\.)\s/)[0]!;

/** `reeve accounts close <id>`: the words and the positional arguments of a command. */
const usage = (operation: Operation) => {
  if (operation.cli === undefined) return "no command";
  const positionals = Object.entries(operation.input.fields).flatMap(([key, field]) => {
    const annotation = SchemaAST.resolve(field.ast)?.[CLI_ANNOTATION] as
      | { readonly positional?: boolean }
      | undefined;
    if (annotation?.positional !== true) return [];
    return [SchemaAST.isOptional(field.ast) ? `[<${key}>]` : `<${key}>`];
  });
  return `\`${["reeve", ...operation.cli.command, ...positionals].join(" ")}\``;
};

const operations = Object.entries(availableCatalog());

const list = operations
  .map(
    ([name, operation]) =>
      `- \`${name}\`, ${usage(operation)}: ${firstSentence(operation.description)}`,
  )
  .join("\n");

const examples = operations.flatMap(([, operation]) => operation.cli?.examples ?? []);
const width = Math.max(...examples.map((example) => example.command.length));
const exampleBlock = examples
  .map((example) => `${example.command.padEnd(width)}  # ${example.description}`)
  .join("\n");

/** The agent skill `reeve skills export` writes, so agents know how to use the budget. */
export const SKILL = `---
name: reeve
description: Read and manage the user's personal budget in reeve (accounts, transactions, categories, the monthly budget, rules, schedules, bank-file imports, reports${FEATURES.purchases ? ", itemized receipts and item prices" : ""}). Use when asked about money, spending, balances, budgeting, bills, subscriptions or transactions${FEATURES.purchases ? ", receipts or what things cost" : ""}.
---

# reeve

reeve is a personal budget on a double-entry ledger that works like Actual Budget. Its data lives
in SQLite books under the reeve home; change it only through the \`reeve\` MCP tools or CLI.

## Model

- Money is an integer of cents: \`1234\` is 12.34. In a register, negative leaves the account.
- Accounts are assets and liabilities, on or off budget. Categories are the ledger's expense and
  income accounts, in groups. Every transaction is postings that sum to zero.
- The budget is envelope (zero-based) or tracking. Each month: budgeted, spent and balance per
  category, and To Budget: what income has not been assigned yet.
- A book is one budget file; omit \`--book\` for the default one.
- Rules change transactions as they are added (rename payees, set categories); schedules are
  expected bills and income.
- Budget targets say what a category needs each month and what happens to its leftover money at
  month end. Read them with \`get_category_targets\` (or \`list_targets\`) and change them with
  \`set_category_targets\` (\`reeve targets set --content '<json>'\`): structured targets in cents,
  validated, each with a plain sentence. Never write \`#template\`, \`#goal\` or \`#cleanup\` note
  lines yourself; the operation keeps them, and the rest of the note, in order.
  \`preview_category_targets\` shows what they would budget; \`apply_category_templates\` applies them.
- Creating a rule that sets a category, or changing the category a rule sets, recategorizes: that
  category goes on every existing transaction the rule matches (not splits, transfers or ones an
  applied receipt split), and only the category changes, in one undo step; \`recategorized\` lists
  them. Pass \`recategorize: false\` to save the rule for new transactions only. Check what it
  would touch with \`preview_rule\` first. Such a rule also turns learning off for the payees its
  conditions name, so reeve no longer rewrites it.
- \`transaction_rules\` explains one transaction: the rules that made it what it is, replayed from
  how it arrived, and the rules that match it now.
${
  FEATURES.purchases
    ? `- Receipts are itemized purchases that agents add (reeve reads no image and calls no model):
  \`create_receipt\` with its lines and an \`externalId\` (retrying returns the same receipt) → check
  its \`status\` and \`suggestions\` → \`link_receipt_payment\` (or \`auto_match_receipts\`) → assign
  products (\`list_unassigned_lines\`, \`suggest_products\`, \`assign_line_product\` with \`remember\`)
  → \`apply_receipt_to_transaction\` splits the bank transaction by budget category. Attach the
  photo with \`attach_receipt_photo\`; \`reeve receipts import <file.json>\` takes the same JSON.
  With the book setting \`autoApplyReceipts\` on (\`update_book\`), a receipt applies itself as soon
  as a write leaves it balanced, categorized and paid by one transaction that pays only it
  (\`autoApplied\` says so). One that was already ready and not applied, such as one whose
  transaction was split by hand, is left for \`apply_receipt_to_transaction\`.\n`
    : ""
}

## How to act

Call \`list_accounts\` and \`list_categories\` first to learn ids. Every operation is an MCP tool and,
where it has one, a \`reeve\` command with the same inputs as flags (\`reeve <command> --help\`):

${list}

\`\`\`sh
${exampleBlock}
\`\`\`

Every change can be reversed with \`undo\`.
`;
