// Budget targets as structured data (docs/rules/budget.md): each kind round-trips through the note
// grammar, and the target operations read, write and preview note lines in place.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addMonths, currentMonth } from "@reeve/contract/rules";
import { defaultTarget, TARGET_KINDS, type Target } from "@reeve/contract/targets";
import { templatesOfNote } from "../src/templates/notes.ts";
import { fromTemplate, targetLine } from "../src/templates/targets.ts";
import { scratch } from "./helpers.ts";

const parsed = (line: string, incomeId?: (name: string) => string | undefined) => {
  const [template] = templatesOfNote(line);
  expect(template?.type).not.toBe("error");
  return fromTemplate(template!, incomeId);
};

const cap = { amount: 30_000, period: "monthly", start: null, hold: false } as const;

describe("targets and note lines", () => {
  const cases: Array<[Target, string]> = [
    [{ type: "simple", priority: 0, monthly: 5_000, cap: null }, "#template 50"],
    [{ type: "simple", priority: 2, monthly: 1_234, cap: null }, "#template-2 12.34"],
    [{ type: "simple", priority: 0, monthly: null, cap }, "#template up to 300"],
    [
      { type: "simple", priority: 0, monthly: null, cap: { ...cap, hold: true } },
      "#template up to 300 hold",
    ],
    [
      { type: "simple", priority: 0, monthly: 5_000, cap: { ...cap, period: "daily" } },
      "#template 50 up to 300 per day",
    ],
    [
      {
        type: "simple",
        priority: 0,
        monthly: null,
        cap: { ...cap, period: "weekly", start: "2026-01-05" },
      },
      "#template up to 300 per week starting 2026-01-05",
    ],
    [
      {
        type: "periodic",
        priority: 0,
        amount: 2_500,
        period: "week",
        every: 1,
        starting: "2026-01-05",
        cap: null,
      },
      "#template 25 repeat every 1 weeks starting 2026-01-05",
    ],
    [
      {
        type: "periodic",
        priority: 1,
        amount: 10_000,
        period: "month",
        every: 3,
        starting: "2026-02-01",
        cap,
      },
      "#template-1 100 repeat every 3 months starting 2026-02-01 up to 300",
    ],
    [
      { type: "by", priority: 0, amount: 90_000, month: "2027-02", repeat: null, spendFrom: null },
      "#template 900 by 2027-02",
    ],
    [
      {
        type: "by",
        priority: 0,
        amount: 120_000,
        month: "2026-12",
        repeat: { unit: "year", every: 1 },
        spendFrom: null,
      },
      "#template 1200 by 2026-12 repeat every year",
    ],
    [
      {
        type: "by",
        priority: 0,
        amount: 60_000,
        month: "2026-06",
        repeat: { unit: "month", every: 6 },
        spendFrom: null,
      },
      "#template 600 by 2026-06 repeat every 6 months",
    ],
    [
      {
        type: "by",
        priority: 0,
        amount: 30_000,
        month: "2026-12",
        repeat: { unit: "year", every: 2 },
        spendFrom: "2026-06",
      },
      "#template 300 by 2026-12 spend from 2026-06 repeat every 2 years",
    ],
    [
      { type: "percentage", priority: 0, percent: 10, of: "all income", previous: false },
      "#template 10% of all income",
    ],
    [
      { type: "percentage", priority: 0, percent: 12.5, of: "available funds", previous: true },
      "#template 12.5% of previous available funds",
    ],
    [
      { type: "schedule", priority: 0, schedule: "Rent", full: false, adjustment: null },
      "#template schedule Rent",
    ],
    [
      {
        type: "schedule",
        priority: 0,
        schedule: "Car Insurance",
        full: true,
        adjustment: { by: 5, unit: "percent" },
      },
      "#template schedule full Car Insurance [increase 5%]",
    ],
    [
      { type: "average", priority: 0, months: 6, adjustment: { by: -2_000, unit: "fixed" } },
      "#template average 6 months [decrease 20]",
    ],
    [{ type: "copy", priority: 0, monthsAgo: 12 }, "#template copy from 12 months ago"],
    [{ type: "remainder", weight: 1, cap: null }, "#template remainder"],
    [{ type: "remainder", weight: 3, cap }, "#template remainder 3 up to 300"],
    [{ type: "goal", amount: 700_000 }, "#goal 7000"],
  ];

  it.each(cases)("writes %j as its line and reads it back", (target, line) => {
    expect(targetLine(target)).toBe(line);
    expect(parsed(line)).toEqual(target);
  });

  it("round-trips every kind's default form", () => {
    for (const kind of TARGET_KINDS) {
      const target = defaultTarget(kind, "2026-11");
      const form = target.type === "schedule" ? { ...target, schedule: "Rent" } : target;
      expect(parsed(targetLine(form))).toEqual(form);
    }
  });

  it("reads Actual's shorthand lines into the same targets", () => {
    expect(parsed("#template 1200 by 2026-12 repeat every 1 years")).toEqual(
      parsed("#template 1200 by 2026-12 repeat every year"),
    );
    expect(parsed("#template $50")).toEqual(parsed("#template 50"));
    expect(parsed("Rent: #template 50")).toEqual(parsed("#template 50"));
  });

  it("names an income category in the note and reads it back as its id", () => {
    const target: Target = {
      type: "percentage",
      priority: 0,
      percent: 20,
      of: "income-1",
      previous: false,
    };
    const line = targetLine(target, (id) => (id === "income-1" ? "Salary" : undefined));
    expect(line).toBe("#template 20% of Salary");
    expect(parsed(line, (name) => (name === "Salary" ? "income-1" : undefined))).toEqual(target);
  });
});

describe("target operations", () => {
  let s: ReturnType<typeof scratch>;
  let book: string;
  let cat: (name: string) => { id: string; name: string };
  const month = currentMonth();
  const note = async (name: string) =>
    (await s.call("list_categories", { book }))
      .flatMap((group: any) => group.categories)
      .find((category: any) => category.name === name).notes as string | null;
  const setNote = (name: string, text: string) =>
    s.call("set_note", { book, id: cat(name).id, note: text });
  const by = (amount: number, months: number): Target => ({
    type: "by",
    priority: 0,
    amount,
    month: addMonths(month, months),
    repeat: null,
    spendFrom: null,
  });

  beforeEach(async () => {
    s = scratch();
    book = (await s.call("create_book", { name: "Targets" })).id;
    await s.call("create_account", { book, name: "Checking", balance: 500_000 });
    const all = (await s.call("list_categories", { book })).flatMap(
      (group: any) => group.categories,
    );
    cat = (name) => all.find((category: any) => category.name === name);
  });
  afterEach(() => s.dispose());

  it("reads note templates as targets, with sentences and unreadable lines", async () => {
    await setNote("Food", "Groceries\n#template 50\n#template nonsense\n#goal 1000");
    const result = await s.call("get_category_targets", { book, category: cat("Food").id });
    expect(result.targets).toEqual([
      { type: "simple", priority: 0, monthly: 5_000, cap: null },
      { type: "goal", amount: 100_000 },
    ]);
    expect(result.sentences).toEqual(["Budget 50.00 each month", "Reach a balance of 1,000.00"]);
    expect(result.lines).toEqual(["#template 50", "#goal 1000"]);
    expect(result.unreadable).toHaveLength(1);
    expect(result.unreadable[0].line).toBe("#template nonsense");
  });

  it("rewrites only the template lines, in place, keeping the note's other text", async () => {
    await setNote(
      "Food",
      "Shop at the market\n\nWeekly shop:\n#template 50\nkeep receipts\n#template nonsense\n#template 20",
    );
    await s.call("set_category_targets", {
      book,
      category: cat("Food").id,
      targets: [by(90_000, 2)],
    });
    expect(await note("Food")).toBe(
      `Shop at the market\n\nWeekly shop:\n#template 900 by ${addMonths(month, 2)}\nkeep receipts\n#template nonsense`,
    );
  });

  it("adds targets after a blank line, so prose stays prose, and clears an emptied note", async () => {
    await setNote("Food", "Shop at the market");
    await s.call("set_category_targets", {
      book,
      category: cat("Food").id,
      targets: [{ type: "simple", priority: 0, monthly: 5_000, cap: null }],
    });
    expect(await note("Food")).toBe("Shop at the market\n\n#template 50");
    const read = await s.call("get_category_targets", { book, category: cat("Food").id });
    expect(read.sentences).toEqual(["Budget 50.00 each month"]);

    await s.call("set_category_targets", { book, category: cat("General").id, targets: [] });
    await setNote("General", "#template 10");
    await s.call("set_category_targets", { book, category: cat("General").id, targets: [] });
    expect(await note("General")).toBeNull();
  });

  it("applies a saved target: 900 by the month after next is 300 this month", async () => {
    const food = cat("Food").id;
    await s.call("set_category_targets", { book, category: food, targets: [by(90_000, 2)] });
    const preview = await s.call("preview_category_targets", { book, category: food, month });
    expect(preview).toEqual({
      month,
      budgeted: 30_000,
      perTarget: [30_000],
      goal: 30_000,
      problems: [],
    });
    const applied = await s.call("apply_category_templates", { book, month, category: food });
    expect(applied.message).toBe("templates-applied");
    const view = await s.call("get_budget", { book, month });
    expect(view.months[0].categories.find((c: any) => c.id === food).budgeted).toBe(30_000);
  });

  it("previews unsaved targets without writing", async () => {
    const food = cat("Food").id;
    const preview = await s.call("preview_category_targets", {
      book,
      category: food,
      month,
      targets: [
        { type: "simple", priority: 0, monthly: 5_000, cap: null },
        { type: "simple", priority: 1, monthly: 2_500, cap: null },
      ],
    });
    expect(preview.budgeted).toBe(7_500);
    expect(preview.perTarget).toEqual([5_000, 2_500]);
    expect(await note("Food")).toBeNull();
  });

  it("validates as the editor does, and writes nothing on a problem", async () => {
    const error = await s.fails("set_category_targets", {
      book,
      category: cat("Food").id,
      targets: [
        { type: "schedule", priority: 0, schedule: "Nope", full: false, adjustment: null },
        { type: "percentage", priority: 0, percent: 120, of: "Salary", previous: false },
      ],
    });
    expect(error._tag).toBe("InvalidRequest");
    expect(error.message).toContain('There is no active schedule called "Nope".');
    expect(error.message).toContain("at most 100");
    expect(await note("Food")).toBeNull();

    const preview = await s.call("preview_category_targets", {
      book,
      category: cat("Food").id,
      month,
      targets: [by(10_000, -2)],
    });
    expect(preview.budgeted).toBeNull();
    expect(preview.problems[0]).toContain("has passed");
  });

  it("takes the targets as JSON text, for the command line", async () => {
    await s.call("set_category_targets", {
      book,
      category: cat("Food").id,
      content: JSON.stringify({ targets: [{ type: "goal", amount: 50_000 }] }),
    });
    expect(await note("Food")).toBe("#goal 500");
    const error = await s.fails("set_category_targets", {
      book,
      category: cat("Food").id,
      content: JSON.stringify({ targets: [{ type: "goal" }] }),
    });
    expect(error._tag).toBe("InvalidRequest");
  });

  it("names a percentage's income category in the note", async () => {
    const income = (await s.call("list_categories", { book }))
      .filter((group: any) => group.isIncome)
      .flatMap((group: any) => group.categories)[0];
    const result = await s.call("set_category_targets", {
      book,
      category: cat("Food").id,
      targets: [{ type: "percentage", priority: 0, percent: 10, of: income.id, previous: false }],
    });
    expect(await note("Food")).toBe(`#template 10% of ${income.name}`);
    expect(result.targets[0].of).toBe(income.id);
  });

  describe("leftovers", () => {
    it("gives leftovers back and collects them, as #cleanup lines", async () => {
      await setNote("Food", "#template 50");
      await s.call("set_category_targets", {
        book,
        category: cat("Food").id,
        leftovers: [{ kind: "give-back" }],
      });
      expect(await note("Food")).toBe("#template 50\n#cleanup source");
      await s.call("set_category_targets", {
        book,
        category: cat("Savings").id,
        leftovers: [{ kind: "receive", weight: 2 }],
      });
      expect(await note("Savings")).toBe("#cleanup sink 2");
      const list = await s.call("list_targets", { book });
      expect(list.map((each: any) => each.name).sort()).toEqual(["Food", "Savings"]);
    });

    it("sends leftovers to a category through a pool named after it, and undoes that", async () => {
      const food = cat("Food").id;
      await setNote("Savings", "Rainy day");
      const sent = await s.call("set_category_targets", {
        book,
        category: food,
        leftovers: [{ kind: "send", to: cat("Savings").id }],
      });
      expect(sent.leftovers).toEqual([{ kind: "send", to: cat("Savings").id }]);
      expect(sent.sentences).toEqual(["At month end, send leftover money to Savings"]);
      expect(await note("Food")).toBe("#cleanup Savings source");
      expect(await note("Savings")).toBe("Rainy day\n\n#cleanup Savings sink");
      const receiving = await s.call("get_category_targets", { book, category: cat("Savings").id });
      expect(receiving.leftovers).toEqual([{ kind: "pool-receive", pool: "Savings", weight: 1 }]);
      expect(receiving.sentences).toEqual([
        "At month end, collect leftover money other categories send here",
      ]);

      // Month end moves Food's leftover into Savings.
      await s.call("set_budget", { book, month, category: food, amount: 10_000 });
      const cleanup = await s.call("cleanup_templates", { book, month });
      expect(cleanup.warnings).toEqual([]);
      const view = await s.call("get_budget", { book, month });
      const row = (id: string) => view.months[0].categories.find((c: any) => c.id === id);
      expect(row(food).budgeted).toBe(0);
      expect(row(cat("Savings").id).budgeted).toBe(10_000);

      await s.call("set_category_targets", { book, category: food, leftovers: [] });
      expect(await note("Food")).toBeNull();
      expect(await note("Savings")).toBe("Rainy day");
    });

    it("keeps a pool's taker while another category still sends to it", async () => {
      const send = { kind: "send", to: cat("Savings").id };
      await s.call("set_category_targets", { book, category: cat("Food").id, leftovers: [send] });
      await s.call("set_category_targets", {
        book,
        category: cat("General").id,
        leftovers: [send],
      });
      await s.call("set_category_targets", { book, category: cat("Food").id, leftovers: [] });
      expect(await note("Savings")).toBe("#cleanup Savings sink");
    });

    it("writes named pools", async () => {
      await s.call("set_category_targets", {
        book,
        category: cat("Food").id,
        leftovers: [
          { kind: "pool-give", pool: "Bills" },
          { kind: "pool-receive", pool: "Fun", weight: 3 },
          { kind: "pool-cover", pool: "Bills" },
        ],
      });
      expect(await note("Food")).toBe("#cleanup Bills source\n#cleanup Fun sink 3\n#cleanup Bills");
      const read = await s.call("get_category_targets", { book, category: cat("Food").id });
      expect(read.leftovers).toEqual([
        { kind: "pool-give", pool: "Bills" },
        { kind: "pool-receive", pool: "Fun", weight: 3 },
        { kind: "pool-cover", pool: "Bills" },
      ]);
    });

    it("refuses to send leftovers to the category itself or to income", async () => {
      const self = await s.fails("set_category_targets", {
        book,
        category: cat("Food").id,
        leftovers: [{ kind: "send", to: cat("Food").id }],
      });
      expect(self.message).toContain("itself");
      const pool = await s.fails("set_category_targets", {
        book,
        category: cat("Food").id,
        leftovers: [{ kind: "pool-give", pool: "  " }],
      });
      expect(pool.message).toContain("name");
    });
  });

  it("is one undo step", async () => {
    await setNote("Food", "notes");
    await s.call("set_category_targets", {
      book,
      category: cat("Food").id,
      targets: [{ type: "goal", amount: 100 }],
      leftovers: [{ kind: "send", to: cat("Savings").id }],
    });
    await s.call("undo", { book });
    expect(await note("Food")).toBe("notes");
    expect(await note("Savings")).toBeNull();
  });
});
