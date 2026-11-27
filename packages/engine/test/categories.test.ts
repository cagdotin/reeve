import { currentMonth, firstDay } from "@reeve/contract/rules";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
beforeEach(() => {
  s = scratch();
});
afterEach(() => s.dispose());

const month = currentMonth();
const day = firstDay(month);

/** A book with Health > Medical > Dentist > Orthodontics and Health > Fitness. */
const setup = async (budgetType: "envelope" | "tracking" = "envelope") => {
  const { id: book } = await s.call("create_book", { name: "Test" });
  if (budgetType === "tracking") await s.call("update_book", { book, budgetType });
  const groups = await s.call("list_categories", { book });
  const income = groups.find((g: any) => g.isIncome);
  const usual = groups[0];
  const health = await s.call("create_category_group", { book, name: "Health" });
  const create = (name: string, more: Record<string, unknown>) =>
    s.call("create_category", { book, name, ...more });
  const medical = await create("Medical", { groupId: health.id });
  const fitness = await create("Fitness", { groupId: health.id });
  const psychiatrist = await create("Psychiatrist", { parent: medical.id });
  const dentist = await create("Dentist", { parent: medical.id });
  const ortho = await create("Orthodontics", { parent: dentist.id });
  const checking = await s.call("create_account", {
    book,
    name: "Checking",
    balance: 100000,
    date: day,
  });
  const list = async () =>
    (await s.call("list_categories", { book })).find((g: any) => g.id === health.id);
  const names = async () => (await list()).categories.map((c: any) => c.name);
  return {
    book,
    income,
    usual,
    health,
    medical,
    fitness,
    psychiatrist,
    dentist,
    ortho,
    checking,
    list,
    names,
  };
};

const message = (error: any) => String(error.message ?? error);

describe("nested categories", () => {
  it("creates subcategories in tree order, taking the parent's group", async () => {
    const { health, ortho, dentist, names } = await setup();
    expect(ortho.groupId).toBe(health.id);
    expect(ortho.parentId).toBe(dentist.id);
    expect(await names()).toEqual([
      "Medical",
      "Psychiatrist",
      "Dentist",
      "Orthodontics",
      "Fitness",
    ]);
  });

  it("keeps a subcategory in its parent's group", async () => {
    const { book, usual, medical } = await setup();
    const error = await s.fails("create_category", {
      book,
      name: "X",
      parent: medical.id,
      groupId: usual.id,
    });
    expect(message(error)).toContain("parent's group");
  });

  it("limits nesting to categoryDepth", async () => {
    const { book, medical, ortho, fitness } = await setup();
    const error = await s.fails("create_category", { book, name: "Braces", parent: ortho.id });
    expect(message(error)).toContain("at most 3 levels");
    await s.call("update_book", { book, categoryDepth: 4 });
    await s.call("create_category", { book, name: "Braces", parent: ortho.id });
    // Moving the Medical subtree (4 levels) under Fitness would make 5.
    const move = await s.fails("move_category", {
      book,
      id: medical.id,
      parent: fitness.id,
    });
    expect(message(move)).toContain("at most 4 levels");
  });

  it("refuses to lower categoryDepth below the deepest nesting", async () => {
    const { book, ortho, dentist } = await setup();
    expect(message(await s.fails("update_book", { book, categoryDepth: 2 }))).toContain(
      "nest 3 levels deep",
    );
    expect(message(await s.fails("update_book", { book, categoryDepth: 0 }))).toContain(
      "at least 1",
    );
    await s.call("move_category", { book, id: ortho.id, parent: null });
    expect((await s.call("update_book", { book, categoryDepth: 2 })).categoryDepth).toBe(2);
    await s.call("move_category", { book, id: dentist.id, parent: null });
    await s.call("move_category", {
      book,
      id: (await s.call("list_categories", { book }))
        .flatMap((g: any) => g.categories)
        .find((c: any) => c.name === "Psychiatrist").id,
      parent: null,
    });
    expect((await s.call("update_book", { book, categoryDepth: 1 })).categoryDepth).toBe(1);
    const flat = await s.fails("create_category", { book, name: "X", parent: dentist.id });
    expect(message(flat)).toContain("at most 1 level deep");
  });

  it("rejects cycles", async () => {
    const { book, medical, ortho } = await setup();
    expect(
      message(await s.fails("move_category", { book, id: medical.id, parent: ortho.id })),
    ).toContain("under itself");
    expect(
      message(await s.fails("move_category", { book, id: medical.id, parent: medical.id })),
    ).toContain("under itself");
  });

  it("rejects a parent of the other kind or a system account", async () => {
    const { book, income, medical } = await setup();
    const salary = income.categories[0];
    expect(
      message(await s.fails("move_category", { book, id: salary.id, parent: medical.id })),
    ).toContain("parent's kind");
    const opening = (await s.call("list_ledger_accounts", { book })).find(
      (a: any) => a.system === "uncategorized" || a.system === "opening",
    );
    expect(
      message(await s.fails("create_category", { book, name: "X", parent: opening.id })),
    ).toContain("system account");
  });

  it("moves a subtree into another group, with every descendant", async () => {
    const { book, usual, dentist, names } = await setup();
    await s.call("move_category", { book, id: dentist.id, groupId: usual.id });
    expect(await names()).toEqual(["Medical", "Psychiatrist", "Fitness"]);
    const usualNow = (await s.call("list_categories", { book })).find(
      (g: any) => g.id === usual.id,
    );
    const moved = usualNow.categories.filter((c: any) =>
      ["Dentist", "Orthodontics"].includes(c.name),
    );
    expect(moved.map((c: any) => [c.name, c.groupId])).toEqual([
      ["Dentist", usual.id],
      ["Orthodontics", usual.id],
    ]);
    expect(moved[0].parentId).toBeNull();
    expect(moved[1].parentId).toBe(dentist.id);
  });

  it("moves before a sibling, taking that sibling's parent", async () => {
    const { book, fitness, psychiatrist, names } = await setup();
    await s.call("move_category", { book, id: fitness.id, before: psychiatrist.id });
    expect(await names()).toEqual([
      "Medical",
      "Fitness",
      "Psychiatrist",
      "Dentist",
      "Orthodontics",
    ]);
  });

  it("undoes a move", async () => {
    const { book, usual, dentist, names } = await setup();
    const before = await names();
    await s.call("move_category", { book, id: dentist.id, groupId: usual.id });
    expect(await names()).not.toEqual(before);
    expect((await s.call("undo", { book })).done).toBe(true);
    expect(await names()).toEqual(before);
    expect(
      (await s.call("list_categories", { book }))
        .find((g: any) => g.id === usual.id)
        .categories.some((c: any) => c.name === "Orthodontics"),
    ).toBe(false);
  });

  it("moves children up to the deleted category's parent, in its place", async () => {
    const { book, medical, dentist, ortho, list, names } = await setup();
    await s.call("create_category", { book, name: "Braces", parent: dentist.id });
    await s.call("delete_category", { book, id: dentist.id });
    expect(await names()).toEqual(["Medical", "Psychiatrist", "Orthodontics", "Braces", "Fitness"]);
    const categories = (await list()).categories;
    expect(categories.find((c: any) => c.id === ortho.id).parentId).toBe(medical.id);
    await s.call("delete_category", { book, id: medical.id });
    expect((await list()).categories.every((c: any) => c.parentId === null)).toBe(true);
  });

  it("deletes a group with nested categories", async () => {
    const { book, health } = await setup();
    await s.call("delete_category_group", { book, id: health.id });
    expect((await s.call("list_categories", { book })).some((g: any) => g.id === health.id)).toBe(
      false,
    );
  });

  for (const budgetType of ["envelope", "tracking"] as const) {
    it(`rolls up totals in get_budget (${budgetType})`, async () => {
      const { book, health, medical, dentist, ortho, fitness, checking } = await setup(budgetType);
      const budget = (category: string, amount: number) =>
        s.call("set_budget", { book, month, category, amount });
      await budget(medical.id, 1000);
      await budget(dentist.id, 2000);
      await budget(ortho.id, 4000);
      await budget(fitness.id, 8000);
      await s.call("create_transaction", {
        book,
        date: day,
        account: checking.id,
        amount: -300,
        category: ortho.id,
      });
      const view = await s.call("get_budget", { book, month });
      const row = (id: string) => view.months[0].categories.find((c: any) => c.id === id);
      expect(row(ortho.id).total).toEqual({ budgeted: 4000, spent: -300, balance: 3700 });
      expect(row(dentist.id).budgeted).toBe(2000);
      expect(row(dentist.id).total).toEqual({ budgeted: 6000, spent: -300, balance: 5700 });
      expect(row(medical.id).total).toEqual({ budgeted: 7000, spent: -300, balance: 6700 });
      const group = view.months[0].groups.find((g: any) => g.id === health.id);
      expect(group).toMatchObject({ budgeted: 15000, spent: -300, balance: 14700 });
      const summary = view.months[0].summary;
      expect(summary.type === "envelope" ? summary.toBudget : summary.budgetedExpenses).toBe(
        budgetType === "envelope" ? 100000 - 15000 : 15000,
      );
    });
  }
});

describe("move_category_group", () => {
  it("moves a group up and down among the groups of its kind", async () => {
    const { id: book } = await s.call("create_book", { name: "Test" });
    const [usual, savings] = await s.call("list_categories", { book });
    const names = async (before: string | null) =>
      (await s.call("move_category_group", { book, id: usual.id, before })).map((g: any) => g.name);
    expect(await names(null)).toEqual(["Investments and Savings", "Usual Expenses", "Income"]);
    expect(await names(savings.id)).toEqual([
      "Usual Expenses",
      "Investments and Savings",
      "Income",
    ]);
  });
});

describe("a category's description", () => {
  it("starts empty, is set on create or update, clears when blank, and undoes", async () => {
    const { id: book } = await s.call("create_book", { name: "Descriptions" });
    const groups = await s.call("list_categories", { book });
    const group = groups[0];
    expect(group.categories[0].description).toBeNull();

    const bike = await s.call("create_category", {
      book,
      name: "Bike",
      groupId: group.id,
      description: "  Repairs and parts  ",
    });
    expect(bike.description).toBe("Repairs and parts");

    const changed = await s.call("update_category", {
      book,
      id: bike.id,
      description: "Only repairs",
    });
    expect(changed.description).toBe("Only repairs");

    await s.call("undo", { book });
    const restored = (await s.call("list_categories", { book }))
      .flatMap((each: any) => each.categories)
      .find((each: any) => each.id === bike.id);
    expect(restored.description).toBe("Repairs and parts");

    const cleared = await s.call("update_category", { book, id: bike.id, description: "   " });
    expect(cleared.description).toBeNull();
  });
});

describe("a group's description", () => {
  it("starts empty, is set on create or update, and clears when blank", async () => {
    const { id: book } = await s.call("create_book", { name: "Group descriptions" });
    expect((await s.call("list_categories", { book }))[0].description).toBeNull();

    const group = await s.call("create_category_group", {
      book,
      name: "Home",
      description: " Keeping the house running ",
    });
    expect(group.description).toBe("Keeping the house running");

    const changed = await s.call("update_category_group", {
      book,
      id: group.id,
      description: "The house",
    });
    expect(changed.description).toBe("The house");

    const cleared = await s.call("update_category_group", { book, id: group.id, description: "" });
    expect(cleared.description).toBeNull();
  });
});
