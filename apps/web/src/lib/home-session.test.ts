import { describe, expect, it } from "vitest";
import { chooseDashboard, destinationPlace, rememberPlace, tabPlace } from "./home-session.ts";
import { DESTINATIONS } from "./nav.ts";

const home = DESTINATIONS.find((destination) => destination.id === "home")!;
const [dashboards, reports] = home.tabs as [(typeof home.tabs)[0], (typeof home.tabs)[0]];
const accounts = DESTINATIONS.find((destination) => destination.id === "accounts")!;

describe("where Home's tabs return", () => {
  it("starts at each tab's own page", () => {
    expect(tabPlace("fresh", dashboards)).toEqual({ to: "/", search: {} });
    expect(tabPlace("fresh", reports)).toEqual({ to: "/reports", search: {} });
    expect(destinationPlace("fresh", home)).toEqual({ to: "/", search: {} });
  });

  it("returns each tab to the page of it shown last, and Home to the last dashboard", () => {
    rememberPlace("a", dashboards, { to: "/", search: { dashboard: "bills" } });
    rememberPlace("a", reports, { to: "/reports/spending", search: { report: "r1" } });
    expect(tabPlace("a", reports)).toEqual({ to: "/reports/spending", search: { report: "r1" } });
    expect(destinationPlace("a", home)).toEqual({ to: "/", search: { dashboard: "bills" } });
  });

  it("keeps each book's places apart", () => {
    rememberPlace("b", reports, { to: "/reports/net-worth", search: {} });
    expect(tabPlace("c", reports)).toEqual({ to: "/reports", search: {} });
  });

  it("remembers nothing for a tab that does not resume", () => {
    const transactions = accounts.tabs[0]!;
    rememberPlace("a", transactions, { to: "/accounts/x", search: {} });
    expect(tabPlace("a", transactions)).toEqual({ to: transactions.to, search: {} });
  });
});

describe("chooseDashboard", () => {
  const pages = [
    { id: "main", isDefault: false },
    { id: "today", isDefault: true },
  ];

  it("shows the asked dashboard, else the default", () => {
    expect(chooseDashboard(pages, "main")).toEqual({ dashboard: pages[0], missing: false });
    expect(chooseDashboard(pages, undefined)).toEqual({ dashboard: pages[1], missing: false });
  });

  it("falls back to the default and says so when the asked one is gone", () => {
    expect(chooseDashboard(pages, "gone")).toEqual({ dashboard: pages[1], missing: true });
  });
});
