import { FEATURES } from "@reeve/contract/features";
import type { BookSettings } from "@reeve/contract";
import { formatAmount } from "@reeve/contract/rules";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, PlusIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { BookDialog } from "@/components/book-dialog";
import { ChoiceSelect } from "@/components/choice-select";
import { useTheme } from "@/components/theme-provider";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@reeve/ui/components/alert-dialog";
import { Badge } from "@reeve/ui/components/badge";
import { Button } from "@reeve/ui/components/button";
import { Input } from "@reeve/ui/components/input";
import { Switch } from "@reeve/ui/components/switch";
import { ToggleGroup, ToggleGroupItem } from "@reeve/ui/components/toggle-group";
import { booksQuery, connectionQuery, useAppMutation, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { lastBook } from "@/lib/prefs";

const NUMBER_FORMATS = (
  ["comma-dot", "dot-comma", "space-comma", "apostrophe-dot", "comma-dot-in"] as const
).map((value) => ({
  value,
  label: formatAmount(123456789, { numberFormat: value, hideFraction: false }),
}));
const DATE_FORMATS = (
  ["MM/dd/yyyy", "dd/MM/yyyy", "yyyy-MM-dd", "MM.dd.yyyy", "dd.MM.yyyy"] as const
).map((value) => ({ value, label: value }));
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(
  (label, index) => ({ value: String(index), label }),
);
const THEMES = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;
const BUDGET_TYPES = [
  { value: "envelope", label: "Envelope budgeting" },
  { value: "tracking", label: "Tracking budgeting" },
] as const;

export function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <div className="grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-x-8 px-(--page-gutter) pt-2 pb-9 max-md:pt-4 max-md:pb-6 lg:grid-cols-[10rem_minmax(0,1fr)]">
        <h2 className="text-[15px] text-muted-foreground lg:pt-4">{label}</h2>
        <div>{children}</div>
      </div>
    </section>
  );
}

export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="flex w-full sm:w-64 sm:justify-end">{children}</div>
    </div>
  );
}

/** The open book's settings; they are read once per window, so a change reloads to format anew. */
export function useBookSettings() {
  const { id, book } = useBook();
  const update = useBookMutation(id, "update_book");
  const set = (change: Partial<BookSettings>) =>
    update.mutate(change, { onSuccess: () => location.reload() });
  return { book, settings: book.settings, update, set };
}

export function GeneralSettings() {
  return (
    <>
      <BookIdentity />
      <BudgetSettings />
      <FormatSettings />
      {FEATURES.purchases && <ReceiptSettings />}
    </>
  );
}

function BookIdentity() {
  const { book, settings, set } = useBookSettings();
  const [name, setName] = useState(settings.name);
  const [currency, setCurrency] = useState(settings.currency);
  return (
    <Group label="Book">
      <Row label="Name">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => name.trim() !== "" && name !== settings.name && set({ name: name.trim() })}
        />
      </Row>
      <Row label="Currency" hint="An ISO code such as USD or EUR; for display only.">
        <Input
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
          onBlur={() =>
            currency.trim() !== "" &&
            currency !== settings.currency &&
            set({ currency: currency.trim().toUpperCase() })
          }
        />
      </Row>
      <Row label="File" hint="The whole book is this one SQLite file.">
        <code className="block min-w-0 truncate text-xs text-muted-foreground" title={book.file}>
          {book.file}
        </code>
      </Row>
    </Group>
  );
}

function BudgetSettings() {
  const { settings, update, set } = useBookSettings();
  const [depth, setDepth] = useState(String(settings.categoryDepth));
  return (
    <Group label="Budget">
      <Row
        label="Budget type"
        hint="Envelope budgets the money you have; tracking plans income and spending. Each keeps its own amounts."
      >
        <ChoiceSelect
          items={BUDGET_TYPES}
          value={settings.budgetType}
          onChange={(budgetType) => set({ budgetType })}
        />
      </Row>
      <Row
        label="Category nesting depth"
        hint="How many levels categories may nest inside a group; 1 keeps them flat. It cannot go below the deepest nesting the book has."
      >
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={9}
          step={1}
          aria-label="Category nesting depth"
          value={depth}
          onChange={(event) => setDepth(event.target.value)}
          onBlur={() => {
            const next = Number(depth);
            if (!Number.isInteger(next) || next < 1) setDepth(String(settings.categoryDepth));
            else if (next !== settings.categoryDepth)
              update.mutate(
                { categoryDepth: next },
                {
                  onSuccess: () => location.reload(),
                  onError: () => setDepth(String(settings.categoryDepth)),
                },
              );
          }}
        />
      </Row>
    </Group>
  );
}

function FormatSettings() {
  const { settings, set } = useBookSettings();
  return (
    <Group label="Numbers and dates">
      <Row label="Number format">
        <ChoiceSelect
          items={NUMBER_FORMATS}
          value={settings.numberFormat}
          onChange={(numberFormat) => set({ numberFormat })}
        />
      </Row>
      <Row label="Hide decimal places">
        <Switch
          checked={settings.hideFraction}
          onCheckedChange={(hideFraction) => set({ hideFraction })}
        />
      </Row>
      <Row label="Date format">
        <ChoiceSelect
          items={DATE_FORMATS}
          value={settings.dateFormat}
          onChange={(dateFormat) => set({ dateFormat })}
        />
      </Row>
      <Row label="First day of the week">
        <ChoiceSelect
          items={WEEKDAYS}
          value={String(settings.firstDayOfWeek)}
          onChange={(day) => set({ firstDayOfWeek: Number(day) })}
        />
      </Row>
    </Group>
  );
}

function ReceiptSettings() {
  const { settings, set } = useBookSettings();
  return (
    <Group label="Receipts">
      <Row
        label="Apply receipts automatically"
        hint="A receipt splits its transaction by category as soon as an edit leaves it balanced, categorized and paid by one transaction. Receipts already ready, and transactions you split by hand, are left for you to apply."
      >
        <Switch
          aria-label="Apply receipts automatically"
          checked={settings.autoApplyReceipts}
          onCheckedChange={(autoApplyReceipts) => set({ autoApplyReceipts })}
        />
      </Row>
    </Group>
  );
}

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  return (
    <Group label="Theme">
      <Row label="Appearance" hint="Light, dark, or whichever your system is using.">
        <ToggleGroup
          aria-label="Appearance"
          value={[theme]}
          onValueChange={(next) => {
            const picked = THEMES.find((each) => each.value === next[0]);
            if (picked) setTheme(picked.value);
          }}
          className="rounded-lg bg-muted p-0.5"
        >
          {THEMES.map((each) => (
            <ToggleGroupItem
              key={each.value}
              value={each.value}
              className="h-7 min-w-7 px-3 sm:h-7 sm:min-w-7 data-pressed:bg-background data-pressed:shadow-xs"
            >
              {each.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Row>
    </Group>
  );
}

export function Agents() {
  const connection = useQuery(connectionQuery);
  const [copied, setCopied] = useState(false);
  const url = connection.data?.mcpUrl;
  return (
    <Group label="Connect">
      <Row
        label="MCP server"
        hint="Point an MCP client at this URL to let agents read and change your books, or run `reeve mcp` for stdio."
      >
        <div className="flex w-full gap-1">
          <Input readOnly value={url ?? ""} className="font-mono text-xs" />
          <Button
            size="icon"
            variant="outline"
            aria-label="Copy MCP URL"
            disabled={url === undefined}
            onClick={() =>
              void navigator.clipboard.writeText(url!).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        </div>
      </Row>
    </Group>
  );
}

export function BookSettingsList() {
  const { id } = useBook();
  return <Books current={id} />;
}

function Books({ current }: { current: string }) {
  const books = useQuery(booksQuery);
  const setDefault = useAppMutation("set_default_book");
  const remove = useAppMutation("delete_book");
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const open = (book: string) => {
    lastBook.set(book);
    location.assign("/budget");
  };
  return (
    <Group label="On this computer">
      {(books.data ?? []).map((each) => (
        <div key={each.id} className="flex items-center gap-2 py-3 text-sm">
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate">{each.name}</span>
            {each.id === current && <Badge variant="secondary">Open</Badge>}
          </span>
          {each.id !== current && (
            <Button variant="outline" onClick={() => open(each.id)}>
              Open
            </Button>
          )}
          <Button variant="outline" onClick={() => setDefault.mutate({ id: each.id })}>
            Make default
          </Button>
          <Button
            variant="destructive-outline"
            disabled={each.id === current}
            onClick={() => setDeleting(each)}
          >
            Delete
          </Button>
        </div>
      ))}
      <div className="py-3">
        <Button variant="outline" onClick={() => setCreating(true)}>
          <PlusIcon />
          New book
        </Button>
      </div>
      <BookDialog open={creating} onOpenChange={setCreating} onCreated={open} />
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its file is removed with every account, transaction and budget in it. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() =>
                deleting &&
                remove.mutate({ id: deleting.id }, { onSuccess: () => setDeleting(null) })
              }
            >
              Delete book
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </Group>
  );
}
