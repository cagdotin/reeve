import { addDays, today } from "@reeve/contract/rules";
import { afterEach, beforeEach } from "vitest";
import {
  line,
  startFakeBank,
  TEST_APP,
  TEST_KEY,
  type FakeAccount,
  type FakeBank,
} from "../../engine/test/fake-enable-banking.ts";
import { expectHidden, expectVisible, openAccount, test, type App } from "../src/fixtures.ts";

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

const REDIRECT = "https://localhost/reeve";
const day = (back: number) => addDays(today(), -back);

/** Links each account at a fake bank to a new ledger account and fetches it, as a person would. */
const linkAndFetch = async (
  run: App["run"],
  bank: string,
  accounts: ReadonlyArray<FakeAccount>,
) => {
  await run("set_bank_credentials", {
    applicationId: TEST_APP,
    key: TEST_KEY,
    redirectUrl: REDIRECT,
  });
  fake.sessionAccounts = [...accounts];
  const begun = await run("begin_bank_link", { bank, country: "AT" });
  const state = new URL(begun.url).searchParams.get("state");
  const connection = await run("complete_bank_link", {
    redirectUrl: `${REDIRECT}?code=good-code&state=${state}`,
  });
  const ids: Array<string> = [];
  for (const account of accounts) {
    const link = await run("link_bank_account", {
      connection: connection.id,
      providerAccount: account.uid,
      name: account.name ?? account.uid,
      historyStart: day(60),
    });
    await run("sync_bank_accounts", { account: link.account });
    ids.push(link.account);
  }
  return ids;
};

test("a rule on the counterparty's account renames what was fetched", async ({ app }) => {
  const { page, run } = app;
  await linkAndFetch(run, "Erste Bank", [
    {
      uid: "erste-1",
      name: "Giro",
      iban: "AT001",
      lines: [
        line("e1", day(5), -90_000, "Hausverwaltung", {
          creditor_account: { iban: "AT611904300234573201" },
        }),
      ],
    },
  ]);

  await page.goto(`${app.url}/rules`);
  await page.getByRole("button", { name: "New rule" }).click();
  const editor = page.getByRole("region", { name: "Panel" });
  await editor.getByRole("combobox", { name: "Condition field" }).click();
  await page.getByRole("option", { name: "Counterparty account" }).click();
  await editor
    .getByRole("textbox", { name: "Value", exact: true })
    .fill("AT61 1904 3002 3457 3201");
  await expectVisible(editor.getByText("1 existing transaction matches."));
  await editor.getByRole("combobox", { name: "Action field" }).click();
  await page.getByRole("option", { name: "Payee name" }).click();
  await editor.getByRole("textbox", { name: "New value" }).fill("Landlord");
  await editor.getByRole("button", { name: "Save and apply" }).click();
  await expectHidden(editor);
  await expectVisible(page.getByText("Applied the rule to 1 transaction"));

  await openAccount(page, "Giro", "-900.00");
  await expectVisible(page.getByRole("button", { name: "Landlord", exact: true }));
});

test("an account number's suggested rule takes one click, and dismissing it stays", async ({
  app,
}) => {
  const { page, run } = app;
  const landlord = { creditor_account: { iban: "AT611904300234573201" } };
  const gym = { creditor_account: { iban: "AT99GYM" } };
  await linkAndFetch(run, "Erste Bank", [
    {
      uid: "erste-1",
      name: "Giro",
      iban: "AT001",
      lines: [
        line("e1", day(40), -90_000, "Hausverwaltung", landlord),
        line("e2", day(10), -90_000, "Hausverwaltung", landlord),
        line("g1", day(30), -4_000, "Gym", gym),
        line("g2", day(5), -4_000, "Gym", gym),
      ],
    },
  ]);

  await page.goto(`${app.url}/rules`);
  await expectVisible(page.getByText("2 account numbers worth a rule"));
  await page.getByRole("button", { name: "Review" }).last().click();
  const dialog = page.getByRole("dialog", { name: "Account numbers worth a rule" });
  const rent = dialog.getByRole("region", { name: "Account AT611904300234573201" });
  await rent.getByRole("button", { name: "Rule: always Hausverwaltung" }).click();
  await expectHidden(rent);
  await dialog
    .getByRole("region", { name: "Account AT99GYM" })
    .getByRole("button", { name: "Dismiss" })
    .click();
  await expectVisible(dialog.getByText("Nothing left to review."));
  await dialog.getByRole("button", { name: "Done" }).click();
  await expectVisible(page.getByRole("button", { name: /AT611904300234573201/ }));

  await page.reload();
  await expectVisible(page.getByRole("button", { name: /AT611904300234573201/ }));
  await expectHidden(page.getByText(/account numbers? worth a rule/));
});

test("lines to the person's own account become transfers in one click", async ({ app }) => {
  const { page, run } = app;
  await linkAndFetch(run, "Erste Bank", [
    {
      uid: "erste-1",
      name: "Giro",
      iban: "AT001",
      lines: [line("e1", day(3), -10_000, "Revolut", { creditor_account: { iban: "LT123456" } })],
    },
  ]);
  await linkAndFetch(run, "Revolut", [
    {
      uid: "revolut-1",
      name: "Main",
      iban: "LT12 3456",
      lines: [line("r1", day(2), 10_000, "Top-up", { debtor_account: { iban: "AT001" } })],
    },
  ]);

  await page.goto(`${app.url}/rules`);
  await expectVisible(page.getByText("2 account numbers worth a rule"));
  await page.getByRole("button", { name: "Review" }).last().click();
  const dialog = page.getByRole("dialog", { name: "Account numbers worth a rule" });
  await dialog.getByRole("button", { name: "Make transfers to Main" }).click();
  await expectVisible(dialog.getByText("Nothing left to review."));
  await dialog.getByRole("button", { name: "Done" }).click();

  await openAccount(page, "Giro", "-100.00");
  await expectVisible(page.getByRole("button", { name: "Transfer: Main", exact: true }));
});
