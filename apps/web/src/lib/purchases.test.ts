import { FEATURES, isPageEnabled, isPurchasesPath } from "@reeve/contract/features";
import { describe, expect, it } from "vitest";
import { DESTINATIONS, destinationOf } from "./nav.ts";
import { requirePurchases } from "./purchases.ts";
import { REPORT_LIBRARY } from "./report-library.ts";

const paths = ["/receipts", "/receipts/old", "/products", "/products/old", "/reports/items"];

describe("the frozen purchases surface", () => {
  it("keeps purchases out of navigation, mobile destinations, shortcuts and report search", () => {
    expect(FEATURES.purchases).toBe(false);
    expect(DESTINATIONS.some((destination) => destination.id === "purchases")).toBe(false);
    expect(
      DESTINATIONS.flatMap((destination) => [
        destination.to,
        ...destination.tabs.map((tab) => tab.to),
      ]).some(isPurchasesPath),
    ).toBe(false);
    expect(
      REPORT_LIBRARY.flatMap((group) => group.reports).some((report) => isPurchasesPath(report.to)),
    ).toBe(false);
  });

  it.each(paths)("blocks %s, including direct links", (path) => {
    expect(isPageEnabled(path)).toBe(false);
    expect(destinationOf(path)).toBeUndefined();
    expect(requirePurchases).toThrow(expect.objectContaining({ isNotFound: true }));
  });

  it.each(["/accounts/all", "/budget", "/reports/spending", "/products-of-work"])(
    "keeps %s available",
    (path) => {
      expect(isPageEnabled(path)).toBe(true);
    },
  );
});
