import type { DashboardPage, SavedReport, Widget } from "@reeve/contract/catalog";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
beforeEach(() => {
  s = scratch();
});
afterEach(() => s.dispose());

/**
 * Checking (1,000.00) and a Visa card on budget, a Brokerage (5,000.00) off budget. In February:
 * Grocer takes 200.00 of Food from Checking, the card pays 300.00 of Food, Power takes 50.00 of
 * Bills from Checking, and Checking pays the card 100.00.
 */
const setup = async (name = "Scope") => {
  const book = (await s.call("create_book", { name })).id as string;
  const groups = await s.call("list_categories", { book });
  const category = (label: string) =>
    groups.flatMap((g: any) => g.categories).find((c: any) => c.name === label);
  const food = category("Food");
  const bills = category("Bills");
  const checking = await s.call("create_account", {
    book,
    name: "Checking",
    balance: 100000,
    date: "2026-01-01",
  });
  const card = await s.call("create_account", { book, name: "Visa", type: "liability" });
  const brokerage = await s.call("create_account", {
    book,
    name: "Brokerage",
    onBudget: false,
    balance: 500000,
    date: "2026-01-01",
  });
  const tx = (input: Record<string, unknown>) =>
    s.call("create_transaction", { book, account: checking.id, ...input });
  await tx({ date: "2026-02-10", amount: -20000, payee: "Grocer", category: food.id });
  await tx({ date: "2026-02-12", amount: -30000, account: card.id, category: food.id });
  await tx({ date: "2026-02-15", amount: -5000, payee: "Power", category: bills.id });
  await tx({ date: "2026-02-20", amount: -10000, transferAccount: card.id });
  const payees = await s.call("list_payees", { book });
  const grocer = payees.find((p: any) => p.name === "Grocer").id as string;
  return { book, food, bills, checking, card, brokerage, grocer };
};

const february = { start: "2026-02", end: "2026-02", mode: "static" };
const only = (...ids: Array<string>) => ({ mode: "selected", ids });

describe("account scope on reports", () => {
  it("narrows an or group of conditions instead of joining it", async () => {
    const { book, card, checking, grocer } = await setup();
    const conditions = [
      { field: "account", op: "is", value: card.id },
      { field: "payee", op: "is", value: grocer },
    ];
    const total = async (scope?: unknown) =>
      (
        await s.call("summary_report", {
          book,
          ...february,
          conditions,
          conditionsOp: "or",
          ...(scope === undefined ? {} : { scope }),
        })
      ).total;
    // The card's purchase and its payment from Checking, then Grocer's line on Checking.
    expect(await total()).toBe(-30000 + 10000 - 20000);
    expect(await total(only(checking.id)), "only Grocer's line is on Checking").toBe(-20000);
    expect(await total({ mode: "offbudget" }), "nothing off budget matches").toBe(0);
  });

  it("keeps each report to the accounts in scope", async () => {
    const { book, checking, card, brokerage } = await setup();
    const worth = await s.call("net_worth_report", {
      book,
      ...february,
      scope: { mode: "budgeted" },
    });
    // Checking: 1,000 - 200 - 50 - 100; the card: -300 + 100.
    expect(worth.netWorth).toBe(65000 - 20000);
    expect(worth.accounts.map((a: any) => a.id)).toEqual([checking.id, card.id]);
    const off = await s.call("net_worth_report", {
      book,
      ...february,
      scope: { mode: "offbudget" },
    });
    expect(off.netWorth).toBe(500000);
    expect(off.accounts.map((a: any) => a.id)).toEqual([brokerage.id]);

    const flow = await s.call("cash_flow_report", { book, ...february, scope: only(checking.id) });
    expect(flow.totalExpenses).toBe(-25000);
    expect(flow.totalTransfers).toBe(-10000);
    expect(
      (await s.call("cash_flow_report", { book, ...february, scope: { mode: "offbudget" } }))
        .totalExpenses,
      "cash flow covers budget accounts, so an off-budget scope leaves nothing",
    ).toBe(0);

    const days = await s.call("calendar_report", { book, ...february, scope: only(card.id) });
    const expenses = days.months.flatMap((m: any) =>
      m.days.flatMap((d: any) => (d.expense === undefined ? [] : [d.expense])),
    );
    expect(expenses.reduce((a: number, b: number) => a + b, 0)).toBe(30000);
  });

  it("reconciles a scoped spending figure with the transactions behind it", async () => {
    const { book, food, checking } = await setup();
    const scope = only(checking.id);
    const spending = await s.call("spending_report", { book, compare: "2026-02", scope });
    const figure = spending.categories.find((c: any) => c.id === food.id).compare;
    expect(figure, "the card's 300.00 of Food is outside Checking").toBe(-20000);
    const behind = await s.call("spending_transactions", {
      book,
      category: food.id,
      month: "2026-02",
      scope,
    });
    expect(behind.total).toBe(figure);
    expect(behind.rows.map((r: any) => r.row.accountId)).toEqual([checking.id]);
  });

  it("shows nothing, never everything, when the scope's accounts are gone", async () => {
    const { book } = await setup();
    const gone = only("no-such-account");
    expect((await s.call("summary_report", { book, ...february, scope: gone })).total).toBe(0);
    const worth = await s.call("net_worth_report", { book, ...february, scope: gone });
    expect(worth).toMatchObject({ netWorth: 0, accounts: [] });
    const forecast = await s.call("balance_forecast_report", { book, scope: gone });
    expect(forecast.chartData).toEqual([]);
  });

  it("treats a scope as account conditions in age of money and the balance forecast", async () => {
    const { book, checking, brokerage } = await setup();
    const byScope = await s.call("age_of_money_report", {
      book,
      ...february,
      scope: only(checking.id),
    });
    const byCondition = await s.call("age_of_money_report", {
      book,
      ...february,
      conditions: [{ field: "account", op: "is", value: checking.id }],
    });
    expect(byScope, "the payment to the card leaves Checking in both").toEqual(byCondition);

    const scoped = await s.call("balance_forecast_report", { book, scope: { mode: "offbudget" } });
    const picked = await s.call("balance_forecast_report", { book, accounts: [brokerage.id] });
    expect(scoped.lines).toEqual(picked.lines);
    const narrowed = await s.call("balance_forecast_report", {
      book,
      accounts: [brokerage.id],
      scope: only(checking.id),
    });
    expect(narrowed.chartData, "a scope narrows the chosen accounts, never widens them").toEqual(
      [],
    );
    expect(
      (
        await s.fails("balance_forecast_report", {
          book,
          source: "tracking-budget",
          scope: { mode: "budgeted" },
        })
      )._tag,
    ).toBe("InvalidRequest");
  });

  it("runs a saved custom report in its own scope unless the caller gives one", async () => {
    const { book, checking } = await setup();
    const settings = {
      dateRange: "All time",
      startDate: "2026-02-01",
      endDate: "2026-02-28",
      isDateStatic: true,
      balanceType: "Payment",
    };
    const saved = await s.call<SavedReport>("create_saved_report", {
      book,
      name: "Checking spending",
      definition: { version: 1, type: "custom", settings, scope: { accounts: only(checking.id) } },
    });
    expect((await s.call("run_custom_report", { book, id: saved.id })).totalDebts).toBe(-35000);
    expect(
      (await s.call("run_custom_report", { book, id: saved.id, scope: { mode: "all" } }))
        .totalDebts,
    ).toBe(-65000);
    expect(
      (
        await s.fails("run_custom_report", {
          book,
          balanceType: "Budgeted",
          scope: { mode: "budgeted" },
        })
      )._tag,
    ).toBe("InvalidRequest");
    expect(
      (
        await s.fails("create_saved_report", {
          book,
          name: "Scoped crossover",
          definition: {
            version: 1,
            type: "crossover",
            settings: {},
            scope: { accounts: { mode: "budgeted" } },
          },
        })
      )._tag,
      "crossover has no account scope to follow",
    ).toBe("InvalidRequest");
  });
});

const config = (scope: unknown = { mode: "inherit" }) => ({
  version: 1,
  title: null,
  presentation: {},
  scope: { accounts: scope },
});
const netWorth = async (book: string, name = "Worth") =>
  s.call<SavedReport>("create_saved_report", {
    book,
    name,
    definition: {
      version: 1,
      type: "net-worth",
      settings: {},
      scope: { accounts: { mode: "all" } },
    },
  });
const embed = (book: string, reportId: string, host = "transactions", scope?: unknown) =>
  s.call<Widget>("add_page_widget", {
    book,
    host,
    type: "net-worth-card",
    reportId,
    config: config(scope),
  });
const stack = async (book: string, host = "transactions") =>
  (await s.call("list_page_widgets", { book, host })).widgets as Array<Widget>;

describe("page widgets", () => {
  it("reads an absent arrangement as empty without writing", async () => {
    const { book } = await setup();
    expect(await stack(book)).toEqual([]);
    expect(await stack(book, "payees")).toEqual([]);
    expect((await s.fails("list_page_widgets", { book, host: "rules" }))._tag).toBe(
      "InvalidRequest",
    );
    await s.call("undo", { book });
    expect(
      (await s.call("list_accounts", { book })).some((a: any) => a.name === "Brokerage"),
      "the read wrote no undo step, so undo took back the last transaction write instead",
    ).toBe(true);
  });

  it("keeps one stack per page and book, apart from the dashboards", async () => {
    const { book, checking } = await setup();
    const other = (await s.call("create_book", { name: "Other" })).id as string;
    const worth = await netWorth(book);
    const first = await embed(book, worth.id);
    const fixed = await embed(book, worth.id, "transactions", {
      mode: "fixed",
      value: only(checking.id),
    });
    await embed(book, worth.id, "payees");
    expect(first).toMatchObject({ availability: "available", x: 0, y: 0, width: 12, height: 1 });
    expect(fixed).toMatchObject({
      availability: "available",
      y: 1,
      config: { scope: { accounts: { mode: "fixed", value: only(checking.id) } } },
    });
    expect((await stack(book)).map((w) => w.id)).toEqual([first.id, fixed.id]);
    expect(await stack(book, "payees")).toHaveLength(1);
    expect(await stack(other)).toEqual([]);
    const pages = await s.call<DashboardPage[]>("list_dashboard_pages", { book });
    expect(pages.flatMap((p) => p.widgets).some((w) => w.id === first.id)).toBe(false);
    expect(
      (await s.fails("rename_dashboard_page", { book, id: first.pageId, name: "X" }))._tag,
    ).toBe("InvalidRequest");
  });

  it("takes only reports that follow accounts, three at most", async () => {
    const { book } = await setup();
    const worth = await netWorth(book);
    const names = async () =>
      (await s.call("list_saved_reports", { book })).map((r: any) => r.name);
    const before = await names();
    const refused = async (input: Record<string, unknown>) =>
      (await s.fails("add_page_widget", { book, host: "transactions", ...input }))._tag;
    expect(await refused({ type: "budget-analysis-card", report: {} })).toBe("InvalidRequest");
    expect(await refused({ type: "crossover-card", report: {} })).toBe("InvalidRequest");
    expect(await refused({ type: "home-insight", config: { ...config(), settings: {} } })).toBe(
      "InvalidRequest",
    );
    expect(
      await refused({ type: "custom-report", report: { settings: { balanceType: "Budgeted" } } }),
      "a budgeted custom report is budget-wide",
    ).toBe("InvalidRequest");
    expect(await names(), "a refused add creates no report").toEqual(before);
    const spending = await s.call<Widget>("add_page_widget", {
      book,
      host: "payees",
      type: "spending-card",
      report: { settings: { mode: "single-month" } },
    });
    expect(spending.availability).toBe("available");
    for (let i = 0; i < 3; i++) await embed(book, worth.id);
    expect(await refused({ type: "net-worth-card", reportId: worth.id })).toBe("InvalidRequest");
  });

  it("moves, configures and removes widgets in a contiguous stack", async () => {
    const { book } = await setup();
    const worth = await netWorth(book);
    const [a, b, c] = [
      await embed(book, worth.id),
      await embed(book, worth.id),
      await embed(book, worth.id),
    ];
    const moved = await s.call("move_page_widget", { book, id: c!.id, index: 0 });
    expect(moved.widgets.map((w: Widget) => [w.id, w.y])).toEqual([
      [c!.id, 0],
      [a!.id, 1],
      [b!.id, 2],
    ]);
    await s.call("undo", { book });
    expect((await stack(book)).map((w) => w.id)).toEqual([a!.id, b!.id, c!.id]);
    await s.call("redo", { book });
    await s.call("move_page_widget", { book, id: c!.id, index: 0 });
    await s.call("undo", { book });
    expect(
      (await stack(book)).map((w) => w.id),
      "moving to where it already is writes nothing, so undo takes back the real move",
    ).toEqual([a!.id, b!.id, c!.id]);
    expect((await s.fails("move_page_widget", { book, id: a!.id, index: 3 }))._tag).toBe(
      "InvalidRequest",
    );

    expect((await s.fails("update_widget", { book, id: a!.id, width: 6 }))._tag).toBe(
      "InvalidRequest",
    );
    expect((await s.fails("update_widgets", { book, widgets: [{ id: a!.id, y: 2 }] }))._tag).toBe(
      "InvalidRequest",
    );
    const titled = await s.call<Widget>("update_widget", {
      book,
      id: a!.id,
      config: { ...config({ mode: "fixed", value: { mode: "offbudget" } }), title: "Off budget" },
    });
    expect(titled.config).toMatchObject({
      title: "Off budget",
      scope: { accounts: { mode: "fixed", value: { mode: "offbudget" } } },
    });

    await s.call("remove_widget", { book, id: a!.id });
    expect((await stack(book)).map((w) => [w.id, w.y])).toEqual([
      [b!.id, 0],
      [c!.id, 1],
    ]);
    await s.call("undo", { book });
    expect((await stack(book)).map((w) => w.id)).toEqual([a!.id, b!.id, c!.id]);
  });

  it("goes with its saved report, and turns unavailable if the report stops following accounts", async () => {
    const { book } = await setup();
    const worth = await netWorth(book);
    const widget = await embed(book, worth.id);
    const usage = await s.call("get_saved_report_usage", { book, id: worth.id });
    expect(usage.placements).toEqual([
      expect.objectContaining({ id: widget.id, host: "transactions", pageName: "Transactions" }),
    ]);
    await s.call("delete_saved_report", { book, id: worth.id, expectedPlacementIds: [widget.id] });
    expect(await stack(book)).toEqual([]);
    await s.call("undo", { book });
    expect((await stack(book)).map((w) => w.id)).toEqual([widget.id]);

    const custom = await s.call<Widget>("add_page_widget", {
      book,
      host: "payees",
      type: "custom-report",
      report: { name: "Payments" },
    });
    await s.call("update_saved_report", {
      book,
      id: custom.reportId,
      settings: { balanceType: "Budgeted" },
    });
    expect((await stack(book, "payees"))[0]!.availability).toBe("unsupported");
  });

  it("lets a dashboard placement fix a scope only where its report follows one", async () => {
    const { book, checking } = await setup();
    const [page] = await s.call<DashboardPage[]>("list_dashboard_pages", { book });
    const worth = await netWorth(book);
    const fixed = await s.call<Widget>("add_widget", {
      book,
      pageId: page!.id,
      type: "net-worth-card",
      reportId: worth.id,
      config: config({ mode: "fixed", value: only(checking.id) }),
    });
    expect(fixed.availability).toBe("available");
    const budget = await s.call<SavedReport>("create_saved_report", {
      book,
      name: "Analysis",
      definition: {
        version: 1,
        type: "budget-analysis",
        settings: {},
        scope: { accounts: { mode: "all" } },
      },
    });
    const refused = async (type: string, extra: Record<string, unknown>) =>
      (
        await s.fails("add_widget", {
          book,
          pageId: page!.id,
          type,
          config: { ...config({ mode: "fixed", value: { mode: "budgeted" } }), ...extra },
          ...(extra["settings"] === undefined ? { reportId: budget.id } : {}),
        })
      )._tag;
    expect(await refused("budget-analysis-card", {})).toBe("InvalidRequest");
    expect(await refused("recent-transactions", { settings: {} })).toBe("InvalidRequest");
  });
});
