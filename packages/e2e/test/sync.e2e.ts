import { today } from "@reeve/contract/rules";
import { expectHidden, expectVisible, test } from "../src/fixtures.ts";
import type { App } from "../src/fixtures.ts";

const status = (app: App, label: RegExp) =>
  app.page.getByRole("contentinfo").getByRole("button", { name: label });

test("the page follows changes live, and resyncs after losing its connection", async ({ app }) => {
  const { page, run, url } = app;
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  const spend = (payee: string) =>
    run("create_transaction", { account: checking.id, date: today(), amount: -1_000, payee });

  await page.goto(`${url}/accounts`);
  await expectVisible(status(app, /^Live/));

  await spend("Grocer");
  await expectVisible(page.getByRole("main").getByText("Grocer"));

  await page.context().setOffline(true);
  await expectVisible(page.getByText("This page lost its connection"));
  await expectVisible(status(app, /^Offline/));
  await spend("Bakery");

  await page.route("**/api/events", (route) => route.abort());
  await page.context().setOffline(false);
  await expectVisible(page.getByText("Reconnecting…"));

  await page.unroute("**/api/events");
  await expectVisible(status(app, /^Live/));
  await expectHidden(page.getByText("Reconnecting…"));
  await expectVisible(page.getByRole("main").getByText("Bakery"));
});
