import {
  BanknoteArrowDownIcon,
  CalculatorIcon,
  CalendarDaysIcon,
  ChartLineIcon,
  ChartNoAxesCombinedIcon,
  ChartPieIcon,
  ClockIcon,
  DicesIcon,
  GitForkIcon,
  LineChartIcon,
  ShoppingBasketIcon,
  SigmaIcon,
  SlidersHorizontalIcon,
  TagsIcon,
  TrendingUpIcon,
  type LucideIcon,
} from "lucide-react";

import { isPageEnabled } from "@reeve/contract/features";

export interface ReportEntry {
  readonly to: string;
  readonly label: string;
  readonly about: string;
  readonly icon: LucideIcon;
}

/** Every report and report tool there is, whatever the dashboard happens to hold. */
const library: ReadonlyArray<{
  readonly label: string;
  readonly reports: ReadonlyArray<ReportEntry>;
}> = [
  {
    label: "Where you stand",
    reports: [
      {
        to: "/reports/net-worth",
        label: "Net worth",
        about: "What you own minus what you owe, over time",
        icon: TrendingUpIcon,
      },
      {
        to: "/reports/age-of-money",
        label: "Age of money",
        about: "How long money sits before it is spent",
        icon: ClockIcon,
      },
      {
        to: "/reports/balance-forecast",
        label: "Balance forecast",
        about: "Where balances head with your schedules",
        icon: ChartLineIcon,
      },
      {
        to: "/reports/crossover",
        label: "Crossover",
        about: "When investment income covers your spending",
        icon: ChartNoAxesCombinedIcon,
      },
      {
        to: "/reports/monte-carlo",
        label: "Monte Carlo",
        about: "How your plan holds up across many simulated futures",
        icon: DicesIcon,
      },
    ],
  },
  {
    label: "Where it went",
    reports: [
      {
        to: "/reports/spending",
        label: "Spending",
        about: "This month against another month and your average",
        icon: BanknoteArrowDownIcon,
      },
      {
        to: "/reports/cash-flow",
        label: "Cash flow",
        about: "Income, expenses and transfers by period",
        icon: LineChartIcon,
      },
      {
        to: "/reports/budget-analysis",
        label: "Budget analysis",
        about: "Budgeted, spent and the balance over time",
        icon: ChartPieIcon,
      },
      {
        to: "/reports/sankey",
        label: "Sankey",
        about: "Income flowing into groups and categories",
        icon: GitForkIcon,
      },
      {
        to: "/reports/calendar",
        label: "Calendar",
        about: "Money in and out on each day",
        icon: CalendarDaysIcon,
      },
      {
        to: "/reports/items",
        label: "Item spending",
        about: "What you spent per product, store and item category",
        icon: ShoppingBasketIcon,
      },
    ],
  },
  {
    label: "Make your own",
    reports: [
      {
        to: "/reports/custom",
        label: "Custom report",
        about: "Group, split and graph transactions any way",
        icon: SlidersHorizontalIcon,
      },
      {
        to: "/reports/summary",
        label: "Summary",
        about: "One figure: a sum or an average of what matches",
        icon: SigmaIcon,
      },
      {
        to: "/reports/formula",
        label: "Formula",
        about: "A figure from your own spreadsheet-style formula",
        icon: CalculatorIcon,
      },
      {
        to: "/reports/tags",
        label: "Tags",
        about: "Name and color the tags your notes use",
        icon: TagsIcon,
      },
    ],
  },
];

export const REPORT_LIBRARY = library.map((group) => ({
  ...group,
  reports: group.reports.filter((report) => isPageEnabled(report.to)),
}));

/** The address of a saved report: a custom one by `id`, any other on its type's page by `report`. */
export const savedReportPlace = (type: string, id: string) =>
  type === "custom"
    ? { to: "/reports/custom", search: { id } }
    : { to: `/reports/${type}`, search: { report: id } };
