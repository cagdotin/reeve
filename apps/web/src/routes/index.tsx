import type { DashboardPage, WidgetConfig } from "@reeve/contract/catalog";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ChartColumnIcon,
  CheckIcon,
  ChevronDownIcon,
  EllipsisIcon,
  LayoutGridIcon,
  PlusIcon,
} from "lucide-react";
import { useState } from "react";
import { AccountDialog } from "@/components/account-dialog";
import { Page } from "@/components/page";
import { PageAlert } from "@/components/page-alert";
import { WIDGETS, type WidgetKind } from "@/components/reports/widgets";
import { DashboardGrid } from "@/components/reports/dashboard-grid";
import { RenameDialog, WidgetCard } from "@/components/reports/widget-card";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@reeve/ui/components/alert-dialog";
import { Button } from "@reeve/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@reeve/ui/components/empty";
import {
  Menu,
  MenuGroupLabel,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@reeve/ui/components/menu";
import { Toggle } from "@reeve/ui/components/toggle";
import { bookQuery, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { chooseDashboard } from "@/lib/home-session";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { dashboard?: string } =>
    typeof search["dashboard"] === "string" ? { dashboard: search["dashboard"] } : {},
  component: DashboardsPage,
});

const placement = { version: 1, title: null, presentation: {} } as const;
const inherit = { accounts: { mode: "inherit" } } as const;

/** The widgets the add menu offers, in Actual's order, and how each starts. */
const NEW_WIDGETS = Object.entries(WIDGETS).flatMap(([type, spec]) => {
  if (spec.add === undefined) return [];
  const { label, settings = {}, height } = spec.add;
  const config: WidgetConfig =
    spec.kind === "text"
      ? { ...placement, settings }
      : spec.report === undefined
        ? { ...placement, scope: inherit, settings }
        : { ...placement, scope: inherit };
  return [
    {
      label,
      kind: spec.kind,
      input: {
        type: type as keyof typeof WIDGETS,
        config,
        ...(spec.report === undefined ? {} : { report: { settings } }),
        ...(height === undefined ? {} : { height }),
      },
    },
  ];
});

const MENU_GROUPS = [
  { label: "Your money", kinds: ["summary", "work-list"] },
  { label: "Reports", kinds: ["report"] },
  { label: "Other", kinds: ["text"] },
] as const satisfies ReadonlyArray<{ label: string; kinds: ReadonlyArray<WidgetKind> }>;

function NoAccounts() {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageAlert
        variant="info"
        title="Start with an account"
        action={
          <Button variant="ghost" onClick={() => setAdding(true)}>
            <PlusIcon />
            Add account
          </Button>
        }
      >
        Add the account you pay from. Its balance becomes your first money to budget.
      </PageAlert>
      <AccountDialog open={adding} onOpenChange={setAdding} />
    </>
  );
}

/** Home's Dashboards tab: the dashboard the address names, else the book's default. */
function DashboardsPage() {
  const { id: book } = useBook();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const pages = useQuery(bookQuery(book, "list_dashboard_pages", {}));
  const accounts = useQuery(bookQuery(book, "list_accounts", {}));
  const reports = useQuery(bookQuery(book, "list_custom_reports", {}));
  const [editing, setEditing] = useState(false);
  const layout = useBookMutation(book, "update_widgets");
  const add = useBookMutation(book, "add_widget");

  const chosen = pages.data && chooseDashboard(pages.data, search.dashboard);
  const page = chosen?.dashboard;
  const goTo = (id: string | undefined) =>
    void navigate({ search: id === undefined ? {} : { dashboard: id } });
  const shown = page && pages.data && { pages: pages.data, page, onPick: goTo };

  return (
    <Page
      title={page?.name ?? "Dashboards"}
      query={pages}
      context={
        shown ? (
          <DashboardSelector {...shown} />
        ) : (
          <Button variant="outline" disabled>
            Dashboard
            <ChevronDownIcon />
          </Button>
        )
      }
      actions={
        <>
          <Menu>
            <MenuTrigger
              aria-label="Add widget"
              title="Add widget"
              disabled={page === undefined}
              render={<Button variant="ghost" />}
            >
              <PlusIcon />
              <span className="max-md:hidden">Add widget</span>
            </MenuTrigger>
            <MenuPopup align="end">
              {MENU_GROUPS.map((group) => (
                <MenuGroup key={group.label}>
                  <MenuGroupLabel>{group.label}</MenuGroupLabel>
                  {NEW_WIDGETS.filter((each) =>
                    (group.kinds as ReadonlyArray<WidgetKind>).includes(each.kind),
                  ).map((each) => (
                    <MenuItem
                      key={each.input.type}
                      onClick={() =>
                        page &&
                        add.mutate({
                          pageId: page.id,
                          ...each.input,
                          report: each.input.report as never,
                        })
                      }
                    >
                      {each.label}
                    </MenuItem>
                  ))}
                </MenuGroup>
              ))}
              <MenuSeparator />
              <MenuItem render={<Link to="/reports/custom" />}>New custom report</MenuItem>
              {(reports.data ?? []).length > 0 && (
                <MenuGroup>
                  <MenuGroupLabel>Saved reports</MenuGroupLabel>
                  {(reports.data ?? []).map((report) => (
                    <MenuItem
                      key={report.id}
                      onClick={() =>
                        page &&
                        add.mutate({
                          pageId: page.id,
                          type: "custom-report",
                          reportId: report.id,
                        })
                      }
                    >
                      {report.name}
                    </MenuItem>
                  ))}
                </MenuGroup>
              )}
            </MenuPopup>
          </Menu>
          <Toggle
            pressed={editing}
            disabled={page === undefined || page.widgets.length === 0}
            onPressedChange={setEditing}
            aria-label="Arrange widgets"
            title="Move and resize widgets"
            className="gap-1.5 px-2"
          >
            <LayoutGridIcon />
            <span className="max-md:hidden">{editing ? "Done" : "Edit"}</span>
          </Toggle>
          {shown && <DashboardActions {...shown} />}
        </>
      }
    >
      {(data) =>
        page && (
          <>
            {chosen.missing && (
              <PageAlert variant="info" title="That dashboard no longer exists">
                “{page.name}” is shown instead.
              </PageAlert>
            )}
            {accounts.isSuccess && accounts.data.length === 0 && <NoAccounts />}
            {page.widgets.length === 0 ? (
              <Empty className="py-16">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ChartColumnIcon />
                  </EmptyMedia>
                  <EmptyTitle>This dashboard is empty</EmptyTitle>
                  <EmptyDescription>
                    Add a widget to see your money or a report here.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <DashboardGrid
                key={page.id}
                widgets={page.widgets}
                editing={editing}
                onLayout={(changes) =>
                  layout.mutate({
                    widgets: changes.map((box) => ({
                      id: box.id,
                      x: box.x,
                      y: box.y,
                      width: box.w,
                      height: box.h,
                    })),
                  })
                }
                renderCard={(widget, arrange) => (
                  <WidgetCard widget={widget} pages={data} arrange={arrange} />
                )}
              />
            )}
          </>
        )
      }
    </Page>
  );
}

type DashboardDialog = "rename" | "duplicate" | "reset" | "delete";

interface DashboardProps {
  readonly pages: ReadonlyArray<DashboardPage>;
  readonly page: DashboardPage;
  readonly onPick: (id: string | undefined) => void;
}

/** The dashboard selector, right after the tabs, which also starts a new dashboard. */
function DashboardSelector({ pages, page, onPick }: DashboardProps) {
  const { id: book } = useBook();
  const create = useBookMutation(book, "create_dashboard_page");
  const [creating, setCreating] = useState(false);
  return (
    <>
      <Menu>
        <MenuTrigger
          aria-label={`Dashboard: ${page.name}`}
          render={<Button variant="outline" className="max-w-56" />}
        >
          <span className="truncate">{page.name}</span>
          <ChevronDownIcon />
        </MenuTrigger>
        <MenuPopup align="start">
          <MenuGroup>
            <MenuGroupLabel>Dashboards</MenuGroupLabel>
            {pages.map((each) => (
              <MenuItem key={each.id} onClick={() => onPick(each.id)}>
                <CheckIcon className={each.id === page.id ? "" : "invisible"} />
                <span className="min-w-0 flex-1 truncate">{each.name}</span>
                {each.isDefault && <span className="text-xs text-muted-foreground">Default</span>}
              </MenuItem>
            ))}
          </MenuGroup>
          <MenuSeparator />
          <MenuItem onClick={() => setCreating(true)}>
            <PlusIcon />
            New dashboard…
          </MenuItem>
        </MenuPopup>
      </Menu>
      <RenameDialog
        open={creating}
        onOpenChange={setCreating}
        title="New dashboard"
        name=""
        onSave={(name) => create.mutate({ name }, { onSuccess: (created) => onPick(created.id) })}
      />
    </>
  );
}

function DashboardActions({ pages, page, onPick }: DashboardProps) {
  const { id: book } = useBook();
  const rename = useBookMutation(book, "rename_dashboard_page");
  const duplicate = useBookMutation(book, "duplicate_dashboard_page");
  const makeDefault = useBookMutation(book, "set_default_dashboard");
  const reorder = useBookMutation(book, "reorder_dashboard_pages");
  const reset = useBookMutation(book, "reset_dashboard_page");
  const remove = useBookMutation(book, "delete_dashboard_page");
  const [dialog, setDialog] = useState<DashboardDialog | null>(null);
  const index = pages.findIndex((each) => each.id === page.id);
  const move = (by: -1 | 1) => {
    const ids = pages.map((each) => each.id);
    ids.splice(index, 1);
    ids.splice(index + by, 0, page.id);
    reorder.mutate({ ids });
  };
  const widgets = plural(page.widgets.length, "widget");
  const nextDefault = pages.find((each) => each.id !== page.id);
  const confirm = {
    reset: {
      title: `Reset “${page.name}”?`,
      description: `Its ${widgets} are replaced with the widgets Today starts with. You can undo this.`,
      action: "Reset",
      run: () => reset.mutate({ id: page.id }),
    },
    delete: {
      title: `Delete “${page.name}”?`,
      description: `${
        page.widgets.length === 0
          ? "The empty dashboard is deleted."
          : `The dashboard and its ${widgets} are deleted; saved reports stay.`
      }${page.isDefault && nextDefault ? ` “${nextDefault.name}” opens by default instead.` : ""} You can undo this.`,
      action: "Delete",
      run: () => remove.mutate({ id: page.id }, { onSuccess: () => onPick(undefined) }),
    },
  };
  const confirming = dialog === "reset" || dialog === "delete" ? confirm[dialog] : null;
  return (
    <>
      <Menu>
        <MenuTrigger render={<Button size="icon" variant="ghost" aria-label="Dashboard actions" />}>
          <EllipsisIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem onClick={() => setDialog("rename")}>Rename…</MenuItem>
          <MenuItem onClick={() => setDialog("duplicate")}>Duplicate…</MenuItem>
          <MenuItem disabled={page.isDefault} onClick={() => makeDefault.mutate({ id: page.id })}>
            {page.isDefault ? "Opens by default" : "Open by default"}
          </MenuItem>
          {pages.length > 1 && (
            <>
              <MenuSeparator />
              <MenuItem disabled={index === 0} onClick={() => move(-1)}>
                Move earlier
              </MenuItem>
              <MenuItem disabled={index === pages.length - 1} onClick={() => move(1)}>
                Move later
              </MenuItem>
            </>
          )}
          <MenuSeparator />
          <MenuItem onClick={() => setDialog("reset")}>Reset to Today’s widgets…</MenuItem>
          <MenuItem
            variant="destructive"
            disabled={pages.length <= 1}
            onClick={() => setDialog("delete")}
          >
            Delete…
          </MenuItem>
        </MenuPopup>
      </Menu>
      <RenameDialog
        open={dialog === "rename"}
        onOpenChange={(open) => setDialog(open ? "rename" : null)}
        title="Rename dashboard"
        name={page.name}
        onSave={(name) => rename.mutate({ id: page.id, name })}
      />
      <RenameDialog
        open={dialog === "duplicate"}
        onOpenChange={(open) => setDialog(open ? "duplicate" : null)}
        title="Duplicate dashboard"
        name={`${page.name} copy`}
        onSave={(name) =>
          duplicate.mutate({ id: page.id, name }, { onSuccess: (copy) => onPick(copy.id) })
        }
      />
      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setDialog(null)}>
        {confirming && (
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirming.title}</AlertDialogTitle>
              <AlertDialogDescription>{confirming.description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
              <Button
                variant="destructive"
                onClick={() => {
                  confirming.run();
                  setDialog(null);
                }}
              >
                {confirming.action}
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        )}
      </AlertDialog>
    </>
  );
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
