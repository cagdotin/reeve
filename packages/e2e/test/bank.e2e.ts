import { afterEach, beforeEach } from "vitest";
import {
  line,
  startFakeBank,
  TEST_APP,
  TEST_KEY,
  type FakeBank,
} from "../../engine/test/fake-enable-banking.ts";
import { expectEventually, expectHidden, expectVisible, test } from "../src/fixtures.ts";

let fake: FakeBank;
const previous = process.env["REEVE_ENABLE_BANKING_URL"];

beforeEach(async () => {
  fake = await startFakeBank();
  process.env["REEVE_ENABLE_BANKING_URL"] = fake.url;
});

afterEach(async () => {
  await fake.close();
  if (previous === undefined) delete process.env["REEVE_ENABLE_BANKING_URL"];
  else process.env["REEVE_ENABLE_BANKING_URL"] = previous;
});

const keyFile = { name: "reeve.pem", mimeType: "text/plain", buffer: Buffer.from(TEST_KEY) };
const REDIRECT = "https://localhost/reeve";

test("a person sets up the key, links a bank and fetches through the settings page", async ({
  app,
}) => {
  const { page, run } = app;
  fake.sessionAccounts = [
    {
      uid: "erste-1",
      name: "Giro",
      currency: "EUR",
      iban: "AT611904300234573201",
      identification_hash: "erste-hash",
      lines: [
        line("e1", "2026-10-20", -1250, "Corner Grocer"),
        line("e2", "2026-10-21", 250000, "Acme Payroll"),
      ],
      balances: [{ type: "CLBD", amount: "2487.50" }],
    },
  ];

  await page.goto(`${app.url}/settings/banks`);
  await page.getByLabel("Application ID").fill(TEST_APP);
  await page.getByLabel("Private key (.pem file)").setInputFiles(keyFile);
  await page.getByRole("button", { name: "Save" }).click();

  await page.getByRole("button", { name: "Add a bank…" }).click();
  const choose = page.getByRole("dialog", { name: "Add a bank" });
  await choose.getByLabel("Find a bank").fill("erste");
  await choose.getByRole("button", { name: "Erste Bank" }).click();

  const approve = page.getByRole("dialog", { name: "Approve at Erste Bank" });
  const bankUrl = await approve.getByRole("link", { name: "Open Erste Bank" }).getAttribute("href");
  const state = new URL(bankUrl ?? "").searchParams.get("state");
  await approve
    .getByLabel("Address you landed on")
    .fill(`${REDIRECT}?code=good-code&state=${state}`);
  await approve.getByRole("button", { name: "Continue" }).click();

  const accounts = page.getByRole("dialog", { name: "Link accounts at Erste Bank" });
  await accounts.getByRole("combobox", { name: "Feed from Giro" }).click();
  await page.getByRole("option", { name: "A new account" }).click();
  await accounts.getByLabel("First day to take").fill("2026-10-01");
  await accounts.getByRole("button", { name: "Link and fetch" }).click();
  await expectHidden(accounts);

  await expectVisible(page.getByText("Bank says 2,487.50, cleared here 2,487.50"));
  const listed = await run("list_accounts", {});
  const giro = listed.find((account) => account.name === "Giro");
  await expectEventually(async () => giro?.balance, 248_750);

  await page.goto(`${app.url}/accounts/${giro?.id}`);
  await expectVisible(page.getByRole("button", { name: "Corner Grocer", exact: true }));

  fake.sessionAccounts[0]!.lines.push(line("e3", "2026-10-22", -100, "Kiosk"));
  await page.getByRole("button", { name: "Fetch from bank" }).click();
  await expectVisible(page.getByText("Fetched: 1 new, 0 updated"));
  await expectVisible(page.getByRole("button", { name: "Kiosk", exact: true }));
  await expectVisible(page.getByText("-1.00 off the bank"));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${app.url}/settings/banks`);
  await expectVisible(page.getByRole("button", { name: "Fetch Giro" }));
  await expectEventually(
    () => page.evaluate(() => document.documentElement.scrollWidth <= 390),
    true,
  );
});

test("an ended consent shows on the account, and renewing it keeps the link", async ({ app }) => {
  const { page, run } = app;
  fake.sessionAccounts = [
    { uid: "r-1", name: "Main", currency: "EUR", identification_hash: "rev", lines: [] },
  ];
  await run("set_bank_credentials", {
    applicationId: TEST_APP,
    key: TEST_KEY,
    redirectUrl: REDIRECT,
  });
  const begun = await run("begin_bank_link", { bank: "Revolut", country: "AT" });
  const state = new URL(begun.url).searchParams.get("state");
  const connection = await run("complete_bank_link", {
    redirectUrl: `${REDIRECT}?code=good-code&state=${state}`,
  });
  const link = await run("link_bank_account", {
    connection: connection.id,
    providerAccount: connection.accounts[0]!.id,
    name: "Revolut",
  });

  fake.failure = {
    status: 401,
    body: { error: "EXPIRED_SESSION", message: "Session expired" },
  };
  await page.goto(`${app.url}/accounts/${link.account}`);
  await page.getByRole("button", { name: "Fetch from bank" }).click();
  const alerts = page.locator('[data-slot="page-alerts"]');
  await expectVisible(alerts.getByRole("status").getByText("The consent at Revolut has ended"));
  await page.getByRole("button", { name: /^Accounts shown: / }).click();
  await expectVisible(
    page.getByRole("menuitemradio", { name: /^Revolut.*The consent at Revolut has ended/ }),
  );
  await page.keyboard.press("Escape");
  fake.failure = null;

  await alerts.getByRole("link", { name: "Open Banks" }).click();
  await page.getByRole("button", { name: "Renew…" }).click();
  const approve = page.getByRole("dialog", { name: "Approve at Revolut" });
  const again = await approve.getByRole("link", { name: "Open Revolut" }).getAttribute("href");
  await approve
    .getByLabel("Address you landed on")
    .fill(`${REDIRECT}?code=good-code&state=${new URL(again ?? "").searchParams.get("state")}`);
  await approve.getByRole("button", { name: "Continue" }).click();
  const map = page.getByRole("dialog", { name: "Link accounts at Revolut" });
  await expectVisible(map.getByText("Feeds Revolut"));
  await map.getByRole("button", { name: "Done" }).click();

  await expectHidden(page.getByText("The consent at Revolut has ended"));
  await expectEventually(async () => {
    const status = await run("bank_status", {});
    return [status.connections.length, status.links[0]?.status];
  }, [1, "ok"]);
});

test("two banks' sides of one movement become one transfer from the register", async ({ app }) => {
  const { page, run } = app;
  const erste = await run("create_account", { name: "Erste", balance: 50_000 });
  const revolut = await run("create_account", { name: "Revolut", balance: 0 });
  await run("create_transaction", {
    account: erste.id,
    date: "2026-10-05",
    amount: -10_000,
    payee: "To Revolut",
  });
  await run("create_transaction", {
    account: revolut.id,
    date: "2026-10-05",
    amount: 10_000,
    payee: "From Erste",
  });

  await page.goto(`${app.url}/accounts/all`);
  await expectVisible(page.getByRole("button", { name: "To Revolut", exact: true }));
  for (const payee of ["To Revolut", "From Erste"])
    await page
      .locator(".group\\/row", { has: page.getByRole("button", { name: payee, exact: true }) })
      .getByRole("checkbox", { name: "Select" })
      .click({ force: true });
  await page.getByRole("button", { name: "Make transfer" }).click();

  await expectHidden(page.getByRole("button", { name: "Make transfer" }));
  await expectEventually(async () => {
    const accounts = await run("list_accounts", {});
    const lines = await run("list_transactions", { account: revolut.id });
    return [
      accounts.find((each) => each.id === revolut.id)?.balance,
      accounts.find((each) => each.id === erste.id)?.balance,
      lines.total,
    ];
  }, [10_000, 40_000, 1]);
});

test("a fetch that brings a look-alike payee points at it from the account", async ({ app }) => {
  const { page, run } = app;
  fake.sessionAccounts = [
    { uid: "g-1", name: "Giro", currency: "EUR", identification_hash: "giro", lines: [] },
  ];
  await run("set_bank_credentials", {
    applicationId: TEST_APP,
    key: TEST_KEY,
    redirectUrl: REDIRECT,
  });
  const giro = await run("create_account", { name: "Giro", balance: 50_000 });
  const cash = await run("create_account", { name: "Cash", balance: 10_000 });
  const spend = (account: string, payee: string) =>
    run("create_transaction", { account, date: "2026-10-20", amount: -1_000, payee });
  await spend(giro.id, "Spar");
  await spend(giro.id, "Spar");
  await spend(cash.id, "Trafik");
  await spend(cash.id, "Trafik Otto");
  const begun = await run("begin_bank_link", { bank: "Erste Bank", country: "AT" });
  const state = new URL(begun.url).searchParams.get("state");
  const connection = await run("complete_bank_link", {
    redirectUrl: `${REDIRECT}?code=good-code&state=${state}`,
  });
  await run("link_bank_account", {
    connection: connection.id,
    providerAccount: connection.accounts[0]!.id,
    account: giro.id,
    historyStart: "2026-10-01",
  });

  await page.goto(`${app.url}/accounts/${giro.id}`);
  await expectVisible(page.getByRole("button", { name: "Spar", exact: true }).first());
  const review = page.getByRole("button", { name: "Review" });
  await expectHidden(review);

  fake.sessionAccounts[0]!.lines.push(line("g1", "2026-10-22", -500, "Spar Dankt"));
  await page.getByRole("button", { name: "Fetch from bank" }).click();
  await expectVisible(page.getByText("1 group of payees look like one"));
  await review.click();
  await page
    .getByRole("region", { name: "Payees like Spar" })
    .getByRole("button", { name: "Merge into Spar" })
    .click();
  await expectVisible(page.getByText("Nothing left to review."));
  await page.getByRole("button", { name: "Done" }).click();
  await expectHidden(review);

  await page.goto(`${app.url}/accounts/${cash.id}`);
  await expectVisible(page.getByText("1 group of payees look like one"));
  const names = async () =>
    (await run("list_payees", {})).map((payee: { name: string }) => payee.name).join(", ");
  await expectEventually(names, "Spar, Starting Balance, Trafik, Trafik Otto");
});

test("deleting a bank line says what it costs, offers the copy entered by hand, and Left out brings it back", async ({
  app,
}) => {
  const { page, run } = app;
  fake.sessionAccounts = [
    {
      uid: "g-1",
      name: "Giro",
      currency: "EUR",
      identification_hash: "giro",
      lines: [
        line("g0", "2026-10-01", 100_000, "Acme Payroll"),
        line("g1", "2026-10-20", -1250, "Corner Grocer"),
        line("g2", "2026-10-22", -100, "Kiosk"),
      ],
      balances: [{ type: "CLBD", amount: "986.50" }],
    },
  ];
  await run("set_bank_credentials", {
    applicationId: TEST_APP,
    key: TEST_KEY,
    redirectUrl: REDIRECT,
  });
  const begun = await run("begin_bank_link", { bank: "Erste Bank", country: "AT" });
  const state = new URL(begun.url).searchParams.get("state");
  const connection = await run("complete_bank_link", {
    redirectUrl: `${REDIRECT}?code=good-code&state=${state}`,
  });
  const link = await run("link_bank_account", {
    connection: connection.id,
    providerAccount: connection.accounts[0]!.id,
    name: "Giro",
    historyStart: "2026-10-01",
  });
  await run("sync_bank_accounts", { account: link.account });
  await run("create_transaction", {
    account: link.account,
    date: "2026-10-19",
    amount: -1250,
    payee: "Grocer by hand",
  });

  const select = (payee: string) =>
    page
      .locator(".group\\/row", { has: page.getByRole("button", { name: payee, exact: true }) })
      .getByRole("checkbox", { name: "Select" })
      .click({ force: true });
  await page.goto(`${app.url}/accounts/${link.account}`);
  await expectVisible(page.getByRole("button", { name: "Corner Grocer", exact: true }));

  await select("Corner Grocer");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Delete a transaction from the bank?" });
  await expectVisible(dialog.getByText(/It came from Erste Bank/));
  await expectVisible(dialog.getByText(/Giro will be 12\.50 off the bank\./));
  await expectVisible(dialog.getByText(/It looks like Grocer by hand on .*, entered by hand/));
  await expectVisible(dialog.getByText(/Left out… in Settings → Banks brings a deleted line back/));
  await dialog.getByRole("button", { name: "Merge" }).click();
  await expectHidden(dialog);
  await expectHidden(page.getByRole("button", { name: "Corner Grocer", exact: true }));
  await expectVisible(page.getByRole("button", { name: "Grocer by hand", exact: true }));
  await expectHidden(page.getByText("off the bank"));

  await select("Kiosk");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expectVisible(dialog.getByText(/Giro will be 1\.00 off the bank\./));
  await expectHidden(dialog.getByRole("button", { name: "Merge" }));
  await dialog.getByRole("button", { name: "Delete anyway" }).click();
  await expectHidden(page.getByRole("button", { name: "Kiosk", exact: true }));
  await expectVisible(page.getByText("1.00 off the bank"));

  await page.goto(`${app.url}/settings/banks`);
  await page.getByRole("button", { name: "Left out…" }).click();
  const leftOut = page.getByRole("dialog", { name: "Lines left out of Giro" });
  await expectVisible(leftOut.getByText("Kiosk"));
  await leftOut.getByRole("button", { name: "Let back" }).click();
  await expectVisible(leftOut.getByText("Nothing left out."));
  await expectEventually(
    async () => (await run("list_transactions", { account: link.account })).total,
    3,
  );
  await expectVisible(page.getByText("Bank says 986.50, cleared here 986.50"));
});
