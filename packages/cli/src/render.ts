import type { OperationName } from "@reeve/contract/catalog";
import { categoryLevels, formatAmount } from "@reeve/contract/rules";
import type { OperationSuccess } from "@reeve/engine";

const money = (amount: number) => formatAmount(amount).padStart(14);
const indent = (level: number | undefined) => "  ".repeat(level ?? 0);

/** How `reeve` prints an operation's success when `--json` is not given, line by line. */
export const renderers: {
  readonly [K in OperationName]?: (result: OperationSuccess<K>) => ReadonlyArray<string>;
} = {
  list_books: (books) =>
    books.length === 0 ? ["No books"] : books.map((book) => `${book.id.padEnd(24)} ${book.name}`),
  list_accounts: (accounts) =>
    accounts.length === 0
      ? ["No accounts"]
      : accounts.map(
          (account) =>
            `${account.id}  ${account.name.padEnd(28)} ${money(account.balance)}  ${account.onBudget ? "budget" : "off budget"}${account.closed ? "  closed" : ""}`,
        ),
  list_categories: (groups) =>
    groups.flatMap((group) => {
      const levels = categoryLevels(group.categories);
      return [
        `${group.name}${group.isIncome ? " (income)" : ""}${group.hidden ? " (hidden)" : ""}  ${group.id}`,
        ...group.categories.map(
          (category) =>
            `  ${category.id}  ${indent(levels.get(category.id))}${category.name}${category.hidden ? " (hidden)" : ""}`,
        ),
      ];
    }),
  list_payees: (payees) =>
    payees.map((payee) => `${payee.id}  ${payee.name}  (${payee.transactionCount})`),
  list_transactions: ({ rows, total }) => [
    ...rows.map((row) => {
      const other =
        row.counterpart.kind === "split"
          ? `Split (${row.counterpart.count})`
          : row.counterpart.kind === "uncategorized"
            ? "Uncategorized"
            : row.counterpart.kind === "transfer"
              ? `→ ${row.counterpart.name}`
              : row.counterpart.name;
      return `${row.date}  ${(row.payee ?? "").padEnd(24).slice(0, 24)}  ${other.padEnd(22).slice(0, 22)} ${money(row.amount)}${row.balance === null ? "" : money(row.balance)}  ${row.cleared ? "c" : " "}  ${row.transactionId}`;
    }),
    `${rows.length} of ${total}`,
  ],
  get_budget: (view) =>
    view.months.flatMap((month) => {
      const byId = new Map(month.categories.map((category) => [category.id, category]));
      const summary = month.summary;
      return [
        `${month.month}  ${
          summary.type === "envelope"
            ? `To Budget ${formatAmount(summary.toBudget)}  (income ${formatAmount(summary.income)}, budgeted ${formatAmount(-summary.totalBudgeted)}, held ${formatAmount(summary.hold)})`
            : `Saved ${formatAmount(summary.saved)} of ${formatAmount(summary.budgetedSaved)} budgeted`
        }`,
        `${"".padEnd(30)} ${"Budgeted".padStart(14)}${"Spent".padStart(14)}${"Balance".padStart(14)}`,
        ...view.groups.flatMap((group) => {
          const levels = categoryLevels(group.categories);
          const parents = new Set(group.categories.map((category) => category.parentId));
          return [
            group.name,
            ...group.categories.flatMap((category) => {
              const row = byId.get(category.id)!;
              const pad = indent(levels.get(category.id));
              const name = `${pad}${category.name}`.padEnd(28).slice(0, 28);
              const total = row.total;
              return [
                `  ${name} ${money(row.budgeted)}${money(row.spent)}${money(row.balance)}${row.carryover ? " →" : ""}`,
                ...(parents.has(category.id)
                  ? [
                      `  ${`${pad}  incl. sub`.padEnd(28).slice(0, 28)} ${money(total.budgeted)}${money(total.spent)}${money(total.balance)}`,
                    ]
                  : []),
              ];
            }),
          ];
        }),
        ...(view.uncategorized.count > 0
          ? [
              `${view.uncategorized.count} uncategorized transactions (${formatAmount(view.uncategorized.amount)})`,
            ]
          : []),
        "",
      ];
    }),
  list_receipts: ({ receipts, total }) => [
    ...receipts.map(
      (receipt) =>
        `${receipt.date}  ${(receipt.payee ?? "").padEnd(24).slice(0, 24)} ${money(receipt.total)}  ${receiptFlags(receipt.status)}  ${receipt.id}`,
    ),
    `${receipts.length} of ${total}`,
  ],
  get_receipt: (receipt) => [
    `${receipt.date}${receipt.time === null ? "" : ` ${receipt.time}`}  ${receipt.payee ?? "(no store)"}  ${receipt.id}`,
    ...receipt.lines.map(
      (line) =>
        `  ${String(line.position).padStart(3)}  ${line.text.padEnd(30).slice(0, 30)} ${String(line.quantity).padStart(6)} ${(line.unit ?? "").padEnd(5)}${money(line.lineTotal)}  ${line.product ?? "-"} / ${line.effectiveBudgetCategory ?? "no category"}`,
    ),
    ...receipt.adjustments.map(
      (adjustment) =>
        `       ${`${adjustment.kind}${adjustment.description === null ? "" : ` ${adjustment.description}`}`.padEnd(43).slice(0, 43)}${money(adjustment.amount)}`,
    ),
    `       ${"Expected".padEnd(43)}${money(receipt.status.expectedTotal)}`,
    `       ${"Total".padEnd(43)}${money(receipt.total)}`,
    ...receipt.payments.map(
      (payment) =>
        `  paid ${formatAmount(payment.amount)} by ${payment.transactionId} (${payment.date}, ${payment.account ?? "?"})${payment.applied ? " applied" : ""}`,
    ),
    ...receipt.photos.map((photo) => `  photo ${photo.path}`),
    `  ${receiptFlags(receipt.status)}`,
    ...receipt.warnings.map((warning) => `  ! ${warning.message}`),
  ],
  product_price_history: ({ unit, points }) =>
    points.length === 0
      ? ["No purchases"]
      : points.map(
          (point) =>
            `${point.date}  ${(point.payee ?? "").padEnd(20).slice(0, 20)} ${String(point.quantity).padStart(7)} ${(point.unit ?? "").padEnd(5)}${money(point.lineTotal)}  ${point.pricePerBase === null ? "-" : `${formatAmount(Math.round(point.pricePerBase))}/${unit}`}`,
        ),
};

/** A receipt's computed state in a few words. */
const receiptFlags = (status: {
  readonly balanced: boolean;
  readonly matched: boolean;
  readonly categorized: boolean;
  readonly applied: boolean;
}) =>
  [
    status.balanced ? "balanced" : "unbalanced",
    status.matched ? "matched" : "unmatched",
    status.categorized ? "categorized" : "uncategorized",
    ...(status.applied ? ["applied"] : []),
  ].join(", ");
