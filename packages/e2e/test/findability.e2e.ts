import { FEATURES } from "@reeve/contract/features";
import { today } from "@reeve/contract/rules";
import { DESTINATIONS } from "../../../apps/web/src/lib/nav.ts";
import { REPORT_LIBRARY } from "../../../apps/web/src/lib/report-library.ts";
import {
  expectCount,
  expectEventually,
  expectHidden,
  expectVisible,
  test,
} from "../src/fixtures.ts";
import type { App } from "../src/fixtures.ts";

const pathOf = async (url: string) => new URL(url).pathname;
const PHONE = { width: 390, height: 844 };

for (const [name, viewport] of [
  ["a computer", { width: 1440, height: 900 }],
  ["a phone", PHONE],
] as const)
  test(`on ${name}, every page is reachable by clicking from Home`, async ({ app }) => {
    const { page, run } = app;
    await run("create_account", { name: "Checking", balance: 100_000 });
    await page.setViewportSize(viewport);
    await page.goto(`${app.url}/`);
    const rail = page.getByRole("navigation", { name: "Pages" });
    const tabs = page.getByRole("navigation", { name: "Section" });

    const leaveLayer = async () => {
      const back = page.getByRole("button", { name: "Back to app" });
      if ((await back.count()) > 0) await back.click();
    };

    for (const destination of DESTINATIONS) {
      await leaveLayer();
      if (destination.id === "settings" && viewport.width >= 768) {
        await page.getByRole("button", { name: /^Book: / }).click();
        await page.getByRole("menuitem", { name: /^Settings/ }).click();
      } else if (destination.id === "docs" && viewport.width >= 768) {
        await page
          .getByRole("contentinfo")
          .getByRole("link", { name: destination.label, exact: true })
          .click();
      } else {
        await rail.getByRole("link", { name: destination.label, exact: true }).click();
      }
      await expectEventually(() => pathOf(page.url()), destination.to);
      for (const tab of destination.tabs) {
        await tabs.getByRole("link", { name: tab.label, exact: true }).click();
        await expectEventually(() => pathOf(page.url()), tab.to);
        await expectVisible(page.getByRole("heading", { level: 1 }));
      }
    }

    await leaveLayer();
    for (const report of REPORT_LIBRARY.flatMap((group) => group.reports)) {
      await rail.getByRole("link", { name: "Home", exact: true }).click();
      await tabs.getByRole("link", { name: "Reports", exact: true }).click();
      await page.getByRole("combobox", { name: /^Report: / }).click();
      await page.getByRole("option", { name: "All reports" }).click();
      await expectEventually(() => pathOf(page.url()), "/reports");
      await page
        .getByRole("main")
        .getByRole("link", { name: new RegExp(`^${report.label}`) })
        .click();
      await expectEventually(() => pathOf(page.url()), report.to);
    }
  });

test("every page and report is also a search away", async ({ app }) => {
  const { page, run } = app;
  await run("create_account", { name: "Checking", balance: 100_000 });
  await page.goto(`${app.url}/`);
  const input = page.getByPlaceholder(/Search pages, accounts/);
  const targets = [
    ...DESTINATIONS.flatMap((destination) =>
      destination.tabs.length > 0
        ? destination.tabs.map((tab) => ({ label: tab.label, to: tab.to }))
        : [{ label: destination.label, to: destination.to }],
    ),
    ...REPORT_LIBRARY.flatMap((group) =>
      group.reports.map((report) => ({ label: report.label, to: report.to })),
    ),
  ];
  await expectVisible(page.getByRole("button", { name: "Search and commands" }));
  for (const target of targets) {
    await page.keyboard.press("ControlOrMeta+k");
    await expectVisible(input);
    await input.fill(target.label);
    await page
      .getByRole("option", { name: new RegExp(`^${target.label}`) })
      .first()
      .click();
    await expectEventually(() => pathOf(page.url()), target.to);
    await expectHidden(input);
  }
});

const PAGES = [
  ...DESTINATIONS.flatMap((destination) =>
    destination.tabs.length > 0 ? destination.tabs.map((tab) => tab.to) : [destination.to],
  ),
  ...REPORT_LIBRARY.flatMap((group) => group.reports.map((report) => report.to)),
];

/** PAGES and the pages that show one row, so they need one to exist. */
const seedPages = async (run: App["run"]) => {
  const account = await run("create_account", { name: "Checking", balance: 100_000 });
  if (!FEATURES.purchases) return [...PAGES, `/accounts/${account.id}`];
  const product = await run("create_product", { name: "Milk" });
  const { receipt } = await run("create_receipt", {
    date: today(),
    payee: "Corner Grocer",
    total: 1_000,
    lines: [{ text: "Bread", lineTotal: 1_000 }],
  });
  return [
    ...PAGES,
    `/accounts/${account.id}`,
    `/products/${product.id}`,
    `/receipts/${receipt.id}`,
  ];
};

/** Elements other than the page's own scroller and the sidebar that scroll vertically. */
const nestedScrollers = () => {
  const frame = document
    .querySelector('[data-slot="page"]')
    ?.closest('[data-slot="scroll-area-viewport"]');
  const sidebar = document.querySelector('aside[aria-label="Sidebar"]');
  return [...document.querySelectorAll<HTMLElement>("body *")].filter((element) => {
    const scrolls = ["auto", "scroll"].includes(getComputedStyle(element).overflowY);
    return (
      element !== frame &&
      !sidebar?.contains(element) &&
      scrolls &&
      element.scrollHeight > element.clientHeight + 1
    );
  }).length;
};

/** How far the main's content sits from its padding on the left, right and top. */
const offEdges = () => {
  const main = document.querySelector("main")!;
  const style = getComputedStyle(main);
  const frame = main.getBoundingClientRect();
  const boxes = [...main.children]
    .map((child) => child.getBoundingClientRect())
    .filter((box) => box.width > 1);
  const left = Math.min(...boxes.map((box) => box.left)) - frame.left;
  const right = frame.right - Math.max(...boxes.map((box) => box.right));
  const top = Math.min(...boxes.map((box) => box.top)) - frame.top;
  return [
    left - parseFloat(style.paddingLeft),
    right - parseFloat(style.paddingRight),
    top - parseFloat(style.paddingTop),
  ]
    .map(Math.round)
    .join(" ");
};

/** Controls whose height is neither an input's (32) nor a table row's (24). */
const offScale = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      '[data-slot="button"], [data-slot="input-control"], [data-slot="select-trigger"], [data-slot="toggle-group"]',
    ),
  ]
    .filter((control) => control.getBoundingClientRect().height > 0)
    .filter((control) => ![32, 24].includes(control.getBoundingClientRect().height))
    .map(
      (control) =>
        `${control.getBoundingClientRect().height} ${control.dataset["slot"]} ${control.textContent?.slice(0, 24)}`,
    )
    .join(", ");

const scrollsSideways = () =>
  document.documentElement.scrollWidth > document.documentElement.clientWidth;

// One visit per page and size checks every layout rule, since loading the pages is the cost.
for (const [name, viewport] of [
  ["a computer", { width: 1440, height: 900 }],
  ["a phone", PHONE],
] as const)
  test(`on ${name}, every page has one scroller, no scroll bar, the shared content width and controls to scale`, async ({
    app,
  }) => {
    const { page, run } = app;
    const pages = await seedPages(run);
    await page.setViewportSize(viewport);
    for (const to of pages) {
      await page.goto(`${app.url}${to}`);
      await expectVisible(page.getByRole("heading", { level: 1 }));
      await expectCount(page.getByRole("main"), 1);
      await expectEventually(
        async () => `${to} ${await page.evaluate(nestedScrollers)}`,
        `${to} 0`,
      );
      await expectCount(page.locator('[data-slot="scroll-area-scrollbar"]'), 0);
      if (to !== "/budget")
        await expectEventually(async () => `${to} ${await page.evaluate(offEdges)}`, `${to} 0 0 0`);
      if (viewport === PHONE)
        await expectEventually(
          async () => `${to} ${await page.evaluate(scrollsSideways)}`,
          `${to} false`,
        );
      // A receipt's line rows are their own 28px grid of cells and selects (line-selects.tsx).
      else if (!to.startsWith("/receipts/"))
        await expectEventually(async () => `${to}: ${await page.evaluate(offScale)}`, `${to}: `);
    }
  });

test("the whole page scrolls under the header, wherever the pointer is", async ({ app }) => {
  const { page, run } = app;
  await run("create_account", { name: "Checking", balance: 100_000 });
  await page.setViewportSize({ width: 1440, height: 400 });
  await page.goto(`${app.url}/settings/general`);
  const tabs = page.getByRole("navigation", { name: "Section" });
  await expectVisible(tabs);
  const before = await tabs.boundingBox();
  const scrollTop = () =>
    page.evaluate(
      () =>
        document.querySelector('[data-slot="page"]')?.closest('[data-slot="scroll-area-viewport"]')
          ?.scrollTop ?? -1,
    );
  await page.mouse.move(1400, 300);
  await page.mouse.wheel(0, 300);
  await expectEventually(async () => (await scrollTop()) > 0, true);
  await expectEventually(async () => (await tabs.boundingBox())?.y === before?.y, true);
  await page.getByRole("button", { name: "Back to app" }).click();
  await expectEventually(scrollTop, 0);
});
