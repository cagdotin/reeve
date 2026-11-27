import type { Account, CategoryGroup, Payee, RegisterRow } from "@reeve/contract";
import { today } from "@reeve/contract/rules";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, PlusIcon, SplitIcon, Trash2Icon, XIcon } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Ident, PaneActions, PaneFacts, PaneField, PaneSection } from "@/components/pane-form";
import { Picker } from "@/components/picker";
import { findItem, type PickerGroup } from "@/components/picker-items";
import { Badge } from "@reeve/ui/components/badge";
import { Button } from "@reeve/ui/components/button";
import { Checkbox } from "@reeve/ui/components/checkbox";
import { Input } from "@reeve/ui/components/input";
import { Label } from "@reeve/ui/components/label";
import { Textarea } from "@reeve/ui/components/textarea";
import { PaneFooter, usePaneTask } from "@/components/split-panel";
import { cn } from "@reeve/ui/lib/utils";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";
import {
  counterpartGroups,
  counterpartLabel,
  heldGroups,
  entryTotal,
  type EntryValue,
  type Line,
  SPLIT,
  splitLines,
  toEntry,
} from "./entry";

/**
 * A transaction's form in the pane, new or existing: when and who, where the money went, the
 * amount, then what the book knows about it that no field edits. Enter saves.
 */
export function EntryEditor({
  row,
  account,
  accounts,
  groups,
  payees,
  onSave,
  onDone,
  onDelete,
  after,
}: {
  row: RegisterRow | null;
  /** The register's account; without one the editor asks for it. */
  account: string | undefined;
  accounts: ReadonlyArray<Account>;
  groups: ReadonlyArray<CategoryGroup>;
  payees: ReadonlyArray<Payee>;
  /** Writes the entry, rejecting with what went wrong. */
  onSave: (value: EntryValue) => Promise<unknown>;
  onDone: () => void;
  onDelete?: () => void;
  /** What follows the form, given the payee and category as typed so far. */
  after?: (typed: { readonly payee: string; readonly category: string | null }) => ReactNode;
}) {
  const { format, parse } = useBook();
  const [accountText, setAccountText] = useState(
    () => accounts.find((each) => each.id === (row?.accountId ?? account))?.name ?? "",
  );
  const owner =
    row?.accountId ??
    account ??
    accounts.find((each) => each.name.toLowerCase() === accountText.trim().toLowerCase())?.id;
  const options = [...heldGroups(row), ...counterpartGroups(groups, accounts, owner, true)];
  const lineOptions = [...heldGroups(row), ...counterpartGroups(groups, accounts, owner, false)];

  const [date, setDate] = useState(() => row?.date ?? today());
  const [payee, setPayee] = useState(() => row?.payee ?? "");
  const [notes, setNotes] = useState(() => row?.notes ?? "");
  const [cleared, setCleared] = useState(() => row?.cleared ?? false);
  const [counterpart, setCounterpart] = useState(() => counterpartLabel(row));
  const [payment, setPayment] = useState(() => amountText(row, -1, format));
  const [deposit, setDeposit] = useState(() => amountText(row, 1, format));
  const [lines, setLines] = useState(() => splitLines(row, lineOptions, format));
  const splitting = findItem(options, counterpart)?.value === SPLIT;
  const total = entryTotal(payment, deposit, parse);

  const typed = JSON.stringify([
    accountText,
    date,
    payee,
    notes,
    cleared,
    counterpart,
    payment,
    deposit,
    lines,
  ]);
  const [initial] = useState(typed);
  const task = usePaneTask({
    dirty: typed !== initial,
    save: async () => {
      const fields = { owner, date, payee, notes, cleared, counterpart, payment, deposit };
      const entry = toEntry({ ...fields, splitting, lines }, options, lineOptions, parse, format);
      if (typeof entry === "string") throw new Error(entry);
      await onSave(entry);
    },
    done: onDone,
  });
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    task.submit();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      (event.metaKey || event.ctrlKey || !document.querySelector("[role=listbox]"))
    ) {
      event.preventDefault();
      submit();
    }
  };

  const split = () => {
    setCounterpart("Split transaction");
    if (lines.length === 0)
      setLines([{ key: 0, counterpart, amount: total === null ? "" : format(total), memo: "" }]);
  };

  return (
    <div className="grid gap-6">
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Enter saves from whichever field has focus. */}
      <form onSubmit={submit} onKeyDown={onKeyDown} className="grid gap-6">
        <PaneSection>
          <div className="grid grid-cols-2 gap-3">
            <PaneField label="Date">
              <Input
                type="date"
                aria-label="Date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </PaneField>
            {account === undefined && row === null ? (
              <PaneField label="Account">
                <AccountPicker accounts={accounts} value={accountText} onChange={setAccountText} />
              </PaneField>
            ) : (
              <PaneField label="Account">
                <span className="flex h-9 items-center truncate text-sm">{accountText}</span>
              </PaneField>
            )}
          </div>
          <PaneField label="Payee">
            <PayeePicker payees={payees} value={payee} onChange={setPayee} />
          </PaneField>
          <PaneField label="Category">
            <Picker
              groups={options}
              value={counterpart}
              onChange={setCounterpart}
              label="Category"
              placeholder="Category"
            />
          </PaneField>
          {splitting && (
            <SplitLines lines={lines} onChange={setLines} options={lineOptions} total={total} />
          )}
          <div className="grid grid-cols-2 gap-3">
            <PaneField label="Payment">
              <Input
                inputMode="decimal"
                aria-label="Payment"
                placeholder="0.00"
                value={payment}
                onChange={(event) => {
                  setPayment(event.target.value);
                  if (event.target.value !== "") setDeposit("");
                }}
                className="text-right tabular-nums"
              />
            </PaneField>
            <PaneField label="Deposit">
              <Input
                inputMode="decimal"
                aria-label="Deposit"
                placeholder="0.00"
                value={deposit}
                onChange={(event) => {
                  setDeposit(event.target.value);
                  if (event.target.value !== "") setPayment("");
                }}
                className="text-right tabular-nums"
              />
            </PaneField>
          </div>
          <PaneField label="Notes">
            <Textarea
              aria-label="Notes"
              placeholder="Notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </PaneField>
          <Label className="flex items-center gap-2 text-sm font-normal">
            <Checkbox aria-label="Cleared" checked={cleared} onCheckedChange={setCleared} />
            Cleared
          </Label>
        </PaneSection>
        {/* A hidden submit, so Enter in a field submits through the form. */}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
      {after?.({ payee, category: categoryOf(findItem(options, counterpart)?.value) })}
      {row !== null && <EntryDetails row={row} />}
      <PaneFooter>
        <PaneActions
          start={
            <>
              {onDelete && (
                <Button
                  variant="ghost"
                  className="text-destructive-foreground"
                  aria-label="Delete"
                  onClick={onDelete}
                >
                  <Trash2Icon />
                  <span className="max-sm:hidden">Delete</span>
                </Button>
              )}
              {!splitting && (
                <Button variant="ghost" aria-label="Split" onClick={split}>
                  <SplitIcon />
                  <span className="max-sm:hidden">Split</span>
                </Button>
              )}
            </>
          }
        >
          <Button variant="ghost" onClick={task.cancel}>
            Cancel
          </Button>
          <Button loading={task.saving} onClick={() => submit()}>
            <CheckIcon />
            {row === null ? "Add" : "Save"}
          </Button>
        </PaneActions>
      </PaneFooter>
    </div>
  );
}

/** What the book holds about a transaction beyond its fields: ids, the bank's line, every posting. */
function EntryDetails({ row }: { row: RegisterRow }) {
  const { id: book, format } = useBook();
  const { data } = useQuery(bookQuery(book, "get_transaction", { id: row.transactionId }));
  const accounts = useQuery(bookQuery(book, "list_accounts", { closed: true })).data;
  const categories = useQuery(bookQuery(book, "list_categories", {})).data;
  const nameOf = (id: string) =>
    accounts?.find((each) => each.id === id)?.name ??
    categories?.flatMap((group) => group.categories).find((each) => each.id === id)?.name ??
    id;
  const own = data?.postings.find((posting) => posting.id === row.postingId);
  return (
    <PaneSection title="Details">
      <PaneFacts
        facts={[
          ...(row.reconciled || row.scheduleId !== null
            ? [
                {
                  term: "Status",
                  value: (
                    <span className="flex flex-wrap gap-1">
                      {row.reconciled && <Badge variant="outline">Reconciled</Badge>}
                      {row.scheduleId !== null && <Badge variant="outline">Scheduled</Badge>}
                    </span>
                  ),
                },
              ]
            : []),
          ...(data?.importedPayee
            ? [{ term: "Bank's payee", value: <Ident>{data.importedPayee}</Ident> }]
            : []),
          ...(own?.importedId
            ? [{ term: "Bank's id", value: <Ident>{own.importedId}</Ident> }]
            : []),
          { term: "Transaction", value: <Ident>{row.transactionId}</Ident> },
        ]}
      />
      {data !== undefined && (
        <table className="w-full text-[13px]">
          <caption className="pb-1.5 text-start text-xs text-muted-foreground">Postings</caption>
          <tbody>
            {data.postings.map((posting) => (
              <tr key={posting.id} className="border-t">
                <td className="py-1.5 pe-2">
                  {nameOf(posting.accountId)}
                  {posting.memo && (
                    <span className="block text-xs text-muted-foreground">{posting.memo}</span>
                  )}
                </td>
                <td className="py-1.5 text-end tabular-nums">{format(posting.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PaneSection>
  );
}

const categoryOf = (value: string | undefined) =>
  value?.startsWith("c:") === true ? value.slice(2) : null;

/** A row's amount in the payment (`sign` -1) or deposit (`sign` 1) field, blank when on the other side. */
const amountText = (row: RegisterRow | null, sign: 1 | -1, format: (amount: number) => string) => {
  const amount = (row?.amount ?? 0) * sign;
  return amount > 0 ? format(amount) : "";
};

function AccountPicker({
  accounts,
  value,
  onChange,
}: {
  accounts: ReadonlyArray<Account>;
  value: string;
  onChange: (value: string) => void;
}) {
  const groups: Array<PickerGroup> = [
    {
      value: "",
      items: accounts
        .filter((each) => !each.closed)
        .map((each) => ({ value: each.id, label: each.name })),
    },
  ];
  return (
    <Picker
      groups={groups}
      value={value}
      onChange={onChange}
      label="Account"
      placeholder="Account"
    />
  );
}

function PayeePicker({
  payees,
  value,
  onChange,
}: {
  payees: ReadonlyArray<Payee>;
  value: string;
  onChange: (value: string) => void;
}) {
  const groups: Array<PickerGroup> = [
    {
      value: "",
      items: payees
        .toSorted((a, b) => Number(b.favorite) - Number(a.favorite))
        .map((each) => ({ value: each.id, label: each.name })),
    },
  ];
  return (
    <Picker groups={groups} value={value} onChange={onChange} label="Payee" placeholder="Payee" />
  );
}

/** A split transaction's lines, each a category or transfer, a memo and an amount. */
function SplitLines({
  lines,
  onChange,
  options,
  total,
}: {
  lines: ReadonlyArray<Line>;
  onChange: (lines: Array<Line>) => void;
  options: ReadonlyArray<PickerGroup>;
  total: number | null;
}) {
  const { format, parse } = useBook();
  const lineSum = lines.reduce((sum, line) => sum + (parse(line.amount) ?? 0), 0);
  const setLine = (key: number, change: Partial<Line>) =>
    onChange(lines.map((line) => (line.key === key ? { ...line, ...change } : line)));
  const add = () =>
    onChange([
      ...lines,
      {
        key: Math.max(-1, ...lines.map((line) => line.key)) + 1,
        counterpart: "",
        amount: total === null ? "" : format(total - lineSum),
        memo: "",
      },
    ]);

  return (
    <div className="grid gap-3 border-s-2 ps-3">
      <span className="text-xs font-medium text-muted-foreground">Split lines</span>
      {lines.map((line) => (
        <div key={line.key} className="grid grid-cols-[minmax(0,1fr)_7rem_auto] gap-1.5">
          <div className="col-span-3">
            <Picker
              groups={options}
              value={line.counterpart}
              onChange={(value) => setLine(line.key, { counterpart: value })}
              label="Split category"
              placeholder="Category"
            />
          </div>
          <Input
            aria-label="Split memo"
            placeholder="Memo"
            value={line.memo}
            onChange={(event) => setLine(line.key, { memo: event.target.value })}
          />
          <Input
            inputMode="decimal"
            aria-label="Split amount"
            placeholder="Amount (− out)"
            value={line.amount}
            onChange={(event) => setLine(line.key, { amount: event.target.value })}
            className="text-right tabular-nums"
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Remove split line"
            onClick={() => onChange(lines.filter((each) => each.key !== line.key))}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Button type="button" variant="ghost" onClick={add}>
          <PlusIcon />
          Add split line
        </Button>
        {total !== null && (
          <span className={cn(total - lineSum !== 0 && "text-warning-foreground")}>
            {format(total - lineSum)} left to split
          </span>
        )}
      </div>
    </div>
  );
}
