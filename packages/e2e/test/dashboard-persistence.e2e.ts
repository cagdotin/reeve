import { expectEventually, expectHidden, expectVisible, test } from "../src/fixtures.ts";

for (const viewport of ["desktop", "phone"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`saved report deletion discloses linked usage on ${viewport} in ${theme}`, async ({
      app,
    }) => {
      const { page, run } = app;
      await page.setViewportSize(
        viewport === "phone" ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      );
      await page.emulateMedia({ colorScheme: theme });
      const saved = await run("create_custom_report", { name: "Shared spending" });
      const dashboard = await run("create_dashboard_page", { name: "My dashboard" });
      const widget = await run("add_widget", {
        pageId: dashboard.id,
        type: "custom-report",
        reportId: saved.id,
        config: {
          version: 1,
          title: "Spending card",
          presentation: {},
          scope: { accounts: { mode: "inherit" } },
        },
      });
      await page.goto(`${app.url}/reports/custom?id=${saved.id}`);
      await page.getByRole("button", { name: "Saved", exact: true }).click();
      await page.getByRole("menuitem", { name: "Delete report…" }).click();
      const dialog = page.getByRole("alertdialog");
      await expectVisible(dialog.getByText("The report and its 1 linked widgets will be deleted."));
      await expectVisible(dialog.getByText("My dashboard: Spending card"));
      await expectEventually(
        async () =>
          (await run("get_saved_report_usage", { id: saved.id })).placements.map((p) => p.id),
        [widget.id],
      );
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expectHidden(dialog);
      await page.getByRole("button", { name: "Saved", exact: true }).click();
      await page.getByRole("menuitem", { name: "Delete report…" }).click();
      await expectVisible(dialog.getByText("My dashboard: Spending card"));
      await dialog.getByRole("button", { name: "Delete", exact: true }).click();
      await page.waitForURL(`${app.url}/reports`);
      await expectEventually(
        async () => (await run("list_custom_reports", {})).some((report) => report.id === saved.id),
        false,
      );
      await run("undo", {});
      await expectEventually(
        async () =>
          (await run("get_saved_report_usage", { id: saved.id })).placements.map((p) => p.id),
        [widget.id],
      );
      await expectEventually(
        () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
      );
    });
  }
}
