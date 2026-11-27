import { FEATURES } from "@reeve/contract/features";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  BookCopyIcon,
  BookOpenIcon,
  ChartColumnIcon,
  CircleIcon,
  FileTextIcon,
  FolderTreeIcon,
  LandmarkIcon,
  LayoutGridIcon,
  MoonIcon,
  PackageIcon,
  Redo2Icon,
  SettingsIcon,
  Undo2Icon,
} from "lucide-react";
import { Launcher, type LauncherAction, type LauncherPage } from "@/components/launcher";
import { useTheme } from "@/components/theme-provider";
import { bookKey, bookQuery, booksQuery, run, showError } from "@/lib/api";
import { DOCS } from "@/lib/docs";
import { useBook } from "@/lib/book";
import { tabPlace } from "@/lib/home-session";
import { DESTINATIONS } from "@/lib/nav";
import { REPORT_LIBRARY, savedReportPlace } from "@/lib/report-library";
import { lastBook } from "@/lib/prefs";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id: book } = useBook();
  const { data: books = [] } = useQuery(booksQuery);
  const { data: accounts = [] } = useQuery(bookQuery(book, "list_accounts", {}));
  const { data: dashboards = [] } = useQuery({
    ...bookQuery(book, "list_dashboard_pages", {}),
    enabled: open,
  });
  const { data: savedReports = [] } = useQuery({
    ...bookQuery(book, "list_saved_reports", {}),
    enabled: open,
  });
  const { resolvedTheme, setTheme } = useTheme();

  const go = (to: string) => () => void navigate({ to });
  const step = (name: "undo" | "redo") => () =>
    void run(name, { book })
      .then(() => queryClient.invalidateQueries({ queryKey: bookKey(book) }))
      .catch(showError);

  const goTo = DESTINATIONS.filter((destination) => destination.id !== "settings").flatMap(
    (destination): LauncherAction[] => {
      const shortcut = { shortcut: [destination.hotkey] };
      return destination.tabs.length > 0
        ? destination.tabs.map((tab) => ({
            id: `go:${tab.to}`,
            label: tab.label,
            icon: <tab.icon />,
            keywords: `${destination.label} ${tab.keywords ?? ""}`,
            ...(tab.hotkey !== undefined
              ? { shortcut: [tab.hotkey] }
              : tab.to === destination.to
                ? shortcut
                : {}),
            onSelect: () => void navigate(tabPlace(book, tab)),
          }))
        : [
            {
              id: `go:${destination.to}`,
              label: destination.label,
              icon: <destination.icon />,
              ...shortcut,
              onSelect: go(destination.to),
            },
          ];
    },
  );

  const actions: LauncherAction[] = [
    ...goTo,
    {
      id: "go:categories",
      label: "Categories",
      icon: <FolderTreeIcon />,
      keywords: "budget groups hide nest",
      onSelect: go("/budget"),
    },
    {
      id: "go:uncategorized",
      label: "Uncategorized transactions",
      icon: <BookOpenIcon />,
      onSelect: go("/accounts/uncategorized"),
    },
    ...(FEATURES.purchases
      ? [
          {
            id: "go:unassigned",
            label: "Unassigned receipt lines",
            icon: <PackageIcon />,
            onSelect: () => void navigate({ to: "/products", search: { tab: "unassigned" } }),
          },
          {
            id: "go:price-changes",
            label: "Price changes",
            icon: <PackageIcon />,
            onSelect: () => void navigate({ to: "/products", search: { tab: "changes" } }),
          },
        ]
      : []),
  ].map((action) => ({ ...action, group: "Go to" }));

  const browse: LauncherAction[] = [
    { id: "page:accounts", label: "Accounts", icon: <LandmarkIcon />, page: "accounts" },
    { id: "page:dashboards", label: "Dashboards", icon: <LayoutGridIcon />, page: "dashboards" },
    { id: "page:reports", label: "Reports", icon: <ChartColumnIcon />, page: "reports" },
    { id: "page:docs", label: "Documents", icon: <FileTextIcon />, page: "docs" },
    { id: "page:books", label: "Books", icon: <BookCopyIcon />, page: "books" },
    { id: "page:settings", label: "Settings", icon: <SettingsIcon />, page: "settings" },
  ]
    .filter((row) => row.page !== "accounts" || accounts.length > 0)
    .map((row) => ({ ...row, group: "Browse" }));

  const commands: LauncherAction[] = [
    {
      id: "do:undo",
      label: "Undo",
      icon: <Undo2Icon />,
      shortcut: ["⌘", "Z"],
      onSelect: step("undo"),
    },
    {
      id: "do:redo",
      label: "Redo",
      icon: <Redo2Icon />,
      shortcut: ["⇧", "⌘", "Z"],
      onSelect: step("redo"),
    },
    {
      id: "do:theme",
      label: "Toggle dark mode",
      icon: <MoonIcon />,
      keywords: "theme",
      onSelect: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
    },
  ].map((action) => ({ ...action, group: "Actions" }));

  const pages: Record<string, LauncherPage> = {
    accounts: {
      title: "Accounts",
      placeholder: "Search accounts…",
      actions: accounts.map((account) => ({
        id: `account:${account.id}`,
        label: account.name,
        icon: <LandmarkIcon />,
        keywords: "account",
        onSelect: go(`/accounts/${account.id}`),
      })),
    },
    dashboards: {
      title: "Dashboards",
      placeholder: "Search dashboards…",
      actions: dashboards.map((dashboard) => ({
        id: `dashboard:${dashboard.id}`,
        label: dashboard.name,
        icon: <LayoutGridIcon />,
        keywords: "dashboard",
        onSelect: () => void navigate({ to: "/", search: { dashboard: dashboard.id } }),
      })),
    },
    reports: {
      title: "Reports",
      placeholder: "Search reports…",
      actions: [
        ...savedReports.flatMap((report) =>
          "definition" in report
            ? [
                {
                  id: `saved-report:${report.id}`,
                  label: report.name,
                  icon: <ChartColumnIcon />,
                  keywords: "saved report",
                  onSelect: () =>
                    void navigate(savedReportPlace(report.definition.type, report.id)),
                },
              ]
            : [],
        ),
        ...REPORT_LIBRARY.flatMap((group) =>
          group.reports.map((report) => ({
            id: `report:${report.to}`,
            label: report.label,
            icon: <report.icon />,
            keywords: `report ${report.about}`,
            onSelect: go(report.to),
          })),
        ),
      ],
    },
    docs: {
      title: "Documents",
      placeholder: "Search documents…",
      actions: DOCS.map((doc) => ({
        id: `doc:${doc.path}`,
        label: doc.title,
        icon: <FileTextIcon />,
        keywords: "doc",
        onSelect: go(doc.path),
      })),
    },
    books: {
      title: "Books",
      placeholder: "Search books…",
      actions: books.map((each) => ({
        id: `book:${each.id}`,
        label: each.name,
        icon: <CircleIcon className={each.id === book ? "fill-current" : ""} />,
        keywords: "book",
        onSelect: () => {
          lastBook.set(each.id);
          location.assign("/");
        },
      })),
    },
    settings: {
      title: "Settings",
      placeholder: "Search settings…",
      actions: (DESTINATIONS.find((each) => each.id === "settings")?.tabs ?? []).map((tab) => ({
        id: `go:${tab.to}`,
        label: tab.label,
        icon: <tab.icon />,
        keywords: tab.keywords ?? "",
        onSelect: go(tab.to),
      })),
    },
  };

  return (
    <Launcher
      open={open}
      onOpenChange={onOpenChange}
      actions={[...actions, ...browse, ...commands]}
      pages={pages}
      placeholder="Search pages, accounts, commands…"
    />
  );
}
