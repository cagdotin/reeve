import type { Rule, RuleActivity, RuleOverview } from "@reeve/contract/catalog";
import { today } from "@reeve/contract/rules";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { Page } from "@/components/page";
import { ScopeNote } from "@/components/scope-note";
import { Facets, FacetSelect } from "@/components/facets";
import { FilterBar, RangeChoice, SelectionActions } from "@/components/insights/filter-bar";
import { TableEmpty } from "@/components/insights/table";
import { useChoices } from "@/components/reports/choices";
import { RuleDialogs, RuleMatches, type RuleRequest } from "@/components/rules/rule-dialogs";
import { usePaneLeave } from "@/components/split-panel";
import { RuleEditor } from "@/components/rules/rule-editor";
import { RuleAlerts } from "@/components/rules/rule-suggestions";
import { AccountSuggestions } from "@/components/rules/account-suggestions";
import type { Names } from "@/components/rules/rule-model";
import { RuleRow, RulesHeader, StageHeading } from "@/components/rules/rules-table";
import { Button } from "@reeve/ui/components/button";
import {
  scopedAccount,
  scopeInput,
  useAccountScope,
  validateScopeSearch,
} from "@/lib/account-scope";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";
import { facetCount, type FacetValue } from "@/lib/facets";
import { nextSort, rangeStart, toggled } from "@/lib/insights";
import {
  DEFAULT_MONTHS,
  DEFAULT_SORT,
  DESCENDING_FIRST,
  draftForAccount,
  draftForPayee,
  duplicateDraft,
  matchesRuleSearch,
  passesRuleFilters,
  ruleFilterGroups,
  ruleSentence,
  sortRules,
  type RuleSort,
} from "@/lib/rules";

/** A rules filter in the address, so a payee can link to its rules. */
const validateRulesSearch = (
  search: Record<string, unknown>,
): { payee?: ReadonlyArray<string>; account?: string } => {
  const payee = search["payee"];
  return {
    ...validateScopeSearch(search),
    ...(Array.isArray(payee)
      ? { payee: payee.filter((each): each is string => typeof each === "string") }
      : {}),
  };
};

export const Route = createFileRoute("/rules")({
  validateSearch: validateRulesSearch,
  component: RulesPage,
});

type RulePane =
  | { readonly kind: "edit"; readonly rule: Partial<Rule> }
  | { readonly kind: "matches"; readonly rule: RuleActivity };

/** Under a scope, a rule that could act here but never has. */
const isIdle = (rule: RuleActivity) => rule.everyAccount && rule.totalMatches === 0;

const useFoldedRules = (rules: ReadonlyArray<RuleActivity>, folding: boolean) => {
  const [unfolded, setUnfolded] = useState(false);
  const idle = folding && !unfolded ? rules.filter(isIdle).length : 0;
  return {
    listed: idle === 0 ? rules : rules.filter((rule) => !isIdle(rule)),
    folded: idle,
    unfold: () => setUnfolded(true),
  };
};

/** The search, filters, selection's actions and range, which stick above the rows. */
function RuleFilterBar({
  rules,
  choices,
  names,
  query,
  onQuery,
  filters,
  onFilters,
  selected,
  onDelete,
  shown,
  months,
  onMonths,
  head,
}: {
  rules: ReadonlyArray<RuleActivity>;
  choices: ReturnType<typeof useChoices>["choices"];
  names: Names;
  query: string;
  onQuery: (query: string) => void;
  filters: FacetValue;
  onFilters: (filters: FacetValue) => void;
  selected: number;
  onDelete: () => void;
  shown: number;
  months: number | null;
  onMonths: (months: number | null) => void;
  head: ReactNode;
}) {
  const groups = ruleFilterGroups(rules, choices, names);
  const payeeGroup = groups.find((group) => group.id === "payee");
  return (
    <FilterBar
      testId="rule-filters"
      search="Search rules"
      query={query}
      onQuery={onQuery}
      shown={shown}
      total={rules.length}
      range={<RangeChoice months={months} onMonths={onMonths} />}
      head={head}
    >
      {payeeGroup !== undefined && (
        <FacetSelect
          group={payeeGroup}
          value={filters["payee"] ?? []}
          onValueChange={(payees) => {
            const { payee: _payee, ...rest } = filters;
            onFilters(payees.length === 0 ? rest : { ...rest, payee: payees });
          }}
        />
      )}
      <Facets
        groups={groups.filter((group) => group !== payeeGroup)}
        value={filters}
        onValueChange={onFilters}
      />
      {selected > 0 && <SelectionActions count={selected} onDelete={onDelete} />}
    </FilterBar>
  );
}

/** The page once its numbers are here: everything it filters, selects and opens. */
function RulesContent({
  overview,
  since,
  months,
  onMonths,
  pane,
  onPane,
}: {
  overview: RuleOverview;
  since: string | undefined;
  months: number | null;
  onMonths: (months: number | null) => void;
  pane: RulePane | null;
  onPane: (pane: RulePane | null) => void;
}) {
  const { id: book, format } = useBook();
  const { names, choices } = useChoices(book);
  const { payee } = Route.useSearch();
  const [sort, setSort] = useState<RuleSort>(DEFAULT_SORT);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<FacetValue>(payee === undefined ? {} : { payee });
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [request, setRequest] = useState<RuleRequest | null>(null);
  const editing = pane?.kind === "edit" ? pane.rule : null;

  const scope = useAccountScope();
  const { rules } = overview;
  const monthNames = overview.months.map((each) => each.month);
  const narrowed = query.trim() !== "" || facetCount(filters) > 0;
  const { listed, folded, unfold } = useFoldedRules(rules, scope !== "all" && !narrowed);
  const shown = sortRules(
    listed.filter(
      (rule) =>
        passesRuleFilters(rule, filters) &&
        matchesRuleSearch(ruleSentence(rule, names, format), query),
    ),
    sort,
    names,
    format,
  );
  const selected = shown.filter((rule) => chosen.has(rule.id));

  return (
    <>
      <RuleAlerts
        overview={overview}
        filters={filters}
        onFilters={setFilters}
        onPayee={(id, category) => onPane({ kind: "edit", rule: draftForPayee(id, category) })}
      />
      <AccountSuggestions />
      <ScopeNote>
        {(where) =>
          `Rules that can act on ${where}, by their account conditions. A globe marks a rule for every account: editing any rule changes what it does everywhere it applies.`
        }
      </ScopeNote>
      <RuleFilterBar
        rules={listed}
        choices={choices}
        names={names}
        query={query}
        onQuery={setQuery}
        filters={filters}
        onFilters={setFilters}
        selected={selected.length}
        onDelete={() => setRequest({ kind: "delete", rules: selected })}
        shown={shown.length}
        months={months}
        onMonths={onMonths}
        head={
          <RulesHeader
            sort={sort}
            onSort={(key) => setSort(nextSort(sort, key, DESCENDING_FIRST))}
            allSelected={shown.length > 0 && selected.length === shown.length}
            someSelected={selected.length > 0}
            onSelectAll={(all) => setChosen(new Set(all ? shown.map((rule) => rule.id) : []))}
          />
        }
      />
      {shown.map((rule, index) => (
        <Fragment key={rule.id}>
          {sort.key === "run" && shown[index - 1]?.stage !== rule.stage && (
            <StageHeading
              stage={rule.stage}
              count={shown.filter((each) => each.stage === rule.stage).length}
            />
          )}
          <RuleRow
            rule={rule}
            scoped={scope !== "all"}
            months={monthNames}
            names={names}
            since={since}
            selected={chosen.has(rule.id)}
            onSelect={() => setChosen(toggled(chosen, rule.id))}
            onEdit={() => onPane({ kind: "edit", rule })}
            onDuplicate={() => onPane({ kind: "edit", rule: duplicateDraft(rule) })}
            onMatches={() => onPane({ kind: "matches", rule })}
            onDelete={() => setRequest({ kind: "delete", rules: [rule] })}
          />
        </Fragment>
      ))}
      {folded > 0 && (
        <div className="flex items-center justify-center gap-3 p-4 text-xs text-muted-foreground">
          {folded === 1
            ? "1 rule for every account has matched nothing here."
            : `${folded} rules for every account have matched nothing here.`}
          <Button variant="outline" onClick={unfold}>
            Show them
          </Button>
        </div>
      )}
      {shown.length === 0 && folded === 0 && (
        <TableEmpty>
          {narrowed
            ? "No rule matches."
            : "No rules yet. Rules categorize, rename and edit transactions as they arrive, and reeve learns a payee's category as you categorize."}
        </TableEmpty>
      )}
      <RuleEditor
        rule={editing}
        open={editing !== null}
        onOpenChange={(open) => !open && onPane(null)}
        choices={choices}
        names={names}
        rules={rules}
        schedule={rules.find((rule) => rule.id === editing?.id)?.schedule ?? null}
      />
      {pane?.kind === "matches" && (
        <RuleMatches rule={pane.rule} names={names} onClose={() => onPane(null)} />
      )}
      <RuleDialogs
        request={request}
        names={names}
        onClose={() => setRequest(null)}
        onDeleted={() => setChosen(new Set())}
      />
    </>
  );
}

function RulesPage() {
  const { id: book } = useBook();
  const [months, setMonths] = useState<number | null>(DEFAULT_MONTHS);
  const since = months === null ? undefined : rangeStart(today(), months);
  const scope = useAccountScope();
  const overview = useQuery({
    ...bookQuery(book, "rule_activity", {
      ...scopeInput(scope),
      ...(since === undefined ? {} : { since }),
    }),
    placeholderData: keepPreviousData,
  });

  const [pane, setPane] = useState<RulePane | null>(null);
  const leave = usePaneLeave();
  const openPane = (next: RulePane | null) => leave(() => setPane(next));
  const account = scopedAccount(scope);

  return (
    <Page
      width="window"
      title="Rules"
      query={overview}
      actions={
        <Button
          variant="ghost"
          disabled={overview.data === undefined}
          onClick={() =>
            openPane({ kind: "edit", rule: account === undefined ? {} : draftForAccount(account) })
          }
        >
          <PlusIcon />
          New rule
        </Button>
      }
    >
      {(data) => (
        <RulesContent
          overview={data}
          since={since}
          months={months}
          onMonths={setMonths}
          pane={pane}
          onPane={openPane}
        />
      )}
    </Page>
  );
}
