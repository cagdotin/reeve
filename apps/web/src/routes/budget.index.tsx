import { addMonths, currentMonth } from "@reeve/contract/rules";
import type { BudgetView, CategoryGroup } from "@reeve/contract";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { BudgetGrid } from "@/components/budget/budget-grid";
import { useFolding, type Folding } from "@/components/budget/use-folding";
import { CategoryDialog, type CategoryRequest } from "@/components/categories/category-dialog";
import { MobileBudget } from "@/components/mobile/mobile-budget";
import { Money } from "@/components/money";
import { Page } from "@/components/page";
import { PageAlert } from "@/components/page-alert";
import { useIsMobile } from "@reeve/ui/hooks/use-media-query";
import { Button } from "@reeve/ui/components/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "@reeve/ui/components/menu";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";
import { useHotkeys } from "@/lib/hotkeys";
import { monthLabel } from "@/lib/months";
import { budgetMonths } from "@/lib/prefs";

export const Route = createFileRoute("/budget/")({
  validateSearch: (search: Record<string, unknown>): { month?: string } => ({
    ...(typeof search["month"] === "string" && /^\d{4}-\d{2}$/.test(search["month"])
      ? { month: search["month"] }
      : {}),
  }),
  component: BudgetPage,
});

const NO_GROUPS: ReadonlyArray<CategoryGroup> = [];

const savedCount = () => {
  const count = Number(budgetMonths.get());
  return count >= 1 && count <= 3 ? count : 1;
};

function BudgetPage() {
  const { id: book } = useBook();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const month = search.month ?? currentMonth();
  const [saved, setCount] = useState(savedCount);
  const mobile = useIsMobile();
  const count = mobile ? 1 : saved;
  const [showHidden, setShowHidden] = useState(false);
  const [categoryRequest, setCategoryRequest] = useState<CategoryRequest | null>(null);
  const view = useQuery({
    ...bookQuery(book, "get_budget", { month, count }),
    placeholderData: keepPreviousData,
  });

  const folding = useFolding(view.data?.groups ?? NO_GROUPS);

  const go = (to: string) => void navigate({ search: { month: to } });
  const range = view.data?.range;
  const canBack = range === undefined || month > range.start;
  const canForward = range === undefined || addMonths(month, count - 1) < range.end;
  useHotkeys({
    arrowleft: () => canBack && go(addMonths(month, -1)),
    arrowright: () => canForward && go(addMonths(month, 1)),
    t: () => go(currentMonth()),
  });

  return (
    <>
      <Page
        title="Budget"
        width="window"
        query={view}
        actions={
          <>
            <NewMenu disabled={view.data === undefined} onRequest={setCategoryRequest} />
            <BudgetViewMenu
              month={month}
              count={count}
              mobile={mobile}
              canBack={canBack}
              canForward={canForward}
              onGo={go}
              onCount={(next) => {
                setCount(next);
                budgetMonths.set(String(next));
              }}
              showHidden={showHidden}
              onShowHidden={setShowHidden}
              folding={folding}
            />
          </>
        }
      >
        {(data) => (
          <div>
            <UncategorizedAlert uncategorized={data.uncategorized} />
            {mobile ? (
              <MobileBudget
                view={data}
                showHidden={showHidden}
                folding={folding}
                onCategoryRequest={setCategoryRequest}
              />
            ) : (
              <BudgetGrid
                view={data}
                showHidden={showHidden}
                folding={folding}
                onCategoryRequest={setCategoryRequest}
              />
            )}
          </div>
        )}
      </Page>
      <CategoryDialog
        request={categoryRequest}
        groups={view.data?.groups ?? NO_GROUPS}
        onClose={() => setCategoryRequest(null)}
      />
    </>
  );
}

function NewMenu({
  disabled,
  onRequest,
}: {
  disabled: boolean;
  onRequest: (request: CategoryRequest) => void;
}) {
  return (
    <Menu>
      <MenuTrigger disabled={disabled} render={<Button variant="ghost" />}>
        <PlusIcon />
        New
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuItem onClick={() => onRequest({ kind: "create-category" })}>New category</MenuItem>
        <MenuItem onClick={() => onRequest({ kind: "create-group" })}>New group</MenuItem>
      </MenuPopup>
    </Menu>
  );
}

function UncategorizedAlert({ uncategorized }: { uncategorized: BudgetView["uncategorized"] }) {
  if (uncategorized.count === 0) return null;
  return (
    <PageAlert
      variant="warning"
      title={
        <>
          {uncategorized.count} uncategorized{" "}
          {uncategorized.count === 1 ? "transaction" : "transactions"} worth{" "}
          <Money amount={-uncategorized.amount} tone="none" /> not counted in the budget
        </>
      }
      action={
        <Button
          variant="ghost"
          render={<Link to="/accounts/$account" params={{ account: "uncategorized" }} />}
        >
          Categorize
        </Button>
      }
    />
  );
}

function BudgetViewMenu({
  month,
  count,
  mobile,
  canBack,
  canForward,
  onGo,
  onCount,
  showHidden,
  onShowHidden,
  folding,
}: {
  month: string;
  count: number;
  mobile: boolean;
  canBack: boolean;
  canForward: boolean;
  onGo: (month: string) => void;
  onCount: (count: number) => void;
  showHidden: boolean;
  onShowHidden: (show: boolean) => void;
  folding: Folding;
}) {
  return (
    <Menu>
      <MenuTrigger render={<Button variant="ghost" />}>
        <span className="sr-only">Budget view: </span>
        {count === 1
          ? monthLabel(month)
          : `${monthLabel(month)} – ${monthLabel(addMonths(month, count - 1))}`}
        <ChevronDownIcon />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuItem
          closeOnClick={false}
          disabled={!canBack}
          onClick={() => onGo(addMonths(month, -1))}
        >
          Previous month
          <MenuShortcut>←</MenuShortcut>
        </MenuItem>
        <MenuItem closeOnClick={false} onClick={() => onGo(currentMonth())}>
          This month
          <MenuShortcut>T</MenuShortcut>
        </MenuItem>
        <MenuItem
          closeOnClick={false}
          disabled={!canForward}
          onClick={() => onGo(addMonths(month, 1))}
        >
          Next month
          <MenuShortcut>→</MenuShortcut>
        </MenuItem>
        <MenuSeparator />
        {!mobile && (
          <>
            <MenuGroup>
              <MenuGroupLabel>Months shown</MenuGroupLabel>
              <MenuRadioGroup
                value={String(count)}
                onValueChange={(value: string) => onCount(Number(value))}
              >
                {[1, 2, 3].map((each) => (
                  <MenuRadioItem key={each} value={String(each)}>
                    {each === 1 ? "1 month" : `${each} months`}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
            <MenuSeparator />
          </>
        )}
        <MenuCheckboxItem checked={showHidden} onCheckedChange={onShowHidden}>
          Show hidden categories
        </MenuCheckboxItem>
        <MenuItem
          closeOnClick={false}
          onClick={folding.anyFolded ? folding.expandAll : folding.collapseAll}
        >
          {folding.anyFolded ? "Expand all" : "Collapse all"}
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
