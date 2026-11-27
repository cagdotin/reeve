import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPageEnabled } from "@reeve/contract/features";
import { DESTINATIONS, destinationOf, leadOf, type PageLead } from "./nav.ts";

const tabs = (id: string) => ({ tabs: id });
const back = (to: string) => ({ back: to });
const NONE = "none";

type Lead = { readonly tabs: string } | { readonly back: string } | typeof NONE;

/** Every page route, with an address it answers to and what leads that page in the bar. */
const ROUTES: Readonly<Record<string, readonly [string, Lead]>> = {
  index: ["/", tabs("home")],
  "budget.index": ["/budget", NONE],
  "docs.$": ["/docs/rules/shell", NONE],
  "accounts.$account": ["/accounts/abc", tabs("accounts")],
  schedules: ["/schedules", tabs("accounts")],
  payees: ["/payees", tabs("accounts")],
  rules: ["/rules", tabs("accounts")],
  "reports.index": ["/reports", tabs("home")],
  "receipts.index": ["/receipts", tabs("purchases")],
  "products.index": ["/products", tabs("purchases")],
  "settings.$section": ["/settings/banks", tabs("settings")],
  "receipts.$receipt": ["/receipts/abc", back("/receipts")],
  "products.$product": ["/products/abc", back("/products")],
  "reports.tags": ["/reports/tags", tabs("home")],
  "reports.age-of-money": ["/reports/age-of-money", tabs("home")],
  "reports.balance-forecast": ["/reports/balance-forecast", tabs("home")],
  "reports.budget-analysis": ["/reports/budget-analysis", tabs("home")],
  "reports.calendar": ["/reports/calendar", tabs("home")],
  "reports.cash-flow": ["/reports/cash-flow", tabs("home")],
  "reports.crossover": ["/reports/crossover", tabs("home")],
  "reports.custom": ["/reports/custom", tabs("home")],
  "reports.formula": ["/reports/formula", tabs("home")],
  "reports.items": ["/reports/items", tabs("home")],
  "reports.monte-carlo": ["/reports/monte-carlo", tabs("home")],
  "reports.net-worth": ["/reports/net-worth", tabs("home")],
  "reports.sankey": ["/reports/sankey", tabs("home")],
  "reports.spending": ["/reports/spending", tabs("home")],
  "reports.summary": ["/reports/summary", tabs("home")],
};

const simple = (lead: PageLead): Lead =>
  lead.kind === "tabs" ? tabs(lead.destination.id) : lead.kind === "back" ? back(lead.to) : NONE;

describe("what leads a page in the bar", () => {
  it("names every page route", () => {
    const redirects = ["__root", "accounts.index", "settings.index", "reports.library"];
    const files = readdirSync(join(import.meta.dirname, "../routes"))
      .map((file) => file.replace(/\.tsx$/, ""))
      .filter((route) => !redirects.includes(route));
    expect(Object.keys(ROUTES).sort()).toEqual(files.sort());
  });

  it.each(Object.entries(ROUTES))("%s", (_route, [path, lead]) => {
    expect(simple(leadOf(path))).toEqual(isPageEnabled(path) ? lead : NONE);
  });

  it("keeps the tabs on every register's address", () => {
    expect(leadOf("/accounts/all").kind).toBe("tabs");
    expect(leadOf("/accounts/uncategorized").kind).toBe("tabs");
  });

  it("puts every report under Home, beside its dashboards, with no Reports destination", () => {
    expect(DESTINATIONS.map((destination) => destination.id)).not.toContain("reports");
    expect(destinationOf("/reports/spending")?.id).toBe("home");
    expect(destinationOf("/")?.tabs.map((tab) => tab.label)).toEqual(["Dashboards", "Reports"]);
  });

  it("gives every hotkey one place", () => {
    const keys = DESTINATIONS.flatMap((destination) => [
      destination.hotkey,
      ...destination.tabs.flatMap((tab) => (tab.hotkey === undefined ? [] : [tab.hotkey])),
    ]);
    expect(keys).toContain("r");
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("leads nothing where no destination holds the address", () => {
    expect(leadOf("/nowhere").kind).toBe("none");
  });
});
