/**
 * Budget targets as structured data over the note lines that hold them (docs/rules/budget.md): reading a
 * category's `#template`, `#goal` and `#cleanup` lines as targets and leftover rules, writing them
 * back in place without touching the rest of the note, and previewing what they budget.
 */
import { LeftoverSchema, TargetSchema } from "@reeve/contract/catalog";
import { currentMonth, formatAmount } from "@reeve/contract/rules";
import {
  describeLeftover,
  describeTarget,
  SPECIAL_INCOME_SOURCES,
  targetProblems,
  type LeftoverRule,
  type Target,
  type TargetAdjustment,
  type TargetCap,
} from "@reeve/contract/targets";
import { Schema } from "effect";
import { invalid, notFound, notesOf, readSettings, setNote, type Book } from "../book.ts";
import { listCategories } from "../ledger/categories.ts";
import { computeTemplates } from "./apply.ts";
import { bookEnv } from "./env.ts";
import { parseCleanup } from "./grammar.ts";
import { amountToInteger, integerToAmount } from "./months.ts";
import { cleanupOfNote, groupKey, templatesOfNote, unparse } from "./notes.ts";
import type { Limit, Template } from "./types.ts";

// ---------------------------------------------------------------------------------------------
// Targets and templates
// ---------------------------------------------------------------------------------------------

const limitOf = (cap: TargetCap | null): Limit | null =>
  cap === null
    ? null
    : {
        amount: integerToAmount(cap.amount),
        hold: cap.hold,
        period: cap.period,
        start: cap.period === "weekly" ? cap.start : null,
      };

const capOf = (limit: Limit | null | undefined): TargetCap | null =>
  limit
    ? {
        amount: amountToInteger(limit.amount),
        period: limit.period,
        start: limit.period === "weekly" ? (limit.start ?? null) : null,
        hold: Boolean(limit.hold),
      }
    : null;

const adjustmentFields = (adjustment: TargetAdjustment | null) =>
  adjustment === null || adjustment.by === 0
    ? {}
    : {
        adjustment: adjustment.unit === "percent" ? adjustment.by : integerToAmount(adjustment.by),
        adjustmentType: adjustment.unit,
      };

const adjustmentOf = (
  adjustment: number | undefined,
  type: "percent" | "fixed" | undefined,
): TargetAdjustment | null =>
  adjustment === undefined || type === undefined
    ? null
    : { by: type === "percent" ? adjustment : amountToInteger(adjustment), unit: type };

const isSpecialSource = (of: string) =>
  (SPECIAL_INCOME_SOURCES as ReadonlyArray<string>).includes(of.toLowerCase());

/** A target as the template the engine runs; a percentage's income category goes by name. */
export const toTemplate = (
  target: Target,
  categoryName: (id: string) => string | undefined = () => undefined,
): Template => {
  const directive = "template" as const;
  switch (target.type) {
    case "simple":
      return {
        type: "simple",
        directive,
        priority: target.priority,
        monthly: target.monthly === null ? null : integerToAmount(target.monthly),
        limit: limitOf(target.cap),
      };
    case "periodic":
      return {
        type: "periodic",
        directive,
        priority: target.priority,
        amount: integerToAmount(target.amount),
        period: { period: target.period, amount: target.every },
        starting: target.starting,
        limit: limitOf(target.cap),
      };
    case "by": {
      const repeat =
        target.repeat === null
          ? {}
          : { annual: target.repeat.unit === "year", repeat: target.repeat.every };
      const base = {
        directive,
        priority: target.priority,
        amount: integerToAmount(target.amount),
        month: target.month,
        ...repeat,
      };
      return target.spendFrom === null
        ? { type: "by", ...base }
        : { type: "spend", ...base, from: target.spendFrom };
    }
    case "percentage":
      return {
        type: "percentage",
        directive,
        priority: target.priority,
        percent: target.percent,
        previous: target.previous,
        category: isSpecialSource(target.of)
          ? target.of.toLowerCase()
          : (categoryName(target.of) ?? target.of),
      };
    case "schedule":
      return {
        type: "schedule",
        directive,
        priority: target.priority,
        name: target.schedule,
        full: target.full,
        ...adjustmentFields(target.adjustment),
      };
    case "average":
      return {
        type: "average",
        directive,
        priority: target.priority,
        numMonths: target.months,
        ...adjustmentFields(target.adjustment),
      };
    case "copy":
      return { type: "copy", directive, priority: target.priority, lookBack: target.monthsAgo };
    case "remainder":
      return {
        type: "remainder",
        directive,
        priority: null,
        weight: target.weight,
        limit: limitOf(target.cap),
      };
    case "goal":
      return { type: "goal", directive: "goal", amount: integerToAmount(target.amount) };
  }
};

/**
 * A parsed template as a target; an income category named by a percentage becomes its id. Null for
 * a line that does not parse (and Actual's UI-only limit and refill, which notes never hold).
 */
export const fromTemplate = (
  template: Template,
  incomeId: (name: string) => string | undefined = () => undefined,
): Target | null => {
  switch (template.type) {
    case "simple":
      return {
        type: "simple",
        priority: template.priority,
        monthly: template.monthly == null ? null : amountToInteger(template.monthly),
        cap: capOf(template.limit),
      };
    case "periodic":
      return {
        type: "periodic",
        priority: template.priority,
        amount: amountToInteger(template.amount),
        period: template.period.period,
        every: template.period.amount,
        starting: template.starting,
        cap: capOf(template.limit),
      };
    case "by":
    case "spend":
      return {
        type: "by",
        priority: template.priority,
        amount: amountToInteger(template.amount),
        month: template.month,
        repeat:
          template.annual === undefined
            ? null
            : { unit: template.annual ? "year" : "month", every: template.repeat ?? 1 },
        spendFrom: template.type === "spend" ? template.from : null,
      };
    case "percentage":
      return {
        type: "percentage",
        priority: template.priority,
        percent: template.percent,
        of: isSpecialSource(template.category)
          ? template.category.toLowerCase()
          : (incomeId(template.category) ?? template.category),
        previous: template.previous,
      };
    case "schedule":
      return {
        type: "schedule",
        priority: template.priority,
        schedule: template.name ?? "",
        full: Boolean(template.full),
        adjustment: adjustmentOf(template.adjustment, template.adjustmentType),
      };
    case "average":
      return {
        type: "average",
        priority: template.priority,
        months: template.numMonths,
        adjustment: adjustmentOf(template.adjustment, template.adjustmentType),
      };
    case "copy":
      return { type: "copy", priority: template.priority, monthsAgo: template.lookBack };
    case "remainder":
      return { type: "remainder", weight: template.weight, cap: capOf(template.limit) };
    case "goal":
      return { type: "goal", amount: amountToInteger(template.amount) };
    default:
      return null;
  }
};

/** A target as its note line, e.g. `#template 900 by 2027-02`. */
export const targetLine = (target: Target, categoryName?: (id: string) => string | undefined) =>
  unparse([toTemplate(target, categoryName)]);

// ---------------------------------------------------------------------------------------------
// Note lines
// ---------------------------------------------------------------------------------------------

const lineTemplate = (line: string): Template | undefined => templatesOfNote(line)[0];

const isTemplateLine = (line: string) => {
  const template = lineTemplate(line);
  return template !== undefined && template.type !== "error";
};

const isCleanupLine = (line: string) => line.trim().toLowerCase().startsWith("#cleanup ");

const parsesAsCleanup = (line: string) => {
  try {
    parseCleanup(line.trim());
    return true;
  } catch {
    return false;
  }
};

const isDirectiveLine = (line: string) => lineTemplate(line) !== undefined || isCleanupLine(line);

/** Text before a template line's `#`, kept when the line is rewritten. */
const prefixOf = (line: string) => {
  const at = line.indexOf("#");
  return at < 0 ? "" : line.slice(0, at);
};

/**
 * The note with the lines `isSlot` picks replaced by `lines`, in place: the first slots take the
 * new lines, extra slots go, and extra lines follow the last slot. Without a slot they follow the
 * last directive line, or the note's text after a blank line, so prose does not become a
 * template's description.
 */
const rewrite = (
  note: string | null,
  isSlot: (line: string) => boolean,
  lines: ReadonlyArray<string>,
): string | null => {
  const old = note === null || note === "" ? [] : note.split("\n");
  const slots = old.flatMap((line, index) => (isSlot(line) ? [index] : []));
  let result: Array<string>;
  if (slots.length > 0) {
    const last = slots.at(-1)!;
    result = old.flatMap((line, index) => {
      const slot = slots.indexOf(index);
      if (slot < 0) return [line];
      const own = slot < lines.length ? [prefixOf(line) + lines[slot]] : [];
      return index === last ? [...own, ...lines.slice(slots.length)] : own;
    });
  } else if (lines.length === 0) {
    result = old;
  } else {
    const anchor = old.findLastIndex(isDirectiveLine);
    if (anchor >= 0) result = [...old.slice(0, anchor + 1), ...lines, ...old.slice(anchor + 1)];
    else {
      while (old.length > 0 && old.at(-1)!.trim() === "") old.pop();
      result = old.length > 0 ? [...old, "", ...lines] : [...lines];
    }
  }
  while (result.length > 0 && result.at(-1)!.trim() === "") result.pop();
  return result.length === 0 ? null : result.join("\n");
};

// ---------------------------------------------------------------------------------------------
// Leftover rules and #cleanup lines
// ---------------------------------------------------------------------------------------------

interface CategoryInfo {
  readonly id: string;
  readonly name: string;
  readonly isIncome: boolean;
  readonly note: string | null;
}

const bookCategories = (book: Book): Array<CategoryInfo> => {
  const notes = notesOf(book.db);
  return listCategories(book).flatMap((group) =>
    group.categories.map((category) => ({
      id: category.id,
      name: category.name,
      isIncome: category.isIncome,
      note: notes.get(category.id) ?? null,
    })),
  );
};

/** Each category's sink pools, by group key. */
const sinkPools = (categories: ReadonlyArray<CategoryInfo>) => {
  const pools = new Map<string, Array<CategoryInfo>>();
  for (const category of categories)
    for (const row of cleanupOfNote(category.note))
      if (row.role === "sink" && row.groupId !== null)
        pools.set(row.groupId, [...(pools.get(row.groupId) ?? []), category]);
  return pools;
};

/**
 * A category's `#cleanup` lines as leftover rules. A pool this category gives to whose only taker
 * is the category the pool is named after is "send to that category".
 */
const leftoversOf = (
  category: CategoryInfo,
  categories: ReadonlyArray<CategoryInfo>,
): Array<LeftoverRule> => {
  const names = new Map<string, string>();
  const rows = cleanupOfNote(category.note, names);
  const sinks = sinkPools(categories);
  return rows.map((row): LeftoverRule => {
    const pool = row.groupId === null ? null : (names.get(row.groupId) ?? row.groupId);
    if (row.role === "source") {
      if (row.groupId === null || pool === null) return { kind: "give-back" };
      const takers = (sinks.get(row.groupId) ?? []).filter((each) => each.id !== category.id);
      const only = takers.length === 1 ? takers[0]! : undefined;
      if (only !== undefined && groupKey(only.name) === row.groupId)
        return { kind: "send", to: only.id };
      return { kind: "pool-give", pool };
    }
    if (row.role === "sink")
      return pool === null
        ? { kind: "receive", weight: row.weight }
        : { kind: "pool-receive", pool, weight: row.weight };
    return { kind: "pool-cover", pool: pool ?? row.groupId };
  });
};

const weightSuffix = (weight: number) => (weight === 1 ? "" : ` ${weight}`);

/** A leftover rule as its `#cleanup` line; `send` names the pool after the receiving category. */
const cleanupLine = (rule: LeftoverRule, nameOf: (id: string) => string): string => {
  switch (rule.kind) {
    case "give-back":
      return "#cleanup source";
    case "send":
      return `#cleanup ${nameOf(rule.to).trim()} source`;
    case "receive":
      return `#cleanup sink${weightSuffix(rule.weight)}`;
    case "pool-give":
      return `#cleanup ${rule.pool.trim()} source`;
    case "pool-receive":
      return `#cleanup ${rule.pool.trim()} sink${weightSuffix(rule.weight)}`;
    case "pool-cover":
      return `#cleanup ${rule.pool.trim()}`;
  }
};

const checkPoolName = (pool: string) => {
  const name = pool.trim();
  if (name === "") invalid("Give the pool a name.");
  if (/[\r\n]/.test(name)) invalid("A pool's name must be one line.");
  for (const line of [`#cleanup ${name} source`, `#cleanup ${name} sink`, `#cleanup ${name}`]) {
    let group: string | null = null;
    try {
      group = parseCleanup(line).group;
    } catch {
      group = null;
    }
    if (group === null || groupKey(group) !== groupKey(name))
      invalid(`"${name}" cannot be a pool's name; pick another.`);
  }
};

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

export interface CategoryTargets {
  readonly category: string;
  readonly name: string;
  readonly targets: Array<Target>;
  readonly leftovers: Array<LeftoverRule>;
  readonly sentences: Array<string>;
  readonly lines: Array<string>;
  readonly unreadable: Array<{ readonly line: string; readonly error: string }>;
}

const lookups = (categories: ReadonlyArray<CategoryInfo>) => {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const incomes = categories.filter((category) => category.isIncome);
  return {
    nameOf: (id: string) => byId.get(id)?.name,
    incomeId: (name: string) =>
      incomes.find((category) => category.name.toLowerCase() === name.trim().toLowerCase())?.id,
    incomeSources: new Set<string>([
      ...SPECIAL_INCOME_SOURCES,
      ...incomes.flatMap((category) => [category.id, category.name.toLowerCase()]),
    ]),
  };
};

const readCategory = (
  book: Book,
  category: CategoryInfo,
  categories: ReadonlyArray<CategoryInfo>,
): CategoryTargets => {
  const { nameOf, incomeId } = lookups(categories);
  const templates = templatesOfNote(category.note);
  const targets = templates.flatMap((template) => {
    const target = fromTemplate(template, incomeId);
    return target === null ? [] : [target];
  });
  const leftovers = leftoversOf(category, categories);
  const settings = readSettings(book.db);
  const context = {
    money: (cents: number) =>
      formatAmount(cents, {
        numberFormat: settings.numberFormat,
        hideFraction: settings.hideFraction,
      }),
    categoryName: nameOf,
    self: category.name,
  };
  const noteLines = category.note?.split("\n") ?? [];
  return {
    category: category.id,
    name: category.name,
    targets,
    leftovers,
    sentences: [
      ...targets.map((target) => describeTarget(target, context)),
      ...leftovers.map((rule) => describeLeftover(rule, context)),
    ],
    lines: noteLines
      .filter((line) => isTemplateLine(line) || (isCleanupLine(line) && parsesAsCleanup(line)))
      .map((line) => line.trim()),
    unreadable: [
      ...templates.flatMap((template) =>
        template.type === "error" ? [{ line: template.line.trim(), error: template.error }] : [],
      ),
      ...noteLines
        .filter((line) => isCleanupLine(line) && !parsesAsCleanup(line))
        .map((line) => ({ line: line.trim(), error: "This #cleanup line does not parse" })),
    ],
  };
};

const findCategory = (categories: ReadonlyArray<CategoryInfo>, id: string): CategoryInfo =>
  categories.find((category) => category.id === id) ?? notFound("category", id);

export const getCategoryTargets = (book: Book, id: string): CategoryTargets => {
  const categories = bookCategories(book);
  return readCategory(book, findCategory(categories, id), categories);
};

export const listTargets = (book: Book): Array<CategoryTargets> => {
  const categories = bookCategories(book);
  return categories
    .map((category) => readCategory(book, category, categories))
    .filter((each) => each.targets.length + each.leftovers.length + each.unreadable.length > 0);
};

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

const scheduleStates = (book: Book) =>
  book.client
    .prepare("SELECT TRIM(name) AS name, completed FROM schedules WHERE name IS NOT NULL")
    .all()
    .map((row) => ({ name: String(row["name"]), completed: Boolean(row["completed"]) }));

const validate = (
  book: Book,
  targets: ReadonlyArray<Target>,
  categories: ReadonlyArray<CategoryInfo>,
) => {
  const problems = targetProblems(targets, {
    schedules: scheduleStates(book),
    month: currentMonth(),
    incomeSources: lookups(categories).incomeSources,
  });
  return problems;
};

const Content = Schema.Struct({
  targets: Schema.optionalKey(Schema.Array(TargetSchema)),
  leftovers: Schema.optionalKey(Schema.Array(LeftoverSchema)),
});

const decodeContent = (content: string) => {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return invalid("content is not JSON");
  }
  try {
    return Schema.decodeUnknownSync(Content, { onExcessProperty: "error" })(json);
  } catch (error) {
    return invalid(`content: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const sendTargets = (leftovers: ReadonlyArray<LeftoverRule>) =>
  leftovers.flatMap((rule) => (rule.kind === "send" ? [rule.to] : []));

/** Replaces a category's targets and, when given, its leftover rules, in its note's lines. */
export const setCategoryTargets = (
  book: Book,
  input: {
    readonly category: string;
    readonly targets?: ReadonlyArray<Target>;
    readonly leftovers?: ReadonlyArray<LeftoverRule>;
    readonly content?: string;
  },
): CategoryTargets => {
  const fromContent = input.content === undefined ? {} : decodeContent(input.content);
  const targets = input.targets ?? fromContent.targets;
  const leftovers = input.leftovers ?? fromContent.leftovers;
  let categories = bookCategories(book);
  const category = findCategory(categories, input.category);
  const { nameOf } = lookups(categories);
  let note = category.note;

  if (targets !== undefined) {
    const problems = validate(book, targets, categories);
    if (problems.length > 0) invalid(problems.join("\n"));
    const lines = targets.map((target) => {
      const line = targetLine(target, nameOf);
      const parsed = lineTemplate(line);
      if (parsed === undefined || parsed.type === "error")
        invalid(`reeve cannot write this target as a note line: ${line}`);
      return line;
    });
    note = rewrite(note, isTemplateLine, lines);
  }

  const before = leftoversOf(category, categories);
  if (leftovers !== undefined) {
    for (const rule of leftovers) {
      if (rule.kind === "send") {
        const to = categories.find((each) => each.id === rule.to) ?? notFound("category", rule.to);
        if (to.id === category.id) invalid("A category cannot send leftover money to itself.");
        if (to.isIncome) invalid("Leftover money can only go to an expense category.");
        checkPoolName(to.name);
      } else if ("pool" in rule) checkPoolName(rule.pool);
      if ("weight" in rule && (!Number.isInteger(rule.weight) || rule.weight < 1))
        invalid("A share must be a whole number of at least 1.");
    }
    const lines = leftovers.map((rule) => cleanupLine(rule, (id) => nameOf(id) ?? id));
    note = rewrite(note, (line) => isCleanupLine(line) && parsesAsCleanup(line), lines);
  }

  setNote(book.db, category.id, note);

  if (leftovers !== undefined) {
    categories = bookCategories(book);
    // A category leftovers are sent to takes from the pool named after it.
    for (const id of sendTargets(leftovers)) {
      const to = findCategory(categories, id);
      const key = groupKey(to.name);
      const takes = cleanupOfNote(to.note).some(
        (row) => row.role === "sink" && row.groupId === key,
      );
      if (!takes)
        setNote(
          book.db,
          to.id,
          rewrite(to.note, () => false, [`#cleanup ${to.name.trim()} sink`]),
        );
    }
    // One no category sends to any more stops taking from its pool.
    categories = bookCategories(book);
    for (const id of sendTargets(before)) {
      if (sendTargets(leftovers).includes(id)) continue;
      const to = categories.find((each) => each.id === id);
      if (to === undefined) continue;
      const key = groupKey(to.name);
      const stillSent = categories.some((each) =>
        cleanupOfNote(each.note).some((row) => row.role === "source" && row.groupId === key),
      );
      if (stillSent) continue;
      const isPoolSink = (line: string) => {
        if (!isCleanupLine(line) || !parsesAsCleanup(line)) return false;
        const row = parseCleanup(line.trim());
        return row.type === "sink" && row.group !== null && groupKey(row.group) === key;
      };
      setNote(book.db, to.id, rewrite(to.note, isPoolSink, []));
    }
  }

  return getCategoryTargets(book, category.id);
};

// ---------------------------------------------------------------------------------------------
// Previewing
// ---------------------------------------------------------------------------------------------

export interface TargetPreview {
  readonly month: string;
  readonly budgeted: number | null;
  readonly perTarget: Array<number | null>;
  readonly goal: number | null;
  readonly problems: Array<string>;
}

/** What targets would budget a category in a month, as `apply_category_templates` would. */
export const previewCategoryTargets = (
  book: Book,
  input: {
    readonly category: string;
    readonly month: string;
    readonly targets?: ReadonlyArray<Target>;
  },
): TargetPreview => {
  const categories = bookCategories(book);
  const info = findCategory(categories, input.category);
  const targets = input.targets ?? readCategory(book, info, categories).targets;
  const { month } = input;
  const none = (problems: Array<string>): TargetPreview => ({
    month,
    budgeted: null,
    perTarget: targets.map(() => null),
    goal: null,
    problems,
  });
  if (targets.length === 0) return { ...none([]), budgeted: 0 };
  const problems = validate(book, targets, categories);
  if (problems.length > 0) return none(problems);
  const { nameOf } = lookups(categories);
  const templates = targets.map((target) => toTemplate(target, nameOf));
  const category = listCategories(book)
    .flatMap((group) => group.categories)
    .find((each) => each.id === info.id)!;
  const { contexts, errors } = computeTemplates(
    bookEnv(book, month),
    month,
    true,
    new Map([[info.id, templates]]),
    [category],
  );
  const context = contexts[0];
  if (errors.length > 0 || context === undefined)
    return none(errors.map((error) => error.replace(`${info.name}: `, "")));
  const values = context.getValues();
  return {
    month,
    budgeted: values.budgeted,
    perTarget: templates.map((template) =>
      template.type === "goal" ? null : (values.perTemplateContribution.get(template) ?? 0),
    ),
    goal: values.goal,
    problems: [],
  };
};
