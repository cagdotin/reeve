import type { AccountScope } from "@reeve/contract/catalog";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { PencilIcon, SaveIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Page, type PageQuery } from "@/components/page";
import { PageAlert } from "@/components/page-alert";
import { ReportSelector } from "@/components/reports/report-selector";
import { RenameDialog } from "@/components/reports/widget-card";
import type { ReportSave } from "@/components/reports/report-state";
import { SaveReportActions } from "@/components/reports/save-report";
import { Button } from "@reeve/ui/components/button";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";
import { scopeLabel } from "@/lib/report-scope";

/** Says which accounts a widget opened the report with, and offers its saved report's instead. */
export function ExploredScopeAlert({ scope }: { scope: AccountScope | undefined }) {
  const { id: book } = useBook();
  const navigate = useNavigate();
  const accounts = useQuery({
    ...bookQuery(book, "list_accounts", {}),
    enabled: scope !== undefined,
  });
  if (scope === undefined) return null;
  return (
    <PageAlert
      variant="info"
      title={`Showing ${scope.mode === "selected" ? scopeLabel(scope, accounts.data) : scopeLabel(scope, accounts.data).toLowerCase()} from the widget`}
      action={
        <Button
          variant="ghost"
          onClick={() =>
            void navigate({
              to: ".",
              replace: true,
              search: (previous: Record<string, unknown>) => ({ ...previous, scope: undefined }),
            })
          }
        >
          Use saved accounts
        </Button>
      }
    />
  );
}

/**
 * A full report under Home's Reports tab: its name in the report selector after the tabs, its controls
 * in a bar above, and the report below. Its Save menu writes the controls back to the saved report or into a new one.
 */
export function ReportShell({
  name,
  onRename,
  save,
  actions,
  controls,
  filters,
  children,
}: {
  name: string;
  onRename?: ((name: string) => void) | undefined;
  save?: ReportSave | undefined;
  actions?: ReactNode | undefined;
  controls?: ReactNode | undefined;
  filters?: ReactNode | undefined;
  children: ReactNode;
}) {
  const [renaming, setRenaming] = useState(false);
  return (
    <Page
      title={name}
      context={<ReportSelector name={name} />}
      actions={
        <>
          {actions}
          {onRename && (
            <>
              <Button variant="ghost" onClick={() => setRenaming(true)}>
                <PencilIcon />
                <span className="max-md:hidden">Rename</span>
              </Button>
              <RenameDialog
                open={renaming}
                onOpenChange={setRenaming}
                title="Rename report"
                name={name}
                onSave={onRename}
              />
            </>
          )}
          {save && <SaveReportActions name={name} save={save} />}
        </>
      }
    >
      <ExploredScopeAlert scope={save?.explored} />
      {(controls || filters) && (
        <div className="grid gap-2 pt-1 pb-4">
          {controls && <div className="flex flex-wrap items-center gap-2">{controls}</div>}
          {filters}
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5">{children}</div>
    </Page>
  );
}

/** A report until its saved report is here: its settings start from that report. */
export function ReportLoading({
  name,
  query,
  actions,
}: {
  name: string;
  query: PageQuery<unknown>;
  actions?: ReactNode;
}) {
  return (
    <Page
      title={name}
      context={<ReportSelector name={name} />}
      query={query}
      actions={
        <>
          {actions}
          <Button variant="ghost" disabled>
            <SaveIcon />
            Save report
          </Button>
        </>
      }
    >
      {() => null}
    </Page>
  );
}
