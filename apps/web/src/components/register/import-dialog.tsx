import type { Account } from "@reeve/contract";
import type { Input, Output } from "@reeve/contract/operations";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUpIcon } from "lucide-react";
import { useState } from "react";
import { Money } from "@/components/money";
import { Badge } from "@reeve/ui/components/badge";
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
import { Label } from "@reeve/ui/components/label";
import { ScrollArea } from "@reeve/ui/components/scroll-area";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@reeve/ui/components/select";
import { Spinner } from "@reeve/ui/components/spinner";
import { toastManager } from "@reeve/ui/components/toast";
import { cn } from "@reeve/ui/lib/utils";
import { bookKey, run, showError } from "@/lib/api";
import { useBook } from "@/lib/book";

type Options = Omit<Input<"preview_import">, "book" | "account" | "content" | "fileName">;
type Preview = Output<"preview_import">;

const NONE = "__none__";
const FIELDS = [
  ["dateField", "Date"],
  ["payeeField", "Payee"],
  ["notesField", "Notes"],
  ["amountField", "Amount"],
  ["inflowField", "Inflow"],
  ["outflowField", "Outflow"],
  ["categoryField", "Category"],
] as const;
const MAPPING_KEY = {
  dateField: "date",
  payeeField: "payee",
  notesField: "notes",
  amountField: "amount",
  inflowField: "inflow",
  outflowField: "outflow",
  categoryField: "category",
} as const;

const STATUS = {
  new: { label: "New", variant: "success" },
  update: { label: "Matches", variant: "info" },
  duplicate: { label: "Already there", variant: "secondary" },
  skipped: { label: "Skipped", variant: "secondary" },
  dismissed: { label: "Deleted before", variant: "secondary" },
  conflict: { label: "Changed at the bank", variant: "warning" },
} as const;

/** Actual's import dialog: pick a bank file, check the mapping and the matches, import. */
export function ImportDialog({
  account,
  open,
  onOpenChange,
}: {
  account: Account;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-5xl">
        {open && <ImportForm account={account} onDone={() => onOpenChange(false)} />}
      </DialogPopup>
    </Dialog>
  );
}

function ImportForm({ account, onDone }: { account: Account; onDone: () => void }) {
  const { id: book, formatDay } = useBook();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [options, setOptions] = useState<Options>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(new Set());

  // A mutation, not a query: each preview runs on a pick or an option change, and seeds the rows to skip.
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  const load = useMutation({
    mutationFn: (next: { file: { name: string; content: string }; options: Options }) =>
      run("preview_import", {
        book,
        account: account.id,
        content: next.file.content,
        fileName: next.file.name,
        ...next.options,
      }),
    onSuccess: (result) => {
      setPreview(result);
      setSkipped(
        new Set(result.rows.filter((row) => row.status === "duplicate").map((row) => row.index)),
      );
    },
    onError: showError,
  });

  const save = useMutation({
    mutationFn: () =>
      run("import_transactions", {
        book,
        account: account.id,
        rows: preview!.rows.map((row) => ({
          date: row.date,
          amount: row.amount,
          payee: row.payee,
          importedPayee: row.importedPayee,
          notes: row.notes,
          category: row.category,
          importedId: row.importedId,
          cleared: row.cleared,
          skip: skipped.has(row.index),
        })),
      }),
    onSuccess: (result) => {
      toastManager.add({
        type: "success",
        title: `Imported ${result.added.length} new, updated ${result.updated.length}`,
      });
      onDone();
    },
    onError: showError,
    onSettled: () => queryClient.invalidateQueries({ queryKey: bookKey(book) }),
  });

  const change = (next: Options) => {
    setOptions(next);
    if (file) load.mutate({ file, options: next });
  };

  const pick = async (picked: File | undefined) => {
    if (picked === undefined) return;
    const next = { name: picked.name, content: await picked.text() };
    setFile(next);
    setOptions({});
    load.mutate({ file: next, options: {} });
  };

  const rows = preview?.rows ?? [];
  const isCsv = preview?.fileType === "csv";
  const columns = (preview?.columns ?? []).map((column) => ({ value: column, label: column }));
  const mapped = (key: (typeof FIELDS)[number][0]) =>
    options[key] ?? preview?.mapping?.[MAPPING_KEY[key]] ?? null;
  const toImport = rows.filter((row) => !skipped.has(row.index)).length;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Import into {account.name}</DialogTitle>
        <DialogDescription>
          CSV, OFX, QFX, QIF or CAMT.053. Rows that match a transaction already in the account
          update it instead of adding a duplicate; rules run on every row.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="grid gap-4">
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-4 py-3 text-sm hover:bg-muted/40">
          <FileUpIcon className="size-5 text-muted-foreground" />
          <span className="flex-1">{file?.name ?? "Choose a bank file…"}</span>
          {load.isPending && <Spinner />}
          <input
            type="file"
            className="sr-only"
            accept=".csv,.tsv,.txt,.ofx,.qfx,.qif,.xml"
            onChange={(event) => void pick(event.target.files?.[0])}
          />
        </label>

        {isCsv && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border p-3 text-sm sm:grid-cols-4">
            {FIELDS.map(([key, label]) => (
              <div key={key} className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{label}</span>
                <Select
                  items={[{ value: NONE, label: "—" }, ...columns]}
                  value={mapped(key) ?? NONE}
                  onValueChange={(value) =>
                    change({
                      ...options,
                      [key]: value === NONE || value === null ? undefined : value,
                    })
                  }
                >
                  <SelectTrigger aria-label={`${label} column`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value={NONE}>—</SelectItem>
                    {columns.map((column) => (
                      <SelectItem key={column.value} value={column.value}>
                        {column.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            ))}
            <Label className="flex items-center gap-2 self-end font-normal">
              <Checkbox
                checked={options.hasHeaderRow ?? true}
                onCheckedChange={(hasHeaderRow) => change({ ...options, hasHeaderRow })}
              />
              Header row
            </Label>
            <Label className="flex items-center gap-2 font-normal">
              <Checkbox
                checked={options.flipAmount ?? false}
                onCheckedChange={(flipAmount) => change({ ...options, flipAmount })}
              />
              Flip amounts
            </Label>
          </div>
        )}

        {preview && preview.errors.length > 0 && (
          <p className="text-xs text-warning-foreground">
            {preview.errors.length} rows could not be read:{" "}
            {preview.errors
              .slice(0, 3)
              .map((error) => `row ${error.index + 1}: ${error.message}`)
              .join("; ")}
          </p>
        )}

        {preview && (
          <ScrollArea className="h-[45vh] rounded-lg border">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-background text-left text-xs text-muted-foreground">
                <tr>
                  <th className="w-8 p-2">
                    <span className="sr-only">Import</span>
                  </th>
                  <th className="p-2">Date</th>
                  <th className="p-2">Payee</th>
                  <th className="p-2">Notes</th>
                  <th className="p-2">Category</th>
                  <th className="p-2 text-right">Amount</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const off = skipped.has(row.index);
                  const status = row.status === null ? null : STATUS[row.status];
                  return (
                    <tr key={row.index} className={cn("border-t", off && "opacity-50")}>
                      <td className="p-2">
                        <Checkbox
                          aria-label="Import this row"
                          checked={!off}
                          onCheckedChange={(checked) => {
                            const next = new Set(skipped);
                            if (checked) next.delete(row.index);
                            else next.add(row.index);
                            setSkipped(next);
                          }}
                        />
                      </td>
                      <td className="p-2 whitespace-nowrap">{formatDay(row.date)}</td>
                      <td className="max-w-48 truncate p-2">{row.payee}</td>
                      <td className="max-w-48 truncate p-2 text-muted-foreground">{row.notes}</td>
                      <td className="p-2">{row.categoryName}</td>
                      <td className="p-2 text-right">
                        <Money amount={row.amount} />
                      </td>
                      <td className="p-2">
                        {status && <Badge variant={status.variant}>{status.label}</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button
          disabled={preview === null || toImport === 0}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          Import {toImport} {toImport === 1 ? "transaction" : "transactions"}
        </Button>
      </DialogFooter>
    </>
  );
}
