import type { Account } from "@reeve/contract";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { DownloadIcon, EllipsisIcon, FileUpIcon, LandmarkIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { CategorySelect } from "@/components/category-select";
import { ChoiceSelect } from "@/components/choice-select";
import { ImportDialog } from "@/components/register/import-dialog";
import { Money } from "@/components/money";
import { Button } from "@reeve/ui/components/button";
import { Checkbox } from "@reeve/ui/components/checkbox";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@reeve/ui/components/dialog";
import { Field, FieldLabel } from "@reeve/ui/components/field";
import { Input } from "@reeve/ui/components/input";
import { Label } from "@reeve/ui/components/label";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "@reeve/ui/components/menu";
import { bookQuery, run, showError, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";

type Dialogs = "rename" | "reconcile" | "close" | null;

/** Saves `text` as a file through the browser's download. */
const download = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  URL.revokeObjectURL(url);
};

/** An account's actions: rename, budget or not, reconcile, close or reopen. */
export function AccountMenu({ account }: { account: Account }) {
  const { id: book } = useBook();
  const update = useBookMutation(book, "update_account");
  const reopen = useBookMutation(book, "reopen_account");
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [importing, setImporting] = useState(false);
  const close = () => setDialog(null);
  const exportCsv = () =>
    void run("export_transactions", { book, account: account.id })
      .then((csv) => download(`${account.name}.csv`, csv))
      .catch(showError);
  return (
    <>
      <Menu>
        <MenuTrigger render={<Button size="icon" variant="ghost" aria-label="Account actions" />}>
          <EllipsisIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          {!account.closed && (
            <MenuItem onClick={() => setImporting(true)}>
              <FileUpIcon />
              Import transactions…
            </MenuItem>
          )}
          <MenuItem render={<Link to="/settings/$section" params={{ section: "banks" }} />}>
            <LandmarkIcon />
            Banks…
          </MenuItem>
          <MenuItem onClick={exportCsv}>
            <DownloadIcon />
            Export CSV
          </MenuItem>
          <MenuSeparator />
          {!account.closed && (
            <MenuItem onClick={() => setDialog("reconcile")}>Reconcile…</MenuItem>
          )}
          <MenuItem onClick={() => setDialog("rename")}>Rename…</MenuItem>
          {!account.closed && (
            <MenuItem
              onClick={() => update.mutate({ id: account.id, onBudget: !account.onBudget })}
            >
              {account.onBudget ? "Move off budget" : "Move on budget"}
            </MenuItem>
          )}
          <MenuSeparator />
          {account.closed ? (
            <MenuItem onClick={() => reopen.mutate({ id: account.id })}>Reopen account</MenuItem>
          ) : (
            <MenuItem variant="destructive" onClick={() => setDialog("close")}>
              Close account…
            </MenuItem>
          )}
        </MenuPopup>
      </Menu>
      <ImportDialog account={account} open={importing} onOpenChange={setImporting} />
      <Dialog open={dialog !== null} onOpenChange={(open) => !open && close()}>
        <DialogPopup className="max-w-sm">
          {dialog === "rename" && (
            <Rename id={account.id} initialName={account.name} onDone={close} />
          )}
          {dialog === "reconcile" && <Reconcile account={account} onDone={close} />}
          {dialog === "close" && <Close account={account} onDone={close} />}
        </DialogPopup>
      </Dialog>
    </>
  );
}

/** Mounts each time the dialog opens, so the name starts from the account's current one. */
function Rename({
  id,
  initialName,
  onDone,
}: {
  id: string;
  initialName: string;
  onDone: () => void;
}) {
  const { id: book } = useBook();
  const update = useBookMutation(book, "update_account");
  const [name, setName] = useState(initialName);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() !== "") update.mutate({ id, name: name.trim() }, { onSuccess: onDone });
  };
  return (
    <form onSubmit={submit} className="contents">
      <DialogHeader>
        <DialogTitle>Rename account</DialogTitle>
      </DialogHeader>
      <DialogPanel>
        <Input
          autoFocus
          aria-label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" type="button" />}>Cancel</DialogClose>
        <Button type="submit" disabled={name.trim() === ""}>
          Rename
        </Button>
      </DialogFooter>
    </form>
  );
}

function Reconcile({ account, onDone }: { account: Account; onDone: () => void }) {
  const { id: book, format, parse } = useBook();
  const reconcile = useBookMutation(book, "reconcile_account");
  const [text, setText] = useState(() => format(account.cleared));
  const [adjust, setAdjust] = useState(false);
  const statement = parse(text);
  const difference = statement === null ? null : statement - account.cleared;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (statement === null || (difference !== 0 && !adjust)) return;
    reconcile.mutate({ id: account.id, balance: statement, adjust }, { onSuccess: onDone });
  };
  return (
    <form onSubmit={submit} className="contents">
      <DialogHeader>
        <DialogTitle>Reconcile {account.name}</DialogTitle>
        <DialogDescription>
          Enter the balance on your bank statement. Clear the transactions it shows until the
          cleared balance matches; reconciling then locks them.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="grid gap-3">
        <Field>
          <FieldLabel>Statement balance</FieldLabel>
          <Input
            autoFocus
            inputMode="decimal"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Cleared balance</span>
          <Money amount={account.cleared} />
        </div>
        {difference !== null && difference !== 0 && (
          <>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Difference</span>
              <Money amount={difference} />
            </div>
            <Label className="flex items-center gap-2 font-normal">
              <Checkbox checked={adjust} onCheckedChange={setAdjust} />
              Add an adjustment transaction for the difference
            </Label>
          </>
        )}
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" type="button" />}>Cancel</DialogClose>
        <Button type="submit" disabled={statement === null || (difference !== 0 && !adjust)}>
          Reconcile
        </Button>
      </DialogFooter>
    </form>
  );
}

function Close({ account, onDone }: { account: Account; onDone: () => void }) {
  const { id: book } = useBook();
  const closeAccount = useBookMutation(book, "close_account");
  const accounts = useQuery(bookQuery(book, "list_accounts", {}));
  const categories = useQuery(bookQuery(book, "list_categories", {}));
  const [transfer, setTransfer] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const others = (accounts.data ?? []).filter((each) => each.id !== account.id);
  const items = others.map((each) => ({ value: each.id, label: each.name }));
  const needsTarget = account.balance !== 0;
  const target = transfer ?? category;
  const crossesBudget =
    transfer !== null && others.find((each) => each.id === transfer)?.onBudget !== account.onBudget;
  return (
    <div className="contents">
      <DialogHeader>
        <DialogTitle>Close {account.name}</DialogTitle>
        <DialogDescription>
          {needsTarget ? (
            <>
              It still holds <Money amount={account.balance} />. Move it to another account
              {account.onBudget ? ", or into a budget category," : ""} first.
            </>
          ) : (
            "A closed account keeps its transactions; one without any is deleted."
          )}
        </DialogDescription>
      </DialogHeader>
      {needsTarget && (
        <DialogPanel className="grid gap-3">
          <Field>
            <FieldLabel>Transfer the balance to</FieldLabel>
            <ChoiceSelect
              items={items}
              value={transfer}
              onChange={(value) => {
                setTransfer(value);
                setCategory(null);
              }}
              placeholder="Choose an account"
            />
          </Field>
          {account.onBudget && categories.data && (
            <Field>
              <FieldLabel>Or count it against a category</FieldLabel>
              <CategorySelect
                groups={categories.data}
                value={category}
                onChange={(value) => {
                  setCategory(value);
                  setTransfer(null);
                }}
                income
              />
            </Field>
          )}
          {crossesBudget && (
            <p className="text-xs text-muted-foreground">
              This transfer moves money across the budget's edge.
            </p>
          )}
        </DialogPanel>
      )}
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button
          variant="destructive"
          disabled={needsTarget && target === null}
          onClick={() =>
            closeAccount.mutate(
              {
                id: account.id,
                ...(transfer === null ? {} : { transferAccount: transfer }),
                ...(category === null ? {} : { category }),
              },
              { onSuccess: onDone },
            )
          }
        >
          Close account
        </Button>
      </DialogFooter>
    </div>
  );
}
