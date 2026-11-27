import { expectEventually, expectVisible, test } from "../src/fixtures.ts";

const surfaces = [
  ["light", "rgb(255, 255, 255)"],
  ["dark", "rgb(19, 20, 25)"],
] as const;

for (const [colorScheme, background] of surfaces) {
  test(`in ${colorScheme}, the page has its neutral surface and is set in Geist`, async ({
    app,
  }) => {
    const { page } = app;
    await page.emulateMedia({ colorScheme });
    await page.goto(`${app.url}/budget`);
    await expectVisible(page.getByRole("button", { name: /^To Budget/ }));

    await expectEventually(
      () =>
        page.evaluate(() => ({
          background: getComputedStyle(document.body).backgroundColor,
          font: [...document.fonts].some(
            (font) => font.family.includes("Geist Variable") && font.status === "loaded",
          ),
        })),
      { background, font: true },
    );
  });
}

test("a report's chart takes up room on the page", async ({ app }) => {
  const { page, run } = app;
  await run("create_account", { name: "Checking", balance: 100_000 });
  await page.goto(`${app.url}/reports/cash-flow`);
  const chart = page.locator(".recharts-responsive-container").first();
  await expectVisible(chart);
  await expectEventually(async () => ((await chart.boundingBox())?.height ?? 0) > 100, true);
});
