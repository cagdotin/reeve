import {
  expectCount,
  expectEventually,
  expectHidden,
  expectVisible,
  test,
} from "../src/fixtures.ts";

for (const theme of ["light", "dark"] as const) {
  test(`the ${theme} footer keeps Docs and Shortcuts available with either sidebar width`, async ({
    app,
  }) => {
    const { page } = app;
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(`${app.url}/budget`);
    const footer = page.getByRole("contentinfo");
    const shortcuts = footer.getByRole("button", { name: "Shortcuts", exact: true });
    const docs = footer.getByRole("link", { name: "Docs", exact: true });
    const sidebar = page.getByRole("complementary", { name: "Sidebar" });
    await expectCount(sidebar.getByRole("link", { name: "Docs", exact: true }), 0);
    await expectEventually(() => shortcuts.innerText(), "");
    await expectEventually(() => docs.innerText(), "");

    for (const collapsed of [false, true]) {
      if (collapsed) await page.getByRole("button", { name: "Collapse sidebar" }).click();
      await shortcuts.hover();
      await expectVisible(page.locator('[data-slot="tooltip-popup"]').getByText("Shortcuts"));
      if (process.env["REEVE_FOOTER_SCREENSHOTS"]) {
        await page.waitForTimeout(250);
        await page.screenshot({
          path: `/tmp/reeve-footer-${theme}-${collapsed ? "folded" : "open"}.png`,
        });
      }
      await shortcuts.click();
      const dialog = page.getByRole("dialog", { name: "Shortcuts", exact: true });
      await expectVisible(dialog);
      await page.keyboard.press("Escape");
      await expectHidden(dialog);
      await page.mouse.move(700, 400);
      await shortcuts.focus();
      await page.keyboard.press("Tab");
      await expectVisible(page.locator('[data-slot="tooltip-popup"]').getByText("Docs"));
      await page.keyboard.press("Enter");
      await expectVisible(page.getByRole("heading", { name: "reeve docs", level: 1 }));
      await expectVisible(shortcuts);
      await page.getByRole("button", { name: "Back to app" }).click();
      await page.waitForURL(`${app.url}/budget`);
    }
  });

  test(`the ${theme} phone keeps its existing navigation instead of the desktop footer`, async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(`${app.url}/budget`);
    await expectVisible(
      page
        .getByRole("navigation", { name: "Pages" })
        .getByRole("link", { name: "Docs", exact: true }),
    );
    await expectCount(page.getByRole("contentinfo"), 0);
    await expectEventually(
      () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );
    if (process.env["REEVE_FOOTER_SCREENSHOTS"])
      await page.screenshot({ path: `/tmp/reeve-footer-${theme}-phone.png` });
  });
}
