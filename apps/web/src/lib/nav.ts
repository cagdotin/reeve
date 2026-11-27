import {
  BookOpenIcon,
  CalendarClockIcon,
  ChartColumnIcon,
  ConciergeBellIcon,
  FileTextIcon,
  HomeIcon,
  LandmarkIcon,
  LayoutGridIcon,
  PackageIcon,
  PiggyBankIcon,
  ReceiptIcon,
  SettingsIcon,
  ShoppingBasketIcon,
  UsersIcon,
  WandSparklesIcon,
  type LucideIcon,
} from "lucide-react";
import { isPageEnabled } from "@reeve/contract/features";
import { SETTINGS_SECTIONS } from "./settings-sections.ts";

export const REGISTER_ALL = "/accounts/all";

/** Whether `path` is the page `to` or a page under it. */
export const within = (path: string, to: string) => path === to || path.startsWith(`${to}/`);

export interface Tab {
  readonly to: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** More words the command palette matches. */
  readonly keywords?: string;
  readonly active: (path: string) => boolean;
  /** The pages under it are this tab too, not pages to come back from. */
  readonly nested?: true;
  /** Its link returns to the page of it this window showed last (docs/rules/reports.md). */
  readonly resumes?: true;
  /** The key that opens it, at the page it resumes, from anywhere. */
  readonly hotkey?: string;
}

export interface Destination {
  readonly id: string;
  readonly label: string;
  readonly to: string;
  readonly icon: LucideIcon;
  /** The key that opens it from anywhere. */
  readonly hotkey: string;
  readonly tabs: ReadonlyArray<Tab>;
  /** Its tabs share an account scope, chosen in the header. */
  readonly scoped?: true;
  /**
   * It sits at the sidebar's foot and, while open, replaces the sidebar with its own list, which cannot
   * fold. A phone has no sidebar, so there its tabs stay tabs.
   */
  readonly sidebar?: true;
}

const page = (to: string, label: string, icon: LucideIcon, keywords?: string): Tab => ({
  to,
  label,
  icon,
  ...(keywords === undefined ? {} : { keywords }),
  active: (path) => within(path, to),
});

/**
 * Every page a person can reach, once. The sidebar, the tabs under a page's title, the command palette
 * and the test that every page stays findable all read this.
 */
const destinations: ReadonlyArray<Destination> = [
  {
    id: "home",
    label: "Home",
    to: "/",
    icon: HomeIcon,
    hotkey: "h",
    tabs: [
      {
        to: "/",
        label: "Dashboards",
        icon: LayoutGridIcon,
        keywords: "home today widgets",
        active: (path) => path === "/",
        resumes: true,
      },
      {
        to: "/reports",
        label: "Reports",
        icon: ChartColumnIcon,
        keywords: "all reports library charts",
        active: (path) => within(path, "/reports"),
        nested: true,
        resumes: true,
        hotkey: "r",
      },
    ],
  },
  {
    id: "budget",
    label: "Budget",
    to: "/budget",
    icon: PiggyBankIcon,
    hotkey: "b",
    tabs: [],
  },
  {
    id: "accounts",
    label: "Accounts",
    to: REGISTER_ALL,
    icon: LandmarkIcon,
    hotkey: "a",
    scoped: true,
    tabs: [
      {
        to: REGISTER_ALL,
        label: "Transactions",
        icon: BookOpenIcon,
        keywords: "register all accounts ledger search balances banks",
        active: (path) => within(path, "/accounts"),
        nested: true,
      },
      page("/payees", "Payees", UsersIcon, "merchants merge"),
      page("/rules", "Rules", WandSparklesIcon, "automate categorize rename"),
      page("/schedules", "Schedules", CalendarClockIcon, "bills recurring upcoming"),
    ],
  },
  {
    id: "purchases",
    label: "Purchases",
    to: "/receipts",
    icon: ShoppingBasketIcon,
    hotkey: "p",
    tabs: [
      page("/receipts", "Receipts", ReceiptIcon, "itemized photos"),
      page("/products", "Products", PackageIcon, "prices stores"),
    ],
  },
  {
    id: "docs",
    label: "Docs",
    to: "/docs",
    icon: FileTextIcon,
    hotkey: "d",
    sidebar: true,
    tabs: [],
  },
  {
    id: "settings",
    label: "Settings",
    to: "/settings/general",
    icon: SettingsIcon,
    hotkey: "s",
    sidebar: true,
    tabs: [
      ...SETTINGS_SECTIONS.map(({ id, label, icon, keywords }) =>
        page(`/settings/${id}`, label, icon, keywords),
      ),
    ],
  },
];

export const DESTINATIONS = destinations.filter((destination) => isPageEnabled(destination.to));

/** Steward has no page yet: the sidebar shows it, disabled. */
export const STEWARD = { label: "Steward", icon: ConciergeBellIcon } as const;

const isHere = (destination: Destination, path: string) =>
  destination.tabs.some((tab) => tab.active(path)) || within(path, destination.to);

export const destinationOf = (path: string): Destination | undefined =>
  isPageEnabled(path) ? DESTINATIONS.find((destination) => isHere(destination, path)) : undefined;

/** What opens a page in the bar: its destination's tabs, an arrow back to the list it sits in, or nothing. */
export type PageLead =
  | { readonly kind: "tabs"; readonly destination: Destination }
  | { readonly kind: "back"; readonly to: string }
  | { readonly kind: "none" };

export const leadOf = (path: string): PageLead => {
  const destination = destinationOf(path);
  if (destination === undefined || destination.tabs.length === 0) return { kind: "none" };
  const tab = destination.tabs.find((candidate) => candidate.active(path));
  if (tab?.to === path || tab?.nested === true) return { kind: "tabs", destination };
  return { kind: "back", to: tab?.to ?? destination.to };
};
