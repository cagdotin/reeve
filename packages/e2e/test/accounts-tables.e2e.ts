import { today } from "@reeve/contract/rules";
import { test, expectEventually, expectHidden, expectVisible } from "../src/fixtures.ts";

for (const width of [1440, 390]) {
  test(`Accounts tables fill the page and editors open in the frame panel at ${width}px`, async ({
    app,
  }) => {
    const { page, run } = app;
    await page.setViewportSize({ width, height: 844 });
    await run("create_account", { name: "Checking", balance: 100_000 });
    const account = await run("create_account", { name: "Spending" });
    await run("create_payee", { name: "Grocer" });
    await run("create_transaction", {
      account: account.id,
      date: today(),
      amount: -100,
      payee: "Grocer",
    });
    for (const [address, action, title, searchLabel] of [
      ["/accounts/all", "Add transaction", "New transaction", "Search transactions"],
      ["/payees", "New payee", "New payee", "Search payees"],
      ["/rules", "New rule", "New rule", "Search rules"],
      ["/schedules", "New schedule", "New schedule", "Search schedules"],
    ] as const) {
      await page.goto(`${app.url}${address}`);
      await expectVisible(page.getByRole("button", { name: action, exact: true }));
      await expectEventually(
        () =>
          page.getByRole("main").evaluate((main) => {
            const style = getComputedStyle(main);
            return [style.paddingLeft, style.paddingRight, style.paddingTop, style.maxWidth];
          }),
        ["0px", "0px", "0px", "none"],
      );
      if (address === "/accounts/all") {
        await expectEventually(
          () =>
            page.getByLabel("Balances", { exact: true }).evaluate((balances) => {
              const style = getComputedStyle(balances);
              return [style.paddingLeft, style.paddingRight];
            }),
          ["12px", "12px"],
        );
      }
      await expectEventually(
        () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      const search = page.getByRole("searchbox", { name: searchLabel });
      await expectVisible(search);
      await expectEventually(() => search.getAttribute("placeholder"), "Search");
      await expectEventually(
        () =>
          search.evaluate((input) => {
            const main = input.closest("main")!.getBoundingClientRect();
            const box = input.getBoundingClientRect();
            return box.left - main.left >= 12 && main.right - box.right >= 12;
          }),
        true,
      );
      await page.getByRole("button", { name: "Filter", exact: true }).click();
      await expectVisible(page.getByRole("group", { name: "Filters", exact: true }));
      await page.keyboard.press("Escape");
      await expectHidden(page.getByRole("group", { name: "Filters", exact: true }));
      await page.getByRole("button", { name: action, exact: true }).click();
      const panel = page.getByRole("region", { name: "Panel", exact: true });
      await expectVisible(panel.getByRole("heading", { name: title, exact: true }));
      await expectEventually(() => page.getByRole("dialog").count(), 0);
      await expectEventually(
        () => panel.evaluate((element) => element.scrollWidth <= element.clientWidth),
        true,
      );
      await expectEventually(
        () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await panel.getByRole("button", { name: "Close panel" }).click();
      await expectHidden(panel);
    }
    await page.goto(`${app.url}/payees`);
    await page.getByRole("button", { name: "Grocer", exact: true }).click();
    await expectVisible(
      page.getByRole("region", { name: "Panel" }).getByRole("heading", { name: "Edit Grocer" }),
    );
    await page.keyboard.press("Escape");
    await expectHidden(page.getByRole("region", { name: "Panel" }));
  });
}
