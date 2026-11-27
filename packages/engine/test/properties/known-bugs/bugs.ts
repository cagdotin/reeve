/** The test that fails when the bug is back, which proves its patch really brings it back. */
interface Proof {
  readonly file: string;
  readonly test: string;
}

export interface KnownBug {
  readonly id: string;
  readonly bug: string;
  /** A file next to this one, which puts this one bug back on the current code. */
  readonly patch: string;
  readonly proof: Proof;
  /** Why no sequence of operations can reach it on the current code; the suite cannot catch it. */
  readonly unreachable?: string;
}

const INTEGRITY = "packages/engine/test/ledger-integrity.test.ts";
const FOUND = "packages/engine/test/found-by-properties";

export const KNOWN_BUGS: ReadonlyArray<KnownBug> = [
  {
    id: "K1",
    bug: "editing a transfer from the budget side wipes the other side's cleared mark",
    patch: "k01-transfer-edit-wipes-cleared.patch",
    proof: { file: INTEGRITY, test: "keeps the other side cleared when the amount changes" },
  },
  {
    id: "K2",
    bug: "the same edit wipes the other side's reconciled mark and changes its amount",
    patch: "k02-transfer-edit-wipes-reconciled.patch",
    proof: { file: INTEGRITY, test: "refuses to change the other side's reconciled amount" },
  },
  {
    id: "K3",
    bug: "editing a transfer from the off-budget side drops the category",
    patch: "k03-off-budget-edit-drops-category.patch",
    proof: { file: INTEGRITY, test: "keeps the category when edited from the off-budget side" },
  },
  {
    id: "K4",
    bug: "update_transaction with empty postings leaves a transaction with none",
    patch: "k04-empty-postings-allowed.patch",
    proof: { file: INTEGRITY, test: "refuses no postings" },
  },
  {
    id: "K5",
    bug: "update_transaction with postings changes a reconciled posting",
    patch: "k05-postings-edit-changes-reconciled.patch",
    proof: { file: INTEGRITY, test: "refuses to change a reconciled posting" },
  },
  {
    id: "K6",
    bug: "deleting a category leaves rules naming it",
    patch: "k06-deleted-category-stays-in-rules.patch",
    proof: { file: INTEGRITY, test: "go with a category deleted outright" },
  },
  {
    id: "K7",
    bug: "a rule naming a missing category makes new transactions and imports fail",
    patch: "k07-missing-category-stops-writes.patch",
    proof: { file: INTEGRITY, test: "do not stop transactions when a rule from an older book" },
    unreachable:
      "K6 and K16 closed the way in: no operation leaves a rule naming a missing category, " +
      "and a step may not write one behind the operations (docs/rules/ledger.md)",
  },
  {
    id: "K8",
    bug: "a rule's category replaces the one a person picked on create_transaction",
    patch: "k08-rule-replaces-picked-category.patch",
    proof: { file: INTEGRITY, test: "keeps the pick on a new transaction" },
  },
  {
    id: "K9",
    bug: "a transfer from an off-budget account is refused when a rule sets a category",
    patch: "k09-rule-refuses-off-budget-transfer.patch",
    proof: { file: INTEGRITY, test: "does not refuse the transfer" },
  },
  {
    id: "K10",
    bug: "rollover stops in a month past the rows set_carryover wrote",
    patch: "k10-rollover-stops-past-its-rows.patch",
    proof: { file: INTEGRITY, test: "goes on in months past the range it was set over" },
  },
  {
    id: "K11",
    bug: "merge_transactions merges different amounts or accounts",
    patch: "k11-merge-takes-different-amounts.patch",
    proof: { file: INTEGRITY, test: "refuses different amounts or accounts" },
  },
  {
    id: "K12",
    bug: "a merge loses the dropped copy's category, split or transfer",
    patch: "k12-merge-loses-category.patch",
    proof: { file: INTEGRITY, test: "gives an uncategorized copy the other's category" },
  },
  {
    id: "K13",
    bug: 'learning rewrites a "payee is not X" rule',
    patch: "k13-learning-rewrites-is-not.patch",
    proof: { file: INTEGRITY, test: "leaves a rule for every other payee alone" },
  },
  {
    id: "K14",
    bug: "deleting a reconciled transaction needs no confirmation",
    patch: "k14-reconciled-delete-needs-no-confirmation.patch",
    proof: { file: INTEGRITY, test: "needs confirmReconciled" },
  },
  {
    id: "K15",
    bug: "a rule can delete a reconciled transaction",
    patch: "k15-rule-deletes-reconciled.patch",
    proof: { file: INTEGRITY, test: "is never done by a rule" },
  },
  {
    id: "K16",
    bug: "a rule can name an account, category, group or payee that does not exist",
    patch: "k16-rule-names-what-is-missing.patch",
    proof: {
      file: `${FOUND}/rules-name-what-exists.test.ts`,
      test: "refuses a rule that names a missing category",
    },
  },
  {
    id: "K17",
    bug: "a transfer can count against Uncategorized",
    patch: "k17-transfer-counts-against-uncategorized.patch",
    proof: {
      file: `${FOUND}/transfer-category-is-a-real-category.test.ts`,
      test: "refuses a transfer that counts against Uncategorized",
    },
  },
  {
    id: "K18",
    bug: "a merge loses a reconciled posting",
    patch: "k18-merge-loses-reconciled.patch",
    proof: {
      file: `${FOUND}/merge-keeps-reconciled-money.test.ts`,
      test: "refuses when both copies are reconciled",
    },
  },
  {
    id: "K19",
    bug: "closing an empty account leaves its rules and note behind",
    patch: "k19-closing-leaves-rules-and-note.patch",
    proof: {
      file: `${FOUND}/closing-an-empty-account.test.ts`,
      test: "takes the account out of the rules that name it",
    },
  },
  {
    id: "K20",
    bug: "set_note writes a note on nothing, and a deleted group leaves its note",
    patch: "k20-note-on-nothing.patch",
    proof: {
      file: `${FOUND}/notes-belong-to-something.test.ts`,
      test: "refuses a note on nothing",
    },
  },
  {
    id: "K21",
    bug: "delete_schedule leaves the transactions it posted linked to nothing",
    patch: "k21-deleted-schedule-stays-linked.patch",
    proof: {
      file: `${FOUND}/deleting-a-schedule.test.ts`,
      test: "unlinks the transactions it posted",
    },
  },
  {
    id: "K22",
    bug: "move_budget fails in storage for a missing category",
    patch: "k22-move-budget-missing-category.patch",
    proof: { file: `${FOUND}/move-budget-names-categories.test.ts`, test: "says a missing from" },
  },
];
