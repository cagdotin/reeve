import type { Category, CategoryGroup } from "@reeve/contract";
import type { CategoryTargets } from "@reeve/contract/catalog";
import { Alert, AlertDescription } from "@reeve/ui/components/alert";
import { currentMonth } from "@reeve/contract/rules";
import {
  conflictsOf,
  defaultTarget,
  describeTarget,
  KIND_INFO,
  kindOf,
  problemMessage,
  SPECIAL_INCOME_SOURCES,
  TARGET_KINDS,
  validateTarget,
  type Target,
  type TargetKind,
} from "@reeve/contract/targets";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDownIcon,
  CircleCheckIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { CategorySelect } from "@/components/category-select";
import { ICONS } from "@/components/budget/targets/icons";
import { toastTemplates } from "@/components/budget/templates";
import { Choices, CountField, SwitchRow, TargetFields } from "@/components/budget/targets/fields";
import {
  entry,
  leftoverForm,
  leftoverRules,
  newPoolRule,
  type EditorContext,
  type Entry,
  type LeftoverForm,
} from "@/components/budget/targets/model";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { ChoiceSelect } from "@/components/choice-select";
import { Button } from "@reeve/ui/components/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@reeve/ui/components/collapsible";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@reeve/ui/components/dialog";
import { Field, FieldLabel } from "@reeve/ui/components/field";
import { Input } from "@reeve/ui/components/input";
import { Spinner } from "@reeve/ui/components/spinner";
import { useIsMobile } from "@reeve/ui/hooks/use-media-query";
import { cn } from "@reeve/ui/lib/utils";
import { bookQuery, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { monthLabel } from "@/lib/months";

/** The category whose targets are being edited, and the month to preview and apply to. */
export interface TargetRequest {
  readonly category: Category;
  readonly month: string;
}

const TITLE = "Targets";
const DESCRIPTION =
  "Tell reeve what this category needs. When you apply targets, reeve fills in the budget for you.";

/** The target editor: a dialog, or a sheet from the bottom on a phone. */
export function TargetDialog({
  request,
  groups,
  onClose,
}: {
  request: TargetRequest | null;
  groups: ReadonlyArray<CategoryGroup>;
  onClose: () => void;
}) {
  const mobile = useIsMobile();
  const title = request ? `${TITLE} for ${request.category.name}` : TITLE;
  const editor = request && (
    <TargetLoader key={request.category.id} request={request} groups={groups} onClose={onClose} />
  );
  if (mobile)
    return (
      <BottomSheet
        open={request !== null}
        onOpenChange={(open) => !open && onClose()}
        title={title}
        description={DESCRIPTION}
      >
        {editor}
      </BottomSheet>
    );
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{DESCRIPTION}</DialogDescription>
        </DialogHeader>
        {editor}
      </DialogPopup>
    </Dialog>
  );
}

/** The body and the actions, laid out for a dialog or a sheet. */
function Frame({ body, footer }: { body: ReactNode; footer: ReactNode }) {
  const mobile = useIsMobile();
  if (mobile)
    return (
      <div className="grid gap-4">
        {body}
        <div className="sticky bottom-0 -mx-4 flex gap-2 border-t bg-popover px-4 py-3">
          {footer}
        </div>
      </div>
    );
  return (
    <>
      <DialogPanel className="grid gap-4">{body}</DialogPanel>
      <DialogFooter>{footer}</DialogFooter>
    </>
  );
}

function TargetLoader({
  request,
  groups,
  onClose,
}: {
  request: TargetRequest;
  groups: ReadonlyArray<CategoryGroup>;
  onClose: () => void;
}) {
  const { id: book } = useBook();
  const saved = useQuery(
    bookQuery(book, "get_category_targets", { category: request.category.id }),
  );
  const schedules = useQuery(bookQuery(book, "list_schedules", {}));
  if (saved.data === undefined || schedules.data === undefined)
    return (
      <Frame
        body={
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        }
        footer={null}
      />
    );
  const context: EditorContext = {
    month: request.month,
    schedules: schedules.data.flatMap((schedule) =>
      schedule.name ? [{ name: schedule.name, completed: schedule.completed }] : [],
    ),
    incomes: groups
      .filter((group) => group.isIncome)
      .flatMap((group) => group.categories.map(({ id, name }) => ({ id, name }))),
  };
  return (
    <TargetEditor
      request={request}
      saved={saved.data}
      context={context}
      groups={groups}
      onClose={onClose}
    />
  );
}

/** A value that follows `value` once it has stopped changing for `ms`. */
const useSettled = <T,>(value: T, ms: number): T => {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
};

const isPrioritized = (target: Target) => target.type !== "goal" && target.type !== "remainder";

/** Each target's problem, and the category's conflicts, as the engine checks them on save. */
const checkTargets = (targets: ReadonlyArray<Target>, context: EditorContext) => {
  const validation = {
    schedules: context.schedules,
    month: currentMonth(),
    incomeSources: new Set<string>([
      ...SPECIAL_INCOME_SOURCES,
      ...context.incomes.flatMap((income) => [income.id, income.name.toLowerCase()]),
    ]),
  };
  return {
    problems: targets.map((target) => validateTarget(target, validation)),
    conflicts: conflictsOf(targets),
  };
};

/** After saving: what the targets now say, and applying them to the month right away. */
function Saved({
  request,
  saved,
  onClose,
}: {
  request: TargetRequest;
  saved: CategoryTargets;
  onClose: () => void;
}) {
  const { id: book } = useBook();
  const apply = useBookMutation(book, "apply_category_templates");
  const any = saved.targets.length > 0;
  return (
    <Frame
      body={
        <div className="grid gap-3">
          <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/6 p-4">
            <CircleCheckIcon className="mt-0.5 size-5 shrink-0 text-success-foreground" />
            <div className="grid gap-1">
              <p className="font-medium">
                {saved.sentences.length === 0
                  ? `${request.category.name} has no targets now`
                  : "Saved"}
              </p>
              <ul className="grid gap-0.5 text-sm text-muted-foreground">
                {saved.sentences.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
          {any && (
            <p className="text-sm text-muted-foreground">
              Targets fill in the budget when you apply them: here, from a category's menu, or for
              every category from the month's menu.
            </p>
          )}
        </div>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className="max-md:flex-1">
            Done
          </Button>
          {any && (
            <Button
              className="max-md:flex-1"
              loading={apply.isPending}
              onClick={() =>
                apply.mutate(
                  { month: request.month, category: request.category.id },
                  {
                    onSuccess: (result) => {
                      toastTemplates(result);
                      onClose();
                    },
                  },
                )
              }
            >
              Apply to {monthLabel(request.month)} now
            </Button>
          )}
        </>
      }
    />
  );
}

function TargetEditor({
  request,
  saved,
  context,
  groups,
  onClose,
}: {
  request: TargetRequest;
  saved: CategoryTargets;
  context: EditorContext;
  groups: ReadonlyArray<CategoryGroup>;
  onClose: () => void;
}) {
  const { id: book, book: settings, format } = useBook();
  const envelope = settings.settings.budgetType === "envelope";
  const [entries, setEntries] = useState<ReadonlyArray<Entry>>(() => saved.targets.map(entry));
  const [leftovers, setLeftovers] = useState<LeftoverForm>(() => leftoverForm(saved.leftovers));
  const [done, setDone] = useState<CategoryTargets | null>(null);
  const save = useBookMutation(book, "set_category_targets");

  const targets = entries.map((each) => each.target);
  const names = new Map(groups.flatMap((group) => group.categories).map((c) => [c.id, c.name]));
  const sentence = { money: format, categoryName: (id: string) => names.get(id) };
  const { problems, conflicts } = checkTargets(targets, context);
  const rules = envelope ? leftoverRules(leftovers) : null;
  const ready =
    problems.every((problem) => problem === null) &&
    conflicts.length === 0 &&
    (!envelope || rules !== null);

  const preview = useTargetPreview(request, ready ? targets : null);

  const update = (key: string, target: Target) =>
    setEntries((current) => current.map((each) => (each.key === key ? { key, target } : each)));
  const add = (kind: TargetKind) => {
    const fresh = defaultTarget(kind, request.month);
    const first = context.schedules.find((schedule) => !schedule.completed);
    const target = fresh.type === "schedule" && first ? { ...fresh, schedule: first.name } : fresh;
    setEntries((current) => [...current, entry(target)]);
  };

  const submit = () => {
    if (!ready) return;
    save.mutate(
      {
        category: request.category.id,
        targets,
        ...(envelope && rules !== null ? { leftovers: rules } : {}),
      },
      { onSuccess: setDone },
    );
  };

  if (done !== null) return <Saved request={request} saved={done} onClose={onClose} />;

  return (
    <Frame
      body={
        <>
          {saved.unreadable.length > 0 && <Unreadable lines={saved.unreadable} />}
          {entries.map((each, index) => (
            <TargetCard
              key={each.key}
              index={index}
              target={each.target}
              sentence={describeTarget(each.target, sentence)}
              problem={problems[index] ? problemMessage(problems[index]) : null}
              amount={preview.amountOf(index)}
              context={context}
              onChange={(target) => update(each.key, target)}
              onRemove={() =>
                setEntries((current) => current.filter((other) => other.key !== each.key))
              }
            />
          ))}
          {conflicts.map((conflict) => (
            <p key={conflict.kind} className="text-sm text-destructive-foreground">
              {problemMessage(conflict)}
            </p>
          ))}
          <AddTarget count={entries.length} onAdd={add} />
          {entries.length > 0 && (
            <PreviewLine
              month={request.month}
              ready={ready}
              loading={preview.loading}
              budgeted={preview.budgeted}
              problems={preview.problems}
            />
          )}
          {envelope && (
            <LeftoverSection
              form={leftovers}
              onChange={setLeftovers}
              category={request.category}
              groups={groups}
            />
          )}
          {saved.lines.length > 0 && <SavedLines lines={saved.lines} />}
        </>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className="max-md:flex-1">
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!ready}
            loading={save.isPending}
            className="max-md:flex-1"
          >
            Save
          </Button>
        </>
      }
    />
  );
}

/** What unsaved targets would budget, asked of the engine once they stop changing. */
const useTargetPreview = (request: TargetRequest, targets: ReadonlyArray<Target> | null) => {
  const { id: book } = useBook();
  const settled = useSettled(targets, 300);
  const preview = useQuery({
    ...bookQuery(book, "preview_category_targets", {
      category: request.category.id,
      month: request.month,
      targets: settled ?? [],
    }),
    enabled: settled !== null && settled.length > 0,
    placeholderData: (previous) => previous,
  });
  const fresh = preview.data !== undefined && !preview.isPlaceholderData;
  return {
    loading: preview.isFetching,
    budgeted: preview.data?.budgeted ?? null,
    problems: preview.data?.problems ?? [],
    amountOf: (index: number) => (fresh ? (preview.data?.perTarget[index] ?? null) : null),
  };
};

/** The button that opens the kind picker; the picker itself while there is no target yet. */
function AddTarget({ count, onAdd }: { count: number; onAdd: (kind: TargetKind) => void }) {
  const [picking, setPicking] = useState(false);
  if (picking || count === 0)
    return (
      <KindPicker
        first={count === 0}
        onPick={(kind) => {
          onAdd(kind);
          setPicking(false);
        }}
        onCancel={count > 0 ? () => setPicking(false) : undefined}
      />
    );
  return (
    <Button variant="outline" onClick={() => setPicking(true)} className="justify-self-start">
      <PlusIcon />
      Add another target
    </Button>
  );
}

function KindPicker({
  first,
  onPick,
  onCancel,
}: {
  first: boolean;
  onPick: (kind: TargetKind) => void;
  onCancel: (() => void) | undefined;
}) {
  const section = (title: string, kinds: ReadonlyArray<TargetKind>) => (
    <section className="grid gap-2" aria-label={title}>
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {kinds.map((kind) => {
          const Icon = ICONS[kind];
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onPick(kind)}
              className="flex cursor-pointer items-start gap-3 rounded-xl border bg-background p-3 text-left outline-none transition-colors hover:border-primary/40 hover:bg-primary/4 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                <Icon className="size-4" />
              </span>
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">{KIND_INFO[kind].label}</span>
                <span className="text-xs text-muted-foreground">{KIND_INFO[kind].description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
  return (
    <div className="grid gap-4 rounded-xl border border-dashed p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {first ? "What should this category do?" : "Add another target"}
        </p>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      {section(
        "Most used",
        TARGET_KINDS.filter((kind) => KIND_INFO[kind].common),
      )}
      {section(
        "More ways",
        TARGET_KINDS.filter((kind) => !KIND_INFO[kind].common),
      )}
    </div>
  );
}

function TargetCard({
  index,
  target,
  sentence,
  problem,
  amount,
  context,
  onChange,
  onRemove,
}: {
  index: number;
  target: Target;
  sentence: string;
  problem: string | null;
  amount: number | null;
  context: EditorContext;
  onChange: (target: Target) => void;
  onRemove: () => void;
}) {
  const { format } = useBook();
  const kind = kindOf(target);
  const Icon = ICONS[kind];
  return (
    <section
      aria-label={`Target ${index + 1}`}
      className={cn(
        "grid gap-3 rounded-xl border bg-background p-3",
        problem && "border-destructive/40",
      )}
    >
      <header className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon className="size-4" />
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-xs text-muted-foreground">{KIND_INFO[kind].label}</span>
          <span className="text-sm font-medium">{sentence}</span>
        </div>
        {amount !== null && kind !== "goal" && (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">
            {format(amount)}
          </span>
        )}
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Remove target ${index + 1}`}
          onClick={onRemove}
        >
          <Trash2Icon />
        </Button>
      </header>
      <TargetFields target={target} onChange={onChange} context={context} />
      {problem && <p className="text-sm text-destructive-foreground">{problem}</p>}
      {isPrioritized(target) && "priority" in target && (
        <Collapsible>
          <CollapsibleTrigger className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronDownIcon className="size-3.5" />
            More options
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <CountField
              className="pt-3"
              label="Priority"
              min={0}
              value={target.priority}
              onChange={(priority) => onChange({ ...target, priority })}
              description="When there isn't enough money for every target, lower numbers get money first. 0 comes first."
            />
          </CollapsiblePanel>
        </Collapsible>
      )}
    </section>
  );
}

function PreviewLine({
  month,
  ready,
  loading,
  budgeted,
  problems,
}: {
  month: string;
  ready: boolean;
  loading: boolean;
  budgeted: number | null;
  problems: ReadonlyArray<string>;
}) {
  const { format } = useBook();
  let text: ReactNode;
  if (!ready) text = "Fix the targets above to see what they budget.";
  else if (problems.length > 0) text = problems.join(" ");
  else if (budgeted === null) text = "Working it out…";
  else
    text = (
      <>
        In {monthLabel(month)} this budgets{" "}
        <span className="font-medium text-foreground tabular-nums">{format(budgeted)}</span>.
      </>
    );
  return (
    <p
      className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground"
      aria-live="polite"
    >
      {loading && <Spinner className="size-3.5" />}
      <span>{text}</span>
    </p>
  );
}

function LeftoverSection({
  form,
  onChange,
  category,
  groups,
}: {
  form: LeftoverForm;
  onChange: (form: LeftoverForm) => void;
  category: Category;
  groups: ReadonlyArray<CategoryGroup>;
}) {
  const { choice } = form;
  return (
    <section className="grid gap-3 border-t pt-4" aria-label="At the end of the month">
      <div className="grid gap-0.5">
        <h3 className="text-sm font-medium">At the end of the month</h3>
        <p className="text-xs text-muted-foreground">
          What happens to money left in {category.name} when you run end-of-month cleanup.
        </p>
      </div>
      <Choices
        label="Leftover money"
        value={choice.kind}
        onChange={(kind) =>
          onChange({
            ...form,
            choice:
              kind === "send"
                ? { kind, to: null }
                : kind === "pool-give"
                  ? { kind, pool: "" }
                  : { kind },
          })
        }
        options={[
          { value: "keep", label: "Stays in this category" },
          { value: "give-back", label: "Goes back to To Budget" },
          {
            value: "send",
            label: "Moves to another category",
            children: choice.kind === "send" && (
              <Field>
                <FieldLabel>Send it to</FieldLabel>
                <CategorySelect
                  groups={groups}
                  value={choice.to}
                  exclude={category.id}
                  onChange={(to) => onChange({ ...form, choice: { kind: "send", to } })}
                />
              </Field>
            ),
          },
          {
            value: "pool-give",
            label: "Goes into a shared pool",
            children: choice.kind === "pool-give" && (
              <PoolName
                value={choice.pool}
                onChange={(pool) => onChange({ ...form, choice: { kind: "pool-give", pool } })}
              />
            ),
          },
        ]}
      />
      <SwitchRow
        label="Collect money other categories give back"
        description="After cleanup, what is back in To Budget is shared out among the categories that collect it."
        checked={form.collect !== null}
        onChange={(on) => onChange({ ...form, collect: on ? 1 : null })}
      />
      {form.collect !== null && (
        <CountField
          label="Share"
          value={form.collect}
          onChange={(collect) => onChange({ ...form, collect })}
          description="A bigger share gets more of it."
        />
      )}
      <Collapsible defaultOpen={form.pools.length > 0}>
        <CollapsibleTrigger className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronDownIcon className="size-3.5" />
          Shared pools ({form.pools.length})
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="grid gap-2 pt-3">
            <p className="text-xs text-muted-foreground">
              A pool is a name that several categories share: some put their leftovers in, others
              take from it or have their overspending covered by it.
            </p>
            {form.pools.map((rule) => (
              <div
                key={rule.key}
                className="grid items-end gap-2 rounded-lg border bg-background p-2.5 sm:grid-cols-[1fr_1fr_auto]"
              >
                <div className="grid gap-2">
                  <span className="text-sm font-medium">This category</span>
                  <ChoiceSelect
                    label="What this category does with the pool"
                    items={[
                      { value: "pool-receive", label: "Takes money from" },
                      { value: "pool-cover", label: "Has overspending covered by" },
                    ]}
                    value={rule.kind}
                    onChange={(kind) =>
                      onChange({
                        ...form,
                        pools: form.pools.map((other) =>
                          other.key !== rule.key
                            ? other
                            : kind === "pool-receive"
                              ? { kind, pool: rule.pool, weight: 1, key: rule.key }
                              : { kind, pool: rule.pool, key: rule.key },
                        ),
                      })
                    }
                  />
                </div>
                <PoolName
                  value={rule.pool}
                  hint={
                    rule.pool.trim().toLowerCase() === category.name.trim().toLowerCase()
                      ? "Categories that send their leftovers here put them in this pool."
                      : undefined
                  }
                  onChange={(pool) =>
                    onChange({
                      ...form,
                      pools: form.pools.map((other) =>
                        other.key === rule.key ? { ...other, pool } : other,
                      ),
                    })
                  }
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove pool rule"
                  onClick={() =>
                    onChange({
                      ...form,
                      pools: form.pools.filter((other) => other.key !== rule.key),
                    })
                  }
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
            <Button
              variant="ghost"
              className="justify-self-start"
              onClick={() => onChange({ ...form, pools: [...form.pools, newPoolRule()] })}
            >
              <PlusIcon />
              Add a pool rule
            </Button>
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </section>
  );
}

function PoolName({
  value,
  onChange,
  hint,
}: {
  value: string;
  onChange: (pool: string) => void;
  hint?: string | undefined;
}) {
  return (
    <Field>
      <FieldLabel>Pool name</FieldLabel>
      <Input
        value={value}
        placeholder="e.g. Bills"
        aria-invalid={value.trim() === "" || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </Field>
  );
}

function Unreadable({
  lines,
}: {
  lines: ReadonlyArray<{ readonly line: string; readonly error: string }>;
}) {
  return (
    <Alert variant="warning">
      <TriangleAlertIcon />
      <AlertDescription>
        <p>
          Some lines in this category's notes could not be read, so they do nothing. Saving here
          leaves them in the notes as they are.
        </p>
        <Collapsible>
          <CollapsibleTrigger className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronDownIcon className="size-3.5" />
            Show the lines
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <ul className="grid gap-1 pt-2 font-mono text-xs">
              {lines.map((line) => (
                <li key={line.line}>{line.line}</li>
              ))}
            </ul>
          </CollapsiblePanel>
        </Collapsible>
      </AlertDescription>
    </Alert>
  );
}

/** The note lines the saved targets are kept as: read-only, for the curious. */
function SavedLines({ lines }: { lines: ReadonlyArray<string> }) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronDownIcon className="size-3.5" />
        Advanced: how this is stored
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="grid gap-1.5 pt-2">
          <p className="text-xs text-muted-foreground">
            Targets are kept as lines in the category's notes, the way Actual writes them. They
            change only through this dialog.
          </p>
          <pre className="rounded-lg bg-muted/60 p-2.5 font-mono text-xs break-all whitespace-pre-wrap">
            {lines.join("\n")}
          </pre>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
