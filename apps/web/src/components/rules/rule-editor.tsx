import type {
  Rule,
  RuleAction,
  RuleActivity,
  RuleCondition,
  RuleField,
  RuleOp,
  RuleSetField,
  RuleStage,
  SavedRule,
} from "@reeve/contract/catalog";
import type { RegisterRow } from "@reeve/contract";
import { accountLimits, ruleCategory } from "@reeve/contract/rules";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  CalendarClockIcon,
  GlobeIcon,
  LockIcon,
  PlusIcon,
  Settings2Icon,
  WalletIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { ChoiceSelect } from "@/components/choice-select";
import { Money } from "@/components/money";
import { counterpartText } from "@/components/register/entry";
import { Button } from "@reeve/ui/components/button";
import { PaneActions, PaneSection } from "@/components/pane-form";
import { PaneFooter, SplitPanel, usePaneTask } from "@/components/split-panel";
import { Input } from "@reeve/ui/components/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@reeve/ui/components/menu";
import { toastManager } from "@reeve/ui/components/toast";
import { ToggleGroup, ToggleGroupItem } from "@reeve/ui/components/toggle-group";
import { cn } from "@reeve/ui/lib/utils";
import { scopeInput, scopePhrase, useAccountScope } from "@/lib/account-scope";
import { bookQuery, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { draftKey } from "@/lib/draft-key";
import {
  actionClause,
  conditionClause,
  reachText,
  ruleWithConditions,
  scheduleConditions,
  STAGES,
  unfilledCondition,
} from "@/lib/rules";
import {
  CONDITION_FIELDS,
  emptyValue,
  kindOf,
  newAction,
  newCondition,
  OP_LABELS,
  opsFor,
  SET_FIELDS,
  type Names,
} from "./rule-model";
import { ValueInput, type Option } from "./value-input";

export interface Choices {
  readonly accounts: ReadonlyArray<Option>;
  readonly categories: ReadonlyArray<Option>;
  readonly groups: ReadonlyArray<Option>;
  readonly payees: ReadonlyArray<Option>;
}

const optionsFor = (field: string, choices: Choices) =>
  field === "account" || field === "transfer_account"
    ? choices.accounts
    : field === "category"
      ? choices.categories
      : field === "category_group"
        ? choices.groups
        : field === "payee"
          ? choices.payees
          : [];

const ACTION_OPS = [
  { value: "set", label: "Set" },
  { value: "prepend-notes", label: "Prepend to notes" },
  { value: "append-notes", label: "Append to notes" },
  { value: "delete-transaction", label: "Delete transaction" },
] as const;

const transactions = (count: number, adjective = "") =>
  `${count} ${adjective === "" ? "" : `${adjective} `}${count === 1 ? "transaction" : "transactions"}`;

const PREVIEWED = 6;

const NOTHING_OWNED: ReadonlySet<RuleCondition> = new Set();

/** How many existing transactions the conditions match. */
const matchingText = (total: number) =>
  total === 0
    ? "No existing transaction matches."
    : `${transactions(total, "existing")} ${total === 1 ? "matches" : "match"}.`;

/** What saving does to the ones it matches: nothing beyond setting a new category. */
const savingText = (
  total: number | undefined,
  recategorizes: number | undefined,
  category: string,
) => {
  if (total === undefined || recategorizes === undefined || recategorizes === 0) return null;
  return recategorizes === total
    ? `Saving will set ${category} on ${transactions(total, "existing")}.`
    : `Saving will set ${category} on ${recategorizes} of them.`;
};

/** Actual's rule editor as a sentence: if these hold, then do those, beside what that matches. */
export function RuleEditor({
  rule,
  open,
  onOpenChange,
  choices,
  names,
  rules = [],
  schedule = null,
}: {
  /** The rule to edit, or a draft for a new one (without an id). */
  rule: Partial<Rule> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  choices: Choices;
  names: Names;
  /** The book's rules, to mention one with the same conditions. */
  rules?: ReadonlyArray<Rule>;
  /** The schedule the rule belongs to, whose payee, account, amount and date stay its own. */
  schedule?: RuleActivity["schedule"];
}) {
  if (!open || rule === null) return null;
  return (
    <SplitPanel
      title={rule.id === undefined ? "New rule" : "Edit rule"}
      onClose={() => onOpenChange(false)}
    >
      <Form
        key={rule.id ?? draftKey(rule)}
        rule={rule}
        choices={choices}
        names={names}
        rules={rules}
        schedule={schedule}
        onDone={() => onOpenChange(false)}
      />
    </SplitPanel>
  );
}

/** A condition or action with a client-side id, so rows keep their identity as others are removed. */
interface Keyed<T> {
  readonly id: number;
  readonly value: T;
}

let nextId = 0;
const keyed = <T,>(value: T): Keyed<T> => ({ id: nextId++, value });

function StagePicker({
  stage,
  onChange,
}: {
  stage: RuleStage;
  onChange: (stage: RuleStage) => void;
}) {
  const about = STAGES.find((each) => each.value === stage)?.about;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
      <ToggleGroup
        aria-label="Stage"
        value={[stage]}
        onValueChange={(next) => {
          const picked = STAGES.find((each) => each.value === next[0]);
          if (picked) onChange(picked.value);
        }}
        className="rounded-md bg-muted p-0.5"
      >
        {STAGES.map((each) => (
          <ToggleGroupItem
            key={each.value}
            value={each.value}
            className="h-7 min-w-7 px-2.5 sm:h-7 sm:min-w-7 data-pressed:bg-background data-pressed:shadow-xs"
          >
            {each.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <span className="text-xs text-muted-foreground">{about}</span>
    </div>
  );
}

/** How many of the book's matches are on the accounts shown. */
function ScopedCount({
  total,
  count,
  where,
}: {
  total: number;
  count: number | undefined;
  where: string;
}) {
  if (count === undefined) return null;
  return (
    <p className="text-muted-foreground">
      {count === total ? `All on ${where}.` : `${count} of them on ${where}.`}
    </p>
  );
}

/** The conditions' matches, live, with what saving would do to them. */
function MatchPreview({
  rows,
  total,
  error,
  saving,
  deletes,
  similar,
  hint,
  scoped,
}: {
  rows: ReadonlyArray<RegisterRow>;
  total: number | undefined;
  /** How many of them the accounts shown hold, under a scope. */
  scoped: { readonly count: number | undefined; readonly where: string } | null;
  error: string | null;
  saving: string | null;
  deletes: boolean;
  similar: boolean;
  hint: string | null;
}) {
  const { formatDay } = useBook();
  return (
    <aside
      aria-label="What this rule matches"
      aria-live="polite"
      className="grid content-start gap-2"
    >
      <div className="grid gap-1 text-[13px]">
        {error !== null ? (
          <p className="text-muted-foreground">{error}</p>
        ) : (
          total !== undefined && <p>{matchingText(total)}</p>
        )}
        {scoped !== null && total !== undefined && total > 0 && (
          <ScopedCount total={total} {...scoped} />
        )}
        {hint !== null && <p className="text-xs text-muted-foreground">{hint}</p>}
        {saving !== null && <p className="font-medium">{saving}</p>}
        {deletes && total !== undefined && total > 0 && (
          <p className="text-destructive-foreground">
            Save and apply would delete {transactions(total)}.
          </p>
        )}
        {similar && (
          <p className="text-warning-foreground">Another rule has these same conditions.</p>
        )}
      </div>
      {rows.length > 0 && (
        <ul className="grid text-xs">
          {rows.slice(0, PREVIEWED).map((row) => (
            <li key={row.postingId} className="grid gap-px border-t py-1.5">
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {row.payee ?? "No payee"}
                </span>
                <Money amount={row.amount} />
              </span>
              <span className="truncate text-muted-foreground">
                {formatDay(row.date)}, {counterpartText(row) ?? "uncategorized"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-auto border-t pt-2 text-xs text-muted-foreground">
        A rule changes new and imported transactions. Existing ones change only as said here, or
        with Save and apply.
      </p>
    </aside>
  );
}

/** The category saving would newly set on what the rule matches, as a new or changed one does. */
const newCategory = (rule: Partial<Rule>, actions: ReadonlyArray<RuleAction>) => {
  const category = ruleCategory(actions);
  const previous = rule.id === undefined ? null : ruleCategory(rule.actions ?? []);
  return category !== null && category !== previous ? category : null;
};

const ownedConditions = (rule: Partial<Rule>, schedule: RuleActivity["schedule"]) =>
  schedule === null ? NOTHING_OWNED : scheduleConditions(rule.conditions ?? []);

/** What the conditions match now; `total` counts transactions, not a transfer's two sides. */
const useRulePreview = (
  conditions: ReadonlyArray<RuleCondition>,
  conditionsOp: "and" | "or",
  category: string | null,
) => {
  const { id: book } = useBook();
  const preview = useQuery({
    ...bookQuery(book, "preview_rule", {
      conditionsOp,
      conditions: [...conditions],
      limit: PREVIEWED,
      ...(category === null ? {} : { category }),
    }),
    placeholderData: keepPreviousData,
    enabled: conditions.length > 0,
  });
  const scope = useAccountScope();
  const here = useQuery({
    ...bookQuery(book, "preview_rule", {
      ...scopeInput(scope),
      conditionsOp,
      conditions: [...conditions],
      limit: 0,
    }),
    placeholderData: keepPreviousData,
    enabled: conditions.length > 0 && scope !== "all",
  });
  if (conditions.length === 0)
    return { rows: [], total: 0, here: undefined, recategorizes: undefined, error: null };
  return {
    here: here.data?.transactions,
    rows: preview.data?.rows ?? [],
    total: preview.data?.transactions,
    recategorizes: preview.data?.recategorizes,
    error: preview.isError ? preview.error.message : null,
  };
};

/** Saves the rule, then applies it or says what saving recategorized, then closes. */
/** Saves the rule, rejecting with what went wrong; the apply that may follow toasts its own outcome. */
const useSaveRule = (ruleId: string | undefined, categoryName: string) => {
  const { id: book } = useBook();
  const create = useBookMutation(book, "create_rule", { quiet: true });
  const update = useBookMutation(book, "update_rule", { quiet: true });
  const apply = useBookMutation(book, "apply_rules");
  return async (shape: Omit<Rule, "id">, andApply: boolean) => {
    // Applying every action sets the category too, so it needs no recategorizing of its own.
    const body = { ...shape, recategorize: !andApply };
    const saved: SavedRule =
      ruleId === undefined
        ? await create.mutateAsync(body)
        : await update.mutateAsync({ id: ruleId, ...body });
    // The pane closes before the apply lands, so it reports by toast.
    if (andApply)
      apply
        .mutateAsync({ rule: saved.id })
        .then(({ updated, deleted }) =>
          toastManager.add({
            type: "success",
            title: `Applied the rule to ${transactions(updated.length + deleted.length)}`,
          }),
        )
        .catch(() => {
          // The mutation shows its error.
        });
    else if (saved.recategorized.length > 0)
      toastManager.add({
        type: "success",
        title: `Set ${categoryName} on ${transactions(saved.recategorized.length)}`,
      });
  };
};

function ScheduleNotice({ schedule }: { schedule: NonNullable<RuleActivity["schedule"]> }) {
  return (
    <p className="flex items-start gap-2 rounded-md bg-muted px-2.5 py-1.5 text-[13px]">
      <CalendarClockIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <span>
        This rule belongs to the schedule {schedule.name ?? "without a name"}. Its payee, account,
        amount and date stay as the schedule sets them;{" "}
        <Link to="/schedules" className="underline">
          change them on Schedules
        </Link>
        . You can add conditions and actions here.
      </span>
    </p>
  );
}

/** The accounts the rule acts on, which its conditions decide and the accounts shown never do. */
function Reach({
  conditions,
  conditionsOp,
  names,
}: {
  conditions: ReadonlyArray<RuleCondition>;
  conditionsOp: "and" | "or";
  names: Names;
}) {
  const { format } = useBook();
  const limited = accountLimits({ conditions, conditionsOp }).length > 0;
  const Icon = limited ? WalletIcon : GlobeIcon;
  return (
    <p className="flex items-start gap-2 text-xs text-muted-foreground">
      <Icon aria-hidden className="mt-px size-3.5 shrink-0" />
      {reachText({ conditions: [...conditions], conditionsOp }, names, format)}
    </p>
  );
}

function ConditionsSection({
  items,
  onItems,
  conditionsOp,
  onConditionsOp,
  owned,
  showOp,
  choices,
  names,
}: {
  items: ReadonlyArray<Keyed<RuleCondition>>;
  onItems: (items: Array<Keyed<RuleCondition>>) => void;
  conditionsOp: "and" | "or";
  onConditionsOp: (op: "and" | "or") => void;
  owned: ReadonlySet<RuleCondition>;
  showOp: boolean;
  choices: Choices;
  names: Names;
}) {
  return (
    <section aria-label="Conditions" className="grid gap-2">
      {showOp && (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          Match
          <ChoiceSelect
            items={[
              { value: "and", label: "all" },
              { value: "or", label: "any" },
            ]}
            label="Match"
            value={conditionsOp}
            onChange={onConditionsOp}
            className="w-20 min-w-0"
          />
          of these
        </div>
      )}
      {items.map(({ id, value }, index) => (
        <ConditionRow
          key={id}
          word={index === 0 ? "If" : conditionsOp}
          condition={value}
          choices={choices}
          names={names}
          locked={owned.has(value)}
          onChange={(change) =>
            onItems(
              items.map((each) =>
                each.id === id ? { id, value: { ...each.value, ...change } } : each,
              ),
            )
          }
          onRemove={() => onItems(items.filter((each) => each.id !== id))}
        />
      ))}
      <Button
        variant="ghost"
        className="justify-self-start"
        onClick={() => onItems([...items, keyed(newCondition())])}
      >
        <PlusIcon />
        Add condition
      </Button>
    </section>
  );
}

function ActionsSection({
  items,
  onItems,
  scheduled,
  choices,
  names,
}: {
  items: ReadonlyArray<Keyed<RuleAction>>;
  onItems: (items: Array<Keyed<RuleAction>>) => void;
  scheduled: boolean;
  choices: Choices;
  names: Names;
}) {
  return (
    <section aria-label="Actions" className="grid gap-2">
      {items.map(({ id, value }, index) => (
        <ActionRow
          key={id}
          word={index === 0 ? "then" : "and"}
          action={value}
          choices={choices}
          names={names}
          locked={scheduled && value.op === "link-schedule"}
          onChange={(next) =>
            onItems(items.map((each) => (each.id === id ? { id, value: next } : each)))
          }
          onRemove={() => onItems(items.filter((each) => each.id !== id))}
        />
      ))}
      <Button
        variant="ghost"
        className="justify-self-start"
        onClick={() => onItems([...items, keyed(newAction())])}
      >
        <PlusIcon />
        Add action
      </Button>
    </section>
  );
}

/** Applying a rule that deletes asks again, for the number showing now. */
function SaveButtons({
  disabled,
  saving,
  applying,
  deleting,
  onSave,
  onCancel,
}: {
  disabled: boolean;
  saving: boolean;
  /** The save in flight also applies, so its button shows the wait. */
  applying: boolean;
  /** How many transactions applying would delete; zero when it deletes none. */
  deleting: number;
  onSave: (andApply: boolean) => void;
  onCancel: () => void;
}) {
  const [confirmedFor, setConfirmedFor] = useState<number | null>(null);
  const confirming = deleting > 0 && confirmedFor === deleting;
  return (
    <PaneActions>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button
        variant={confirming ? "destructive" : "outline"}
        disabled={disabled}
        loading={saving && applying}
        onClick={() => {
          if (deleting > 0 && !confirming) setConfirmedFor(deleting);
          else onSave(true);
        }}
        title="Save, then apply all its actions, not just the category, to every transaction it matches"
      >
        {confirming ? `Delete ${transactions(deleting)}` : "Save and apply"}
      </Button>
      <Button disabled={disabled} loading={saving && !applying} onClick={() => onSave(false)}>
        Save rule
      </Button>
    </PaneActions>
  );
}

function Form({
  rule,
  choices,
  names,
  rules,
  schedule,
  onDone,
}: {
  rule: Partial<Rule>;
  choices: Choices;
  names: Names;
  rules: ReadonlyArray<Rule>;
  schedule: RuleActivity["schedule"];
  onDone: () => void;
}) {
  const [stage, setStage] = useState<RuleStage>(rule.stage ?? "default");
  const [conditionsOp, setConditionsOp] = useState<"and" | "or">(rule.conditionsOp ?? "and");
  const [keyedConditions, setConditions] = useState(() =>
    (rule.conditions ?? [newCondition()]).map(keyed),
  );
  const [keyedActions, setActions] = useState(() => (rule.actions ?? [newAction()]).map(keyed));
  const conditions = keyedConditions.map((each) => each.value);
  const actions = keyedActions.map((each) => each.value);

  const recategorizing = newCategory(rule, actions);
  const categoryName =
    choices.categories.find((option) => option.value === recategorizing)?.label ?? "the category";
  const save = useSaveRule(rule.id, categoryName);
  const shape = { stage, conditionsOp, conditions, actions };
  const [initial] = useState(() => JSON.stringify(shape));
  const task = usePaneTask({
    dirty: JSON.stringify(shape) !== initial,
    save: () => save(shape, false),
    done: onDone,
  });
  const preview = useRulePreview(conditions, conditionsOp, recategorizing);
  const scope = useAccountScope();
  const where = scopePhrase(
    scope,
    choices.accounts.find((option) => option.value === scope)?.label,
  );
  const deletes = actions.some((action) => action.op === "delete-transaction");
  const [applying, setApplying] = useState(false);

  return (
    <div className="grid gap-6">
      <PaneSection title="Stage">
        <StagePicker stage={stage} onChange={setStage} />
        {schedule !== null && <ScheduleNotice schedule={schedule} />}
      </PaneSection>
      <PaneSection title="When">
        <ConditionsSection
          items={keyedConditions}
          onItems={setConditions}
          conditionsOp={conditionsOp}
          onConditionsOp={setConditionsOp}
          owned={ownedConditions(rule, schedule)}
          showOp={schedule === null && keyedConditions.length > 1}
          choices={choices}
          names={names}
        />
        <Reach conditions={conditions} conditionsOp={conditionsOp} names={names} />
      </PaneSection>
      <PaneSection title="Then">
        <ActionsSection
          items={keyedActions}
          onItems={setActions}
          scheduled={schedule !== null}
          choices={choices}
          names={names}
        />
      </PaneSection>
      <PaneSection title="Matches">
        <MatchPreview
          rows={preview.rows}
          total={preview.total}
          error={preview.error}
          saving={savingText(preview.total, preview.recategorizes, categoryName)}
          deletes={deletes}
          similar={ruleWithConditions(rules, conditions, conditionsOp, rule.id) !== undefined}
          hint={unfilledCondition(conditions)}
          scoped={scope === "all" ? null : { count: preview.here, where }}
        />
      </PaneSection>
      <PaneFooter>
        <SaveButtons
          onCancel={task.cancel}
          disabled={actions.length === 0}
          saving={task.saving}
          deleting={deletes ? (preview.total ?? 0) : 0}
          onSave={(andApply) => {
            setApplying(andApply);
            task.submit(() => save(shape, andApply));
          }}
          applying={applying}
        />
      </PaneFooter>
    </div>
  );
}

const FIELD_ITEMS = [
  ...CONDITION_FIELDS.map((each) => ({ value: each.field, label: each.label })),
  { value: "payee_name" as const, label: "Payee name" },
];
const SET_FIELD_ITEMS = SET_FIELDS.map((each) => ({ value: each.field, label: each.label }));

const ROW =
  "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_3.25rem] items-center gap-2 [&>:first-child]:col-span-3";

const VALUE = "col-span-2 grid min-w-0";

const WORD = "text-left text-[13px] text-muted-foreground";

const RowEnd = ({ children }: { children: React.ReactNode }) => (
  <span className="flex items-center justify-end gap-0.5">{children}</span>
);

function ConditionRow({
  word,
  condition,
  choices,
  names,
  locked,
  onChange,
  onRemove,
}: {
  word: string;
  condition: RuleCondition;
  choices: Choices;
  names: Names;
  locked: boolean;
  onChange: (change: Partial<RuleCondition>) => void;
  onRemove: () => void;
}) {
  const { format } = useBook();
  if (locked) {
    const { lead, value } = conditionClause(condition, names, format);
    return (
      <div className="grid grid-cols-[2rem_minmax(0,1fr)_3.25rem] items-center gap-2 max-md:grid-cols-[minmax(0,1fr)_auto]">
        <span className={cn(WORD, "max-md:hidden")}>{word}</span>
        <span className="flex h-8 min-w-0 items-center gap-1 truncate rounded-lg bg-muted/60 px-2 text-[13px] text-muted-foreground">
          {lead} <span className="truncate text-foreground">{value}</span>
        </span>
        <span title="Set by the schedule" className="flex justify-end pe-1 text-muted-foreground">
          <LockIcon aria-label="Set by the schedule" className="size-3.5" />
        </span>
      </div>
    );
  }
  const ops = opsFor(condition.field);
  return (
    <div className={ROW}>
      <span className={WORD}>{word}</span>
      <ChoiceSelect
        items={FIELD_ITEMS}
        label="Condition field"
        value={condition.field}
        onChange={(field: RuleField) => {
          const op = new Set(opsFor(field)).has(condition.op) ? condition.op : "is";
          onChange({ field, op, value: emptyValue(kindOf(field), op) });
        }}
      />
      <ChoiceSelect
        items={ops.map((op) => ({ value: op, label: OP_LABELS[op] }))}
        label="Condition operator"
        value={condition.op}
        onChange={(op: RuleOp) => onChange({ op, value: emptyValue(kindOf(condition.field), op) })}
      />
      <div className={VALUE}>
        <ValueInput
          key={`${condition.field}:${condition.op}`}
          field={condition.field}
          op={condition.op}
          value={condition.value}
          onChange={(value) => onChange({ value })}
          options={optionsFor(condition.field, choices)}
        />
      </div>
      <RowEnd>
        <Button size="icon" variant="ghost" aria-label="Remove condition" onClick={onRemove}>
          <XIcon />
        </Button>
      </RowEnd>
    </div>
  );
}

function ActionRow({
  word,
  action,
  choices,
  names,
  locked,
  onChange,
  onRemove,
}: {
  word: string;
  action: RuleAction;
  choices: Choices;
  names: Names;
  locked: boolean;
  onChange: (action: RuleAction) => void;
  onRemove: () => void;
}) {
  const { format } = useBook();
  const remove = (
    <Button size="icon" variant="ghost" aria-label="Remove action" onClick={onRemove}>
      <XIcon />
    </Button>
  );
  if (action.op === "set-split-amount" || action.op === "link-schedule") {
    const { lead, value } = actionClause(action, names, format);
    return (
      <div className="grid grid-cols-[2rem_minmax(0,1fr)_3.25rem] items-center gap-2 max-md:grid-cols-[minmax(0,1fr)_auto]">
        <span className={cn(WORD, "max-md:hidden")}>{word}</span>
        <span className="flex h-8 min-w-0 items-center gap-1 truncate rounded-lg bg-muted/60 px-2 text-[13px] text-muted-foreground">
          {lead} <span className="truncate text-foreground">{value}</span>
        </span>
        <RowEnd>
          {locked ? (
            <span title="Set by the schedule" className="pe-1 text-muted-foreground">
              <LockIcon aria-label="Set by the schedule" className="size-3.5" />
            </span>
          ) : (
            remove
          )}
        </RowEnd>
      </div>
    );
  }
  return (
    <div className={ROW}>
      <span className={WORD}>{word}</span>
      <ChoiceSelect
        items={ACTION_OPS}
        label="Action"
        value={action.op}
        onChange={(op) =>
          onChange(
            op === "set" ? newAction() : op === "delete-transaction" ? { op } : { op, value: "" },
          )
        }
      />
      <ActionValue action={action} choices={choices} onChange={onChange} />
      <RowEnd>
        {action.op === "set" && <ValueMode action={action} onChange={onChange} />}
        {remove}
      </RowEnd>
    </div>
  );
}

const without = (action: Extract<RuleAction, { op: "set" }>) => {
  const { template: _template, formula: _formula, ...rest } = action;
  return rest;
};

/** Whether a set action gives a plain value, a Handlebars template or a formula. */
function ValueMode({
  action,
  onChange,
}: {
  action: Extract<RuleAction, { op: "set" }>;
  onChange: (action: RuleAction) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={<Button size="icon" variant="ghost" aria-label="Value, template or formula" />}
      >
        <Settings2Icon />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuItem onClick={() => onChange(without(action))}>Use a value</MenuItem>
        <MenuItem onClick={() => onChange({ ...without(action), template: action.template ?? "" })}>
          Use a template
        </MenuItem>
        <MenuItem onClick={() => onChange({ ...without(action), formula: action.formula ?? "=" })}>
          Use a formula
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

/** The two cells after an action's operator: a set action's field and value, or the notes text. */
function ActionValue({
  action,
  choices,
  onChange,
}: {
  action: Extract<
    RuleAction,
    { op: "set" | "prepend-notes" | "append-notes" | "delete-transaction" }
  >;
  choices: Choices;
  onChange: (action: RuleAction) => void;
}) {
  if (action.op === "delete-transaction") return <span className="col-span-2 max-md:hidden" />;
  if (action.op !== "set")
    return (
      <Input
        aria-label="Text"
        className="col-span-2 max-md:col-span-1"
        value={action.value}
        onChange={(event) => onChange({ ...action, value: event.target.value })}
      />
    );
  const splitIndex = action.splitIndex === undefined ? {} : { splitIndex: action.splitIndex };
  return (
    <>
      <ChoiceSelect
        items={SET_FIELD_ITEMS}
        label="Action field"
        value={action.field}
        onChange={(field: RuleSetField) =>
          onChange({ op: "set", field, value: emptyValue(kindOf(field), "is"), ...splitIndex })
        }
      />
      <div className={VALUE}>
        {action.template !== undefined ? (
          <Input
            aria-label="Template"
            placeholder="{{notes}}"
            value={action.template}
            onChange={(event) => onChange({ ...action, template: event.target.value })}
          />
        ) : action.formula !== undefined ? (
          <Input
            aria-label="Formula"
            placeholder="=amount / 2"
            className="tabular-nums"
            value={action.formula}
            onChange={(event) => onChange({ ...action, formula: event.target.value })}
          />
        ) : (
          <ValueInput
            key={action.field}
            field={action.field}
            op="is"
            label="New value"
            value={action.value}
            onChange={(value) => onChange({ ...action, value })}
            options={optionsFor(action.field, choices)}
          />
        )}
      </div>
    </>
  );
}
