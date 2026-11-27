import type { Account, CategoryGroup, Payee, RegisterRow } from "@reeve/contract";
import { useQuery } from "@tanstack/react-query";
import { useChoices } from "@/components/reports/choices";
import { createInput, type EntryValue, updateInput } from "@/components/register/entry";
import { EntryEditor } from "@/components/register/entry-editor";
import { TransactionRules } from "@/components/rules/related-rules";
import { RuleEditor } from "@/components/rules/rule-editor";
import { SplitPanel, usePaneLeave } from "@/components/split-panel";
import { bookQuery, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { type Editing, editedRow } from "@/lib/register";
import { draftForPayee } from "@/lib/rules";

/** The register's right-hand panel: a transaction's editor with its rules, or a rule opened from it. */
export function EntryPanel({
  editing,
  rows,
  account,
  accounts,
  groups,
  payees,
  onEditing,
  onDelete,
}: {
  editing: Editing | null;
  rows: ReadonlyArray<RegisterRow>;
  account: string | undefined;
  accounts: ReadonlyArray<Account>;
  groups: ReadonlyArray<CategoryGroup>;
  payees: ReadonlyArray<Payee>;
  onEditing: (editing: Editing | null) => void;
  onDelete: (row: RegisterRow) => void;
}) {
  const { id: book } = useBook();
  const create = useBookMutation(book, "create_transaction", { quiet: true });
  const update = useBookMutation(book, "update_transaction", { quiet: true });
  const leave = usePaneLeave();
  const close = () => onEditing(null);
  const save = (row: RegisterRow | null) => (value: EntryValue) =>
    row === null
      ? create.mutateAsync(createInput(value))
      : update.mutateAsync(updateInput(row, value));

  if (editing === null) return null;
  if (editing.kind === "rule")
    return <RulePane editing={editing} onBack={() => onEditing(editing.back)} />;
  if (editing.kind === "new")
    return (
      <SplitPanel title="New transaction" onClose={close}>
        <EntryEditor
          key="new"
          row={null}
          account={account}
          accounts={accounts}
          groups={groups}
          payees={payees}
          onSave={save(null)}
          onDone={close}
        />
      </SplitPanel>
    );
  const row = editedRow(editing, rows);
  if (row === undefined) return null;
  return (
    <SplitPanel title="Transaction" onClose={close}>
      <EntryEditor
        key={row.postingId}
        row={row}
        account={account}
        accounts={accounts}
        groups={groups}
        payees={payees}
        onSave={save(row)}
        onDone={close}
        onDelete={() => onDelete(row)}
        after={(typed) => (
          <TransactionRules
            row={row}
            onOpen={(rule) => leave(() => onEditing({ kind: "rule", rule, back: editing }))}
            onAdd={() => {
              const payee =
                payees.find((each) => each.name.toLowerCase() === typed.payee.trim().toLowerCase())
                  ?.id ?? row.payeeId;
              leave(() =>
                onEditing({
                  kind: "rule",
                  rule: payee === null ? {} : draftForPayee(payee, typed.category),
                  back: editing,
                }),
              );
            }}
          />
        )}
      />
    </SplitPanel>
  );
}

function RulePane({
  editing,
  onBack,
}: {
  editing: Extract<Editing, { kind: "rule" }>;
  onBack: () => void;
}) {
  const { id: book } = useBook();
  const { names, choices } = useChoices(book);
  const rules = useQuery(bookQuery(book, "list_rules", {})).data;
  return (
    <RuleEditor
      rule={editing.rule}
      open
      onOpenChange={(open) => !open && onBack()}
      choices={choices}
      names={names}
      rules={rules ?? []}
    />
  );
}
