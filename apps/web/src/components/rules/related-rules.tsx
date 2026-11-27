import type { RuleChange, Rule } from "@reeve/contract/catalog";
import type { RegisterRow } from "@reeve/contract";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@reeve/ui/components/button";
import { PaneSection } from "@/components/pane-form";
import { useChoices } from "@/components/reports/choices";
import { fieldLabel, type Names } from "@/components/rules/rule-model";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";
import { ruleSentence } from "@/lib/rules";

type Format = (amount: number) => string;

const valueText = (field: RuleChange["field"], value: RuleChange["from"], format: Format) => {
  if (value === null || value === "") return "none";
  if (field === "amount" && typeof value === "number") return format(value);
  if (field === "cleared") return value ? "cleared" : "not cleared";
  return String(value);
};

const changeText = (change: RuleChange, format: Format) => {
  if (change.field === "split") return "Split into lines";
  if (change.field === "deleted") return "Deleted";
  const label = change.field === "schedule" ? "Schedule" : fieldLabel(change.field);
  return `${label}: ${valueText(change.field, change.from, format)} → ${valueText(change.field, change.to, format)}`;
};

/** The panel's section of rules: a heading, what it lists, and a way to add one. */
function RulesSection({
  note,
  onAdd,
  children,
}: {
  note: string;
  onAdd: () => void;
  children: ReactNode;
}) {
  return (
    <PaneSection
      title="Rules"
      action={
        <Button variant="outline" onClick={onAdd}>
          <PlusIcon />
          Add a rule
        </Button>
      }
    >
      {children}
      <p className="text-xs text-muted-foreground">{note}</p>
    </PaneSection>
  );
}

function RuleLink({
  rule,
  names,
  onOpen,
  children,
}: {
  rule: Rule;
  names: Names;
  onOpen: (rule: Rule) => void;
  children?: ReactNode;
}) {
  const { format } = useBook();
  return (
    <li className="grid gap-1">
      <button
        type="button"
        onClick={() => onOpen(rule)}
        className="text-start text-sm underline-offset-2 hover:underline focus-visible:underline"
      >
        {ruleSentence(rule, names, format)}
      </button>
      {children}
    </li>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/** How rules made a register row what it is, the ones that match it now, and a way to add one. */
export function TransactionRules({
  row,
  onOpen,
  onAdd,
}: {
  row: RegisterRow;
  onOpen: (rule: Rule) => void;
  onAdd: () => void;
}) {
  const { id: book, format } = useBook();
  const { names } = useChoices(book);
  const { data } = useQuery(
    bookQuery(book, "transaction_rules", { id: row.transactionId, account: row.accountId }),
  );
  const applied = new Set(data?.applied.map((each) => each.rule.id));
  const others = data?.matching.filter((rule) => !applied.has(rule.id)) ?? [];
  return (
    <RulesSection
      note={
        data?.origin === "entered"
          ? "Worked out by running today's rules on the transaction as entered, without its category."
          : "Worked out by running today's rules on the line as the bank sent it."
      }
      onAdd={onAdd}
    >
      {data !== undefined && data.applied.length === 0 && others.length === 0 && (
        <Empty>No rule applies to this transaction.</Empty>
      )}
      {data !== undefined && data.applied.length > 0 && (
        <div className="grid gap-2">
          <h4 className="text-xs font-medium text-muted-foreground">How it got here</h4>
          <ol className="grid gap-3">
            {data.applied.map(({ rule, changes }) => (
              <RuleLink key={rule.id} rule={rule} names={names} onOpen={onOpen}>
                <ul className="grid gap-0.5 text-xs text-muted-foreground">
                  {changes.map((change) => (
                    <li key={change.field} className={change.holds ? undefined : "line-through"}>
                      {changeText(change, format)}
                      {!change.holds && <span className="sr-only"> (changed since)</span>}
                    </li>
                  ))}
                </ul>
              </RuleLink>
            ))}
          </ol>
        </div>
      )}
      {others.length > 0 && (
        <div className="grid gap-2">
          <h4 className="text-xs font-medium text-muted-foreground">
            {data?.applied.length === 0 ? "Matches now" : "Also matches now"}
          </h4>
          <ul className="grid gap-3">
            {others.map((rule) => (
              <RuleLink key={rule.id} rule={rule} names={names} onOpen={onOpen} />
            ))}
          </ul>
        </div>
      )}
    </RulesSection>
  );
}

/** The rules that name a payee, and a way to add one for it. */
export function PayeeRules({
  payee,
  learns,
  onOpen,
  onAdd,
}: {
  payee: string;
  learns: boolean;
  onOpen: (rule: Rule) => void;
  onAdd: () => void;
}) {
  const { id: book } = useBook();
  const { names } = useChoices(book);
  const { data } = useQuery(bookQuery(book, "list_rules", { payee }));
  return (
    <RulesSection
      note={
        learns
          ? "Adding a category rule here turns off learning for this payee, so the rule stays as you wrote it."
          : "The rules that name this payee, in the order they run."
      }
      onAdd={onAdd}
    >
      {data?.length === 0 && <Empty>No rule names this payee.</Empty>}
      {data !== undefined && data.length > 0 && (
        <ul className="grid gap-3">
          {data.map((rule) => (
            <RuleLink key={rule.id} rule={rule} names={names} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </RulesSection>
  );
}
