import {
  ALLOCATION_PRESETS,
  createMonteCarloContribution,
  createMonteCarloIncomeStream,
  createMonteCarloPot,
  createMonteCarloSpendingPhase,
  createMonteCarloSurplusPot,
  createMonteCarloTaxBand,
  getAllocationChange,
  getMonteCarloPotLabel,
  isMixIncomplete,
  MAX_HISTORICAL_BLOCK_LENGTH,
  MAX_SIMULATION_COUNT,
  MIN_HISTORICAL_BLOCK_LENGTH,
  MIN_SIMULATION_COUNT,
  MONTE_CARLO_DEFAULTS,
  sortMonteCarloSpendingPhases,
  type MonteCarloAllocationPreset,
  type MonteCarloConfig,
  type MonteCarloPot,
  type MonteCarloReturnModel,
  type MonteCarloWithdrawalRuleConfig,
  type MonteCarloWithdrawalRuleType,
  type MonteCarloWithdrawalStrategy,
} from "@reeve/contract/monte-carlo";
import { PlusIcon, XIcon } from "lucide-react";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { AmountInput } from "@/components/amount-input";
import { Button } from "@reeve/ui/components/button";
import { Checkbox } from "@reeve/ui/components/checkbox";
import { Input } from "@reeve/ui/components/input";
import { ScrollArea } from "@reeve/ui/components/scroll-area";
import { cn } from "@reeve/ui/lib/utils";
import { Choice, Segmented } from "../controls";
import { interpolate } from "./charts";

type Change = (changes: Partial<MonteCarloConfig>) => void;
type Tab = "plan" | "pots" | "income" | "contributions" | "withdrawals" | "tax";

const TABS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: "plan", label: "Plan details" },
  { value: "pots", label: "Investment pots" },
  { value: "income", label: "Income" },
  { value: "contributions", label: "Contributions" },
  { value: "withdrawals", label: "Spending" },
  { value: "tax", label: "Tax" },
];

const TAB_HELP: Record<Tab, string> = {
  plan: "Who this plan is for and how the simulation generates market returns.",
  pots: "The invested accounts your plan draws from - each with its own balance, allocation, and return assumptions. Link a pot to an account to start from its balance.",
  income:
    "Money you receive each year without drawing on your pots, in today's money - a state pension, an annuity, rental or part-time work. It pays for spending first; the pots fund the rest.",
  contributions:
    "Money you add to your pots each year, in today's money - paid from one of your income streams, or from outside the plan.",
  withdrawals:
    "How much you take out each year, and optional rules that adjust it as markets move.",
  tax: "How withdrawals are taxed - your spending is what you keep after tax.",
};

const RETURN_MODELS: ReadonlyArray<{ value: MonteCarloReturnModel; label: string }> = [
  { value: "normal", label: "Random (normal distribution)" },
  { value: "historical-bootstrap", label: "Historical returns, shuffled" },
  { value: "historical-block-bootstrap", label: "Historical returns, in blocks" },
  { value: "historical-sequence", label: "Historical sequences (replay)" },
];

const ALLOCATIONS: ReadonlyArray<{ value: MonteCarloAllocationPreset; label: string }> = [
  { value: "equity-100", label: "100% stocks" },
  { value: "equity-80", label: "80% stocks / 20% bonds" },
  { value: "equity-60", label: "60% stocks / 40% bonds" },
  { value: "equity-40", label: "40% stocks / 60% bonds" },
  { value: "cash", label: "Cash" },
  { value: "custom-mix", label: "Custom mix" },
  { value: "custom", label: "Custom return" },
];

const STRATEGIES: ReadonlyArray<{ value: MonteCarloWithdrawalStrategy; label: string }> = [
  { value: "proportional", label: "Split proportionally across pots" },
  { value: "sequential", label: "Drain pots in order" },
  { value: "best-performer", label: "Spend from the best performer first" },
  { value: "target-mix", label: "Keep pots at their target mix" },
];

const RULES: ReadonlyArray<{ value: MonteCarloWithdrawalRuleType; label: string }> = [
  { value: "none", label: "None (fixed withdrawals)" },
  { value: "guardrails", label: "Guardrails (Guyton-Klinger)" },
  { value: "ratcheting", label: "Ratcheting (Kitces)" },
  { value: "floor-ceiling", label: "Floor & ceiling (Bengen)" },
  { value: "boundaries", label: "Boundaries" },
];

const percent = (value: number) => Math.round(value * 10_000) / 100;

/** A number typed freely and committed on Enter or leaving, clamped; blank is `null` when allowed. */
function NumberField({
  label,
  value,
  onCommit,
  scale = 1,
  min,
  max,
  nullable = false,
  placeholder,
  disabled,
  className,
}: {
  label: string;
  value: number | null;
  onCommit: (value: number | null) => void;
  /** 100 for a fraction typed as a percentage. */
  scale?: number;
  min?: number;
  max?: number;
  nullable?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const shown = value === null ? "" : String(Math.round(value * scale * 100) / 100);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    const text = draft.trim();
    if (text === "") {
      if (nullable) onCommit(null);
      return;
    }
    const typed = Number(text);
    if (!Number.isFinite(typed)) return;
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, typed));
    const next = clamped / scale;
    if (next !== value) onCommit(next);
  };
  return (
    <Input
      inputMode="decimal"
      aria-label={label}
      className={cn("w-20", className)}
      value={draft ?? shown}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setDraft(null);
      }}
    />
  );
}

function TextField({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      aria-label={label}
      className="w-36"
      value={draft ?? value}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== null && draft.trim() !== value) onCommit(draft.trim());
        setDraft(null);
      }}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

function Money({
  label,
  value,
  onCommit,
  disabled,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <AmountInput
      label={label}
      value={value}
      disabled={disabled ?? false}
      onCommit={(amount) => onCommit(Math.max(0, amount))}
      className="h-8 w-32 border-input bg-background"
    />
  );
}

function Check({
  label,
  checked,
  onChange,
  children,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
}) {
  return (
    // oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the checkbox inside is the control.
    <label className="flex items-center gap-2 text-sm">
      <Checkbox aria-label={label} checked={checked} onCheckedChange={onChange} />
      {children ?? label}
    </label>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      <div className="flex flex-wrap items-end gap-4">{children}</div>
    </div>
  );
}

/** A table of editable rows; the header names each column. */
function RowsTable({ columns, children }: { columns: ReadonlyArray<string>; children: ReactNode }) {
  return (
    <ScrollArea className="min-w-0 rounded-lg border">
      <table className="w-full text-[13px]">
        <thead className="bg-muted/60 text-xs text-muted-foreground">
          <tr>
            {columns.map((column, index) => (
              <th
                key={`${column}-${index}`}
                className="h-8 px-2 text-left font-normal whitespace-nowrap"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:px-2 [&_td]:py-1.5 [&_tr]:border-t">{children}</tbody>
      </table>
    </ScrollArea>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button size="icon" variant="ghost" aria-label={label} onClick={onClick}>
      <XIcon />
    </Button>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="outline" className="justify-self-start" onClick={onClick}>
      <PlusIcon />
      {label}
    </Button>
  );
}

const newId = () => crypto.randomUUID();

function PlanTab({ config, onChange }: { config: MonteCarloConfig; onChange: Change }) {
  const keepsSurplus = config.pots.some((pot) => pot.isSurplus);
  const historical = config.returnModel !== "normal";
  const onKeepSurplusChange = (keep: boolean) => {
    if (keep) {
      onChange({ pots: [createMonteCarloSurplusPot(newId()), ...config.pots] });
      return;
    }
    // The surplus pot takes its contributions with it, and the plan always keeps a pot
    const surplusIds = new Set(config.pots.filter((pot) => pot.isSurplus).map((pot) => pot.id));
    const remaining = config.pots.filter((pot) => !pot.isSurplus);
    onChange({
      pots: remaining.length > 0 ? remaining : [createMonteCarloPot(newId())],
      contributions: config.contributions.filter((each) => !surplusIds.has(each.potId)),
    });
  };
  return (
    <div className="grid gap-5">
      <Group title="Your plan">
        <Field label="Your current age">
          <NumberField
            label="Your current age"
            value={config.currentAge}
            min={0}
            max={120}
            onCommit={(value) => value !== null && onChange({ currentAge: Math.round(value) })}
          />
        </Field>
        <Field label="Pot must last until age">
          <NumberField
            label="Pot must last until age"
            value={config.targetAge}
            min={1}
            max={150}
            onCommit={(value) => value !== null && onChange({ targetAge: Math.round(value) })}
          />
        </Field>
      </Group>
      <Group title="Simulation">
        <Field label="Return model">
          <Choice
            label="Return model"
            items={RETURN_MODELS}
            value={config.returnModel}
            onChange={(returnModel) => onChange({ returnModel })}
          />
        </Field>
        <Field label="Simulations">
          <NumberField
            label="Simulations"
            value={config.simulationCount}
            min={MIN_SIMULATION_COUNT}
            max={MAX_SIMULATION_COUNT}
            disabled={config.returnModel === "historical-sequence"}
            onCommit={(value) => value !== null && onChange({ simulationCount: Math.round(value) })}
          />
        </Field>
        {config.returnModel === "historical-block-bootstrap" && (
          <Field label="Block length (years)">
            <NumberField
              label="Block length (years)"
              value={config.historicalBlockLength}
              min={MIN_HISTORICAL_BLOCK_LENGTH}
              max={MAX_HISTORICAL_BLOCK_LENGTH}
              onCommit={(value) =>
                value !== null && onChange({ historicalBlockLength: Math.round(value) })
              }
            />
          </Field>
        )}
      </Group>
      <Group title="Inflation">
        {historical ? (
          // Historical models take each sampled year's actual inflation, so the only choice is on/off
          <Check
            label="Adjust spending with inflation"
            checked={config.inflationMean !== null}
            onChange={(checked) =>
              onChange({ inflationMean: checked ? MONTE_CARLO_DEFAULTS.inflationMean : null })
            }
          />
        ) : (
          <>
            <Field label="Mean (%)">
              <NumberField
                label="Inflation mean (%)"
                value={config.inflationMean}
                scale={100}
                min={-10}
                max={50}
                nullable
                placeholder="None"
                onCommit={(inflationMean) => onChange({ inflationMean })}
              />
            </Field>
            <Field label="Std dev (%)">
              <NumberField
                label="Inflation std dev (%)"
                value={config.inflationStdDev}
                scale={100}
                min={0}
                max={50}
                disabled={config.inflationMean === null}
                onCommit={(value) => onChange({ inflationStdDev: value ?? 0 })}
              />
            </Field>
          </>
        )}
      </Group>
      <Group title="Manage surplus">
        <p className="basis-full text-sm text-muted-foreground">
          Money the plan doesn&apos;t spend - such as income beyond your spending - is saved into a
          Surplus cash pot. Tick the box to treat it as spent and gone instead.
        </p>
        <Check
          label="Assume any unspent money is spent"
          checked={!keepsSurplus}
          onChange={(checked) => onKeepSurplusChange(!checked)}
        />
      </Group>
    </div>
  );
}

function PotsTab({
  config,
  onChange,
  accounts,
}: {
  config: MonteCarloConfig;
  onChange: Change;
  accounts: ReadonlyArray<{ value: string; label: string }>;
}) {
  const historical = config.returnModel !== "normal";
  const flat = config.taxModel === "flat";
  const update = (id: string, changes: Partial<MonteCarloPot>) =>
    onChange({ pots: config.pots.map((pot) => (pot.id === id ? { ...pot, ...changes } : pot)) });
  const accountItems = [{ value: "", label: "Not linked" }, ...accounts];
  return (
    <div className="grid gap-4">
      <RowsTable
        columns={[
          "Pot",
          "Linked account",
          "Starting balance",
          "Allocation",
          historical ? "Mix: stocks / bonds / cash (%)" : "Return / volatility (%)",
          "Access age",
          flat ? "Withdrawal tax (%)" : "Taxable (%)",
          "Fee (%/yr)",
          "",
        ]}
      >
        {config.pots.map((pot, index) => {
          const label = getMonteCarloPotLabel(config.pots, index, interpolate);
          const linked = pot.accountId !== null;
          return (
            <tr key={pot.id}>
              <td>
                {pot.isSurplus ? (
                  <span className="text-muted-foreground">{label}</span>
                ) : (
                  <TextField
                    label="Pot name"
                    value={pot.name}
                    placeholder={label}
                    onCommit={(name) => update(pot.id, { name })}
                  />
                )}
              </td>
              <td>
                {!pot.isSurplus && (
                  <Choice
                    label={`${label} linked account`}
                    items={accountItems}
                    value={pot.accountId ?? ""}
                    onChange={(accountId) =>
                      update(pot.id, { accountId: accountId === "" ? null : accountId })
                    }
                    className="w-40"
                  />
                )}
              </td>
              <td>
                <Money
                  label={`${label} starting balance`}
                  value={pot.startingBalance}
                  disabled={linked || pot.isSurplus}
                  onCommit={(startingBalance) => update(pot.id, { startingBalance })}
                />
              </td>
              <td>
                {!pot.isSurplus && (
                  <Choice
                    label={`${label} allocation`}
                    items={ALLOCATIONS}
                    value={pot.allocationPreset}
                    onChange={(preset) => update(pot.id, getAllocationChange(preset, pot))}
                    className="w-44"
                  />
                )}
              </td>
              <td>
                {!pot.isSurplus &&
                  (historical && pot.allocationPreset === "custom-mix" ? (
                    <span className="flex items-center gap-1">
                      {(["allocationStocks", "allocationBonds", "allocationCash"] as const).map(
                        (key) => (
                          <NumberField
                            key={key}
                            label={`${label} ${key.slice(10).toLowerCase()} share (%)`}
                            value={pot[key]}
                            scale={100}
                            min={0}
                            max={100}
                            className="w-14"
                            onCommit={(value) => update(pot.id, { [key]: value ?? 0 })}
                          />
                        ),
                      )}
                      {isMixIncomplete(pot) && (
                        <span className="text-xs text-destructive-foreground">must total 100%</span>
                      )}
                    </span>
                  ) : historical && pot.allocationPreset !== "custom" ? (
                    <span className="text-muted-foreground">Historical</span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <NumberField
                        label={`${label} expected return (%)`}
                        value={pot.expectedReturnMean}
                        scale={100}
                        min={-50}
                        max={50}
                        className="w-16"
                        onCommit={(value) =>
                          update(pot.id, {
                            expectedReturnMean: value ?? 0,
                            allocationPreset: "custom",
                          })
                        }
                      />
                      <NumberField
                        label={`${label} volatility (%)`}
                        value={pot.returnStdDev}
                        scale={100}
                        min={0}
                        max={100}
                        className="w-16"
                        onCommit={(value) =>
                          update(pot.id, { returnStdDev: value ?? 0, allocationPreset: "custom" })
                        }
                      />
                    </span>
                  ))}
              </td>
              <td>
                {!pot.isSurplus && (
                  <NumberField
                    label={`${label} access age`}
                    value={pot.accessAge}
                    nullable
                    placeholder="Now"
                    min={0}
                    max={150}
                    className="w-16"
                    onCommit={(accessAge) =>
                      update(pot.id, {
                        accessAge: accessAge === null ? null : Math.round(accessAge),
                      })
                    }
                  />
                )}
              </td>
              <td>
                {!pot.isSurplus && (
                  <NumberField
                    label={`${label} ${flat ? "withdrawal tax" : "taxable share"} (%)`}
                    value={flat ? pot.withdrawalTaxRate : pot.taxableFraction}
                    scale={100}
                    min={0}
                    max={flat ? 75 : 100}
                    className="w-16"
                    onCommit={(value) =>
                      update(
                        pot.id,
                        flat ? { withdrawalTaxRate: value ?? 0 } : { taxableFraction: value ?? 0 },
                      )
                    }
                  />
                )}
              </td>
              <td>
                {!pot.isSurplus && (
                  <NumberField
                    label={`${label} annual fee (%)`}
                    value={pot.annualFeeRate}
                    scale={100}
                    min={0}
                    max={10}
                    className="w-16"
                    onCommit={(value) => update(pot.id, { annualFeeRate: value ?? 0 })}
                  />
                )}
              </td>
              <td>
                {!pot.isSurplus && config.pots.filter((each) => !each.isSurplus).length > 1 && (
                  <RemoveButton
                    label={`Remove ${label}`}
                    onClick={() =>
                      onChange({
                        pots: config.pots.filter((each) => each.id !== pot.id),
                        contributions: config.contributions.filter((each) => each.potId !== pot.id),
                      })
                    }
                  />
                )}
              </td>
            </tr>
          );
        })}
      </RowsTable>
      <div className="flex flex-wrap items-end gap-4">
        <AddButton
          label="Add pot"
          onClick={() => onChange({ pots: [...config.pots, createMonteCarloPot(newId())] })}
        />
        <Field label="Withdrawal order">
          <Choice
            label="Withdrawal order"
            items={STRATEGIES}
            value={config.withdrawalStrategy}
            onChange={(withdrawalStrategy) => onChange({ withdrawalStrategy })}
          />
        </Field>
      </div>
      {!historical && (
        <p className="text-xs text-muted-foreground">
          Presets fill in illustrative returns:{" "}
          {Object.entries(ALLOCATION_PRESETS)
            .map(
              ([preset, stats]) =>
                `${ALLOCATIONS.find((each) => each.value === preset)?.label} ${percent(stats.mean)}% ± ${percent(stats.stdDev)}%`,
            )
            .join(", ")}
          .
        </p>
      )}
    </div>
  );
}

const ageRange = (
  label: string,
  row: { fromAge: number | null; toAge: number | null },
  onCommit: (changes: { fromAge?: number | null; toAge?: number | null }) => void,
) => (
  <span className="flex items-center gap-1">
    <NumberField
      label={`${label} from age`}
      value={row.fromAge}
      nullable
      placeholder="Now"
      min={0}
      max={150}
      className="w-16"
      onCommit={(fromAge) => onCommit({ fromAge: fromAge === null ? null : Math.round(fromAge) })}
    />
    <span className="text-muted-foreground">to</span>
    <NumberField
      label={`${label} to age`}
      value={row.toAge}
      nullable
      placeholder="End"
      min={0}
      max={150}
      className="w-16"
      onCommit={(toAge) => onCommit({ toAge: toAge === null ? null : Math.round(toAge) })}
    />
  </span>
);

function IncomeTab({ config, onChange }: { config: MonteCarloConfig; onChange: Change }) {
  const flat = config.taxModel === "flat";
  const update = (id: string, changes: object) =>
    onChange({
      incomeStreams: config.incomeStreams.map((each) =>
        each.id === id ? { ...each, ...changes } : each,
      ),
    });
  return (
    <div className="grid gap-4">
      {config.incomeStreams.length > 0 && (
        <RowsTable
          columns={[
            "Name",
            "Ages",
            "Yearly amount",
            "Adjust by inflation",
            flat ? "Tax rate (%)" : "Taxable (%)",
            "",
          ]}
        >
          {config.incomeStreams.map((stream, index) => {
            const label = stream.name || `Income ${index + 1}`;
            return (
              <tr key={stream.id}>
                <td>
                  <TextField
                    label="Income name"
                    value={stream.name}
                    placeholder={`Income ${index + 1}`}
                    onCommit={(name) => update(stream.id, { name })}
                  />
                </td>
                <td>{ageRange(label, stream, (changes) => update(stream.id, changes))}</td>
                <td>
                  <Money
                    label={`${label} yearly amount`}
                    value={stream.annualAmount}
                    onCommit={(annualAmount) => update(stream.id, { annualAmount })}
                  />
                </td>
                <td>
                  <Checkbox
                    aria-label={`${label} adjusts with inflation`}
                    checked={stream.adjustsWithInflation}
                    onCheckedChange={(adjustsWithInflation) =>
                      update(stream.id, { adjustsWithInflation })
                    }
                  />
                </td>
                <td>
                  <NumberField
                    label={`${label} ${flat ? "tax rate" : "taxable share"} (%)`}
                    value={flat ? stream.taxRate : stream.taxableFraction}
                    scale={100}
                    min={0}
                    max={flat ? 75 : 100}
                    className="w-16"
                    onCommit={(value) =>
                      update(
                        stream.id,
                        flat ? { taxRate: value ?? 0 } : { taxableFraction: value ?? 0 },
                      )
                    }
                  />
                </td>
                <td>
                  <RemoveButton
                    label={`Remove ${label}`}
                    onClick={() =>
                      onChange({
                        incomeStreams: config.incomeStreams.filter((each) => each.id !== stream.id),
                        contributions: config.contributions.map((each) =>
                          each.sourceIncomeStreamId === stream.id
                            ? { ...each, sourceIncomeStreamId: null, beforeTax: false }
                            : each,
                        ),
                      })
                    }
                  />
                </td>
              </tr>
            );
          })}
        </RowsTable>
      )}
      <AddButton
        label="Add income"
        onClick={() =>
          onChange({
            incomeStreams: [...config.incomeStreams, createMonteCarloIncomeStream(newId())],
          })
        }
      />
    </div>
  );
}

function ContributionsTab({ config, onChange }: { config: MonteCarloConfig; onChange: Change }) {
  const update = (id: string, changes: object) =>
    onChange({
      contributions: config.contributions.map((each) =>
        each.id === id ? { ...each, ...changes } : each,
      ),
    });
  const potItems = config.pots.map((pot, index) => ({
    value: pot.id,
    label: getMonteCarloPotLabel(config.pots, index, interpolate),
  }));
  const sourceItems = [
    { value: "", label: "Outside the plan" },
    ...config.incomeStreams.map((stream, index) => ({
      value: stream.id,
      label: stream.name || `Income ${index + 1}`,
    })),
  ];
  const firstPot = config.pots.find((pot) => !pot.isSurplus) ?? config.pots[0];
  return (
    <div className="grid gap-4">
      {config.contributions.length > 0 && (
        <RowsTable
          columns={[
            "Name",
            "Into pot",
            "Ages",
            "Yearly amount",
            "Adjust by inflation",
            "Paid from",
            "Before tax",
            "",
          ]}
        >
          {config.contributions.map((contribution, index) => {
            const label = contribution.name || `Contribution ${index + 1}`;
            return (
              <tr key={contribution.id}>
                <td>
                  <TextField
                    label="Contribution name"
                    value={contribution.name}
                    placeholder={`Contribution ${index + 1}`}
                    onCommit={(name) => update(contribution.id, { name })}
                  />
                </td>
                <td>
                  <Choice
                    label={`${label} pot`}
                    items={potItems}
                    value={contribution.potId}
                    onChange={(potId) => update(contribution.id, { potId })}
                  />
                </td>
                <td>
                  {ageRange(label, contribution, (changes) => update(contribution.id, changes))}
                </td>
                <td>
                  <Money
                    label={`${label} yearly amount`}
                    value={contribution.annualAmount}
                    onCommit={(annualAmount) => update(contribution.id, { annualAmount })}
                  />
                </td>
                <td>
                  <Checkbox
                    aria-label={`${label} adjusts with inflation`}
                    checked={contribution.adjustsWithInflation}
                    onCheckedChange={(adjustsWithInflation) =>
                      update(contribution.id, { adjustsWithInflation })
                    }
                  />
                </td>
                <td>
                  <Choice
                    label={`${label} paid from`}
                    items={sourceItems}
                    value={contribution.sourceIncomeStreamId ?? ""}
                    onChange={(source) =>
                      update(
                        contribution.id,
                        source === ""
                          ? { sourceIncomeStreamId: null, beforeTax: false }
                          : { sourceIncomeStreamId: source },
                      )
                    }
                  />
                </td>
                <td>
                  <Checkbox
                    aria-label={`${label} before tax`}
                    checked={contribution.beforeTax}
                    disabled={contribution.sourceIncomeStreamId === null}
                    onCheckedChange={(beforeTax) => update(contribution.id, { beforeTax })}
                  />
                </td>
                <td>
                  <RemoveButton
                    label={`Remove ${label}`}
                    onClick={() =>
                      onChange({
                        contributions: config.contributions.filter(
                          (each) => each.id !== contribution.id,
                        ),
                      })
                    }
                  />
                </td>
              </tr>
            );
          })}
        </RowsTable>
      )}
      {firstPot && (
        <AddButton
          label="Add contribution"
          onClick={() =>
            onChange({
              contributions: [
                ...config.contributions,
                createMonteCarloContribution(newId(), firstPot.id),
              ],
            })
          }
        />
      )}
    </div>
  );
}

/** The selected withdrawal rule's parameters, as Actual's sentence-style editor lays them out. */
function RuleFields({
  rule,
  onChange,
}: {
  rule: MonteCarloWithdrawalRuleConfig;
  onChange: (changes: Partial<MonteCarloWithdrawalRuleConfig>) => void;
}) {
  const pct = (label: string, key: keyof MonteCarloWithdrawalRuleConfig, max = 100) => (
    <NumberField
      label={label}
      value={rule[key] as number}
      scale={100}
      min={0}
      max={max}
      className="w-16"
      onCommit={(value) => onChange({ [key]: value ?? 0 })}
    />
  );
  const sentence = "flex flex-wrap items-center gap-1.5 text-sm";
  switch (rule.type) {
    case "guardrails":
      return (
        <div className="grid gap-2">
          <p className={sentence}>
            Capital preservation rule: If the withdrawal rate rises more than
            {pct("Capital preservation trigger (%)", "preservationTriggerPct")}% above the planned
            rate, cut withdrawals by {pct("Capital preservation cut (%)", "preservationCutPct")}%.
          </p>
          <p className={sentence}>
            Prosperity rule: If the withdrawal rate falls more than
            {pct("Prosperity trigger (%)", "prosperityTriggerPct")}% below the planned rate, raise
            withdrawals by {pct("Prosperity raise (%)", "prosperityIncreasePct")}%.
          </p>
        </div>
      );
    case "ratcheting":
      return (
        <p className={sentence}>
          If the accessible balance stays above
          <NumberField
            label="Balance threshold multiple"
            value={rule.balanceThresholdMultiple}
            min={1}
            max={10}
            className="w-16"
            onCommit={(value) => onChange({ balanceThresholdMultiple: value ?? 1 })}
          />
          times its starting level for
          <NumberField
            label="Years in a row"
            value={rule.consecutiveYears}
            min={1}
            max={30}
            className="w-16"
            onCommit={(value) => onChange({ consecutiveYears: Math.round(value ?? 1) })}
          />
          years in a row, raise withdrawals by {pct("Ratchet raise (%)", "ratchetIncreasePct")}%.
        </p>
      );
    case "floor-ceiling":
      return (
        <p className={sentence}>
          Each year, withdraw the starting rate&apos;s share of the current accessible balance, but
          never more than
          {pct("Ceiling above planned amount (%)", "ceilingPct")}% above or
          {pct("Floor below planned amount (%)", "floorPct")}% below the planned amount.
        </p>
      );
    case "boundaries":
      return (
        <div className="grid gap-2">
          <p className={sentence}>
            If the withdrawal rate rises above
            {pct("Upper withdrawal rate threshold (%)", "upperRateThreshold")}%, cut withdrawals by
            {pct("Cut when above the upper threshold (%)", "upperCutPct")}%.
          </p>
          <p className={sentence}>
            If the withdrawal rate falls below{" "}
            {pct("Lower withdrawal rate threshold (%)", "lowerRateThreshold")}%, raise withdrawals
            by {pct("Raise when below the lower threshold (%)", "lowerIncreasePct")}%.
          </p>
        </div>
      );
    default:
      return null;
  }
}

function SpendingTab({ config, onChange }: { config: MonteCarloConfig; onChange: Change }) {
  const update = (id: string, changes: object) =>
    onChange({
      spendingPhases: config.spendingPhases.map((each) =>
        each.id === id ? { ...each, ...changes } : each,
      ),
    });
  const sorted = sortMonteCarloSpendingPhases(config.spendingPhases);
  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Spending phases
        </h3>
        <RowsTable columns={["Phase name", "From age", "Until", "Yearly spending", ""]}>
          {config.spendingPhases.map((phase, index) => {
            const next = sorted[sorted.indexOf(phase) + 1];
            const label = phase.name || `Phase ${index + 1}`;
            return (
              <tr key={phase.id}>
                <td>
                  <TextField
                    label="Phase name"
                    value={phase.name}
                    placeholder={`Phase ${index + 1}`}
                    onCommit={(name) => update(phase.id, { name })}
                  />
                </td>
                <td>
                  <NumberField
                    label={`${label} from age`}
                    value={phase.fromAge}
                    nullable
                    placeholder={`Now (${config.currentAge})`}
                    min={0}
                    max={150}
                    className="w-24"
                    onCommit={(fromAge) =>
                      update(phase.id, { fromAge: fromAge === null ? null : Math.round(fromAge) })
                    }
                  />
                </td>
                <td className="text-muted-foreground">
                  {next?.fromAge != null ? `Age ${next.fromAge - 1}` : "Onwards"}
                </td>
                <td>
                  <Money
                    label={`${label} yearly spending`}
                    value={phase.annualWithdrawal}
                    onCommit={(annualWithdrawal) => update(phase.id, { annualWithdrawal })}
                  />
                </td>
                <td>
                  {config.spendingPhases.length > 1 && (
                    <RemoveButton
                      label={`Remove ${label}`}
                      onClick={() =>
                        onChange({
                          spendingPhases: config.spendingPhases.filter(
                            (each) => each.id !== phase.id,
                          ),
                        })
                      }
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </RowsTable>
        <AddButton
          label="Add phase"
          onClick={() => {
            const last = sorted.at(-1);
            const fromAge = Math.max(config.currentAge, last?.fromAge ?? config.currentAge) + 10;
            onChange({
              spendingPhases: [
                ...config.spendingPhases,
                createMonteCarloSpendingPhase(newId(), fromAge),
              ],
            });
          }}
        />
      </div>
      <Group title="Withdrawal rule">
        <Field label="Rule">
          <Choice
            label="Withdrawal rule"
            items={RULES}
            value={config.withdrawalRule.type}
            onChange={(type) => onChange({ withdrawalRule: { ...config.withdrawalRule, type } })}
          />
        </Field>
        {config.withdrawalRule.type !== "none" && (
          <Field label="Minimum spending">
            <Money
              label="Minimum spending"
              value={config.minimumSpending}
              onCommit={(minimumSpending) => onChange({ minimumSpending })}
            />
          </Field>
        )}
      </Group>
      <RuleFields
        rule={config.withdrawalRule}
        onChange={(changes) =>
          onChange({ withdrawalRule: { ...config.withdrawalRule, ...changes } })
        }
      />
    </div>
  );
}

function TaxTab({ config, onChange }: { config: MonteCarloConfig; onChange: Change }) {
  const update = (id: string, changes: object) =>
    onChange({
      taxBands: config.taxBands.map((each) => (each.id === id ? { ...each, ...changes } : each)),
    });
  const bands = [...config.taxBands].sort((a, b) => a.from - b.from);
  return (
    <div className="grid gap-4">
      <Segmented
        label="Tax model"
        items={[
          { value: "flat", label: "Flat rate per pot" },
          { value: "bands", label: "Tax bands (progressive)" },
        ]}
        value={config.taxModel}
        onChange={(taxModel) => onChange({ taxModel })}
      />
      {config.taxModel === "flat" ? (
        <p className="text-sm text-muted-foreground">
          Each pot&apos;s withdrawals are taxed at its own rate, set on the Investment pots tab;
          each income stream at the rate set on the Income tab.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            The year&apos;s taxable income - each pot&apos;s taxable share of its withdrawals plus
            income - is taxed band by band, in today&apos;s money.
          </p>
          <RowsTable columns={["Income from", "Taxed at (%)", ""]}>
            {bands.map((band, index) => (
              <tr key={band.id}>
                <td>
                  {index === 0 ? (
                    <span className="text-muted-foreground">First earnings</span>
                  ) : (
                    <Money
                      label="Income from"
                      value={band.from}
                      onCommit={(from) => update(band.id, { from })}
                    />
                  )}
                </td>
                <td>
                  <NumberField
                    label="Taxed at (%)"
                    value={band.rate}
                    scale={100}
                    min={0}
                    max={99}
                    className="w-16"
                    onCommit={(rate) => update(band.id, { rate: rate ?? 0 })}
                  />
                </td>
                <td>
                  {index > 0 && (
                    <RemoveButton
                      label="Remove band"
                      onClick={() =>
                        onChange({
                          taxBands: config.taxBands.filter((each) => each.id !== band.id),
                        })
                      }
                    />
                  )}
                </td>
              </tr>
            ))}
          </RowsTable>
          <AddButton
            label="Add band"
            onClick={() =>
              onChange({
                taxBands: [
                  ...config.taxBands,
                  createMonteCarloTaxBand(newId(), (bands.at(-1)?.from ?? 0) + 5_000_000),
                ],
              })
            }
          />
        </>
      )}
    </div>
  );
}

/** Actual's plan editor, one tab per part of the plan. */
export function MonteCarloConfiguration({
  config,
  onChange,
  accounts,
}: {
  config: MonteCarloConfig;
  onChange: Change;
  accounts: ReadonlyArray<{ value: string; label: string }>;
}) {
  const [tab, setTab] = useState<Tab>("plan");
  return (
    <section className="grid min-w-0 gap-4 rounded-xl border p-4">
      <Segmented label="Configuration" items={TABS} value={tab} onChange={setTab} />
      <p className="text-sm text-muted-foreground">{TAB_HELP[tab]}</p>
      {tab === "plan" && <PlanTab config={config} onChange={onChange} />}
      {tab === "pots" && <PotsTab config={config} onChange={onChange} accounts={accounts} />}
      {tab === "income" && <IncomeTab config={config} onChange={onChange} />}
      {tab === "contributions" && <ContributionsTab config={config} onChange={onChange} />}
      {tab === "withdrawals" && <SpendingTab config={config} onChange={onChange} />}
      {tab === "tax" && <TaxTab config={config} onChange={onChange} />}
    </section>
  );
}
