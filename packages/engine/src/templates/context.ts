/**
 * One category's templates for one month, as Actual's `CategoryTemplateContext`: checks them, runs
 * them priority by priority within what To Budget holds, takes its share of the remainder, and
 * answers what to budget and the goal.
 */
import { amountToInteger, integerToAmount, months } from "./months.ts";
import { runScheduleForecast, type ScheduleStore } from "./schedule.ts";
import type {
  AverageTemplate,
  ByTemplate,
  CopyTemplate,
  GoalTemplate,
  Limit,
  LimitTemplate,
  PercentageTemplate,
  PeriodicTemplate,
  RefillTemplate,
  RemainderTemplate,
  ScheduleTemplate,
  SimpleTemplate,
  SpendTemplate,
  Template,
} from "./types.ts";

export interface TemplateCategory {
  readonly id: string;
  readonly name: string;
  readonly isIncome: boolean;
}

/**
 * What templates read of a book, named as Actual's budget sheet cells: `value(month, key)` answers
 * `budget-<id>`, `leftover-<id>` (the balance), `sum-amount-<id>` (activity, negative for
 * spending), `to-budget`, `total-income` and `total-saved`.
 */
export interface TemplateEnv {
  readonly isTracking: boolean;
  readonly hideFraction: boolean;
  /** Today, `YYYY-MM-DD`. */
  readonly today: string;
  readonly value: (month: string, key: string) => number;
  readonly carryover: (month: string, category: string) => boolean;
  readonly categories: () => ReadonlyArray<TemplateCategory>;
  /** Actual's `getCategoryAverage`: the average activity of the months before. */
  readonly categoryAverage: (month: string, maxMonths: number, category: string) => number;
  readonly schedules: ScheduleStore;
}

type Prioritized = Exclude<Template, RemainderTemplate | GoalTemplate | LimitTemplate>;

export class CategoryTemplateContext {
  /** Checks the templates and reads what last month left, then makes the context. */
  static init(
    templates: ReadonlyArray<Template>,
    category: TemplateCategory,
    month: string,
    budgeted: number,
    env: TemplateEnv,
    skipAvailableClamp = false,
  ): CategoryTemplateContext {
    const lastMonth = months.subMonths(month, 1);
    let fromLastMonth = env.value(lastMonth, `leftover-${category.id}`);
    const carryover = env.carryover(lastMonth, category.id);
    if ((fromLastMonth < 0 && !carryover) || category.isIncome || (env.isTracking && !carryover))
      fromLastMonth = 0;
    CategoryTemplateContext.checkPeriodicInterval(templates);
    CategoryTemplateContext.checkByAndScheduleAndSpend(templates, month, env);
    CategoryTemplateContext.checkPercentage(templates, env);
    return new CategoryTemplateContext(
      templates,
      category,
      month,
      fromLastMonth,
      budgeted,
      env,
      skipAvailableClamp,
    );
  }

  isGoalOnly(): boolean {
    return this.templates.length === 0 && this.remainder.length === 0 && this.goals.length > 0;
  }
  getPriorities(): Array<number> {
    return [...this.priorities];
  }
  hasRemainder(): boolean {
    return this.remainderWeight > 0 && !this.limitMet;
  }
  getRemainderWeight(): number {
    return this.remainderWeight;
  }
  getLimitExcess(): number {
    return this.limitExcess;
  }

  /** Every priority at once, with `available` for each. */
  runAll(available: number): number {
    let toBudget = 0;
    for (const priority of this.getPriorities().sort((a, b) => a - b))
      toBudget += this.runTemplatesForPriority(priority, available, available);
    return toBudget;
  }

  /** Runs the templates of one priority; answers what they budget. */
  runTemplatesForPriority(priority: number, budgetAvail: number, availStart: number): number {
    if (!this.priorities.has(priority)) return 0;
    if (this.limitMet) return 0;

    const templates = this.templates.filter(
      (template) => template.directive === "template" && template.priority === priority,
    );
    let available = budgetAvail || 0;
    let toBudget = 0;
    const perTemplateLocal = new Map<Template, number>();
    let byFlag = false;
    let scheduleFlag = false;
    let schedulePerTemplate: Map<ScheduleTemplate, number> | null = null;
    let byPerTemplate: Map<ByTemplate, number> | null = null;
    for (const template of templates) {
      let newBudget = 0;
      switch (template.type) {
        case "simple":
          newBudget = CategoryTemplateContext.runSimple(template, this);
          break;
        case "refill":
          newBudget = CategoryTemplateContext.runRefill(template, this);
          break;
        case "copy":
          newBudget = CategoryTemplateContext.runCopy(template, this);
          break;
        case "periodic":
          newBudget = CategoryTemplateContext.runPeriodic(template, this);
          break;
        case "spend":
          newBudget = CategoryTemplateContext.runSpend(template, this);
          break;
        case "percentage":
          newBudget = CategoryTemplateContext.runPercentage(template, availStart, this);
          break;
        case "by":
          if (!byFlag) {
            const result = CategoryTemplateContext.runBy(this);
            newBudget = result.toBudget;
            byPerTemplate = result.perTemplateNeed;
          }
          byFlag = true;
          break;
        case "schedule":
          if (!scheduleFlag) {
            const result = runScheduleForecast(
              templates,
              this.month,
              this.fromLastMonth + toBudget,
              toBudget,
              this.category,
              this.env,
            );
            // The forecast answers the whole amount, so take out what is already counted.
            newBudget = result.toBudget - toBudget;
            schedulePerTemplate = result.perScheduleMonthly;
            scheduleFlag = true;
          }
          break;
        case "average":
          newBudget = CategoryTemplateContext.runAverage(template, this);
          break;
        default:
          break;
      }
      available -= newBudget;
      toBudget += newBudget;
      perTemplateLocal.set(template, (perTemplateLocal.get(template) ?? 0) + newBudget);
    }

    redistributeBatch(perTemplateLocal, templates, "by", (template) =>
      template.type === "by" ? Math.max(0, byPerTemplate?.get(template) ?? 0) : 0,
    );
    redistributeBatch(perTemplateLocal, templates, "schedule", (template) =>
      template.type === "schedule" ? Math.max(0, schedulePerTemplate?.get(template) ?? 0) : 0,
    );

    let scale = 1;
    if (
      this.limitCheck &&
      toBudget + this.toBudgetAmount + this.fromLastMonth >= this.limitAmount
    ) {
      const orig = toBudget;
      toBudget = this.limitAmount - this.toBudgetAmount - this.fromLastMonth;
      this.limitMet = true;
      available = available + orig - toBudget;
      if (orig > 0) scale *= toBudget / orig;
    }

    if (this.hideDecimal) {
      const preRound = toBudget;
      toBudget = this.removeFraction(toBudget);
      if (preRound !== 0) scale *= toBudget / preRound;
    }

    // A priority above 0 never budgets more than To Budget holds, but for income.
    if (priority > 0 && available < 0 && !this.category.isIncome && !this.skipAvailableClamp) {
      this.fullAmount = (this.fullAmount ?? 0) + toBudget;
      const adjusted = Math.max(0, toBudget + available);
      if (toBudget > 0) scale *= adjusted / toBudget;
      toBudget = adjusted;
      this.toBudgetAmount += toBudget;
    } else {
      this.fullAmount = (this.fullAmount ?? 0) + toBudget;
      this.toBudgetAmount += toBudget;
    }

    const perRowScale = Math.max(0, scale);
    const items = [...perTemplateLocal];
    let remaining = Math.max(0, toBudget);
    items.forEach(([template, value], i) => {
      const share =
        i === items.length - 1
          ? remaining
          : Math.max(0, Math.min(remaining, Math.round(value * perRowScale)));
      this.perTemplateContribution.set(
        template,
        (this.perTemplateContribution.get(template) ?? 0) + share,
      );
      remaining -= share;
    });
    return this.category.isIncome ? -toBudget : toBudget;
  }

  /** Takes this category's share of what is left: its weight times `perWeight`. */
  runRemainder(budgetAvail: number, perWeight: number): number {
    if (this.remainder.length === 0) return 0;
    let toBudget = Math.round(this.remainderWeight * perWeight);
    let smallest = 1;
    if (this.hideDecimal) {
      toBudget = this.removeFraction(toBudget);
      smallest = 100;
    }
    // Rounding must not overbudget, nor leave a last cent behind.
    if (toBudget > budgetAvail || budgetAvail - toBudget <= smallest) toBudget = budgetAvail;
    if (
      this.limitCheck &&
      toBudget + this.toBudgetAmount + this.fromLastMonth >= this.limitAmount
    ) {
      toBudget = this.limitAmount - this.toBudgetAmount - this.fromLastMonth;
      this.limitMet = true;
    }
    if (toBudget > 0 && this.remainderWeight > 0) {
      let remaining = toBudget;
      this.remainder.forEach((template, i) => {
        const share =
          i === this.remainder.length - 1
            ? remaining
            : Math.round(toBudget * (template.weight / this.remainderWeight));
        const allocated = Math.max(0, Math.min(share, remaining));
        this.perTemplateContribution.set(
          template,
          (this.perTemplateContribution.get(template) ?? 0) + allocated,
        );
        remaining -= allocated;
      });
    }
    this.toBudgetAmount += toBudget;
    return toBudget;
  }

  getValues(): {
    budgeted: number;
    goal: number | null;
    longGoal: boolean | null;
    perTemplateContribution: Map<Template, number>;
  } {
    this.runGoal();
    return {
      budgeted: this.toBudgetAmount,
      goal: this.goalAmount,
      longGoal: this.isLongGoal,
      perTemplateContribution: this.perTemplateContribution,
    };
  }

  readonly category: TemplateCategory;
  readonly env: TemplateEnv;
  readonly month: string;
  readonly hideDecimal: boolean;
  readonly skipAvailableClamp: boolean;
  readonly previouslyBudgeted: number;
  readonly templates: Array<Prioritized> = [];
  private remainder: Array<RemainderTemplate> = [];
  private goals: Array<GoalTemplate> = [];
  private priorities = new Set<number>();
  private remainderWeight = 0;
  private toBudgetAmount = 0;
  private perTemplateContribution = new Map<Template, number>();
  private fullAmount: number | null = null;
  private isLongGoal: boolean | null = null;
  private goalAmount: number | null = null;
  readonly fromLastMonth: number;
  private limitMet = false;
  private limitExcess = 0;
  limitAmount = 0;
  private limitCheck = false;
  private limitHold = false;

  constructor(
    templates: ReadonlyArray<Template>,
    category: TemplateCategory,
    month: string,
    fromLastMonth: number,
    budgeted: number,
    env: TemplateEnv,
    skipAvailableClamp = false,
  ) {
    this.category = category;
    this.env = env;
    this.month = month;
    this.fromLastMonth = fromLastMonth;
    this.previouslyBudgeted = budgeted;
    this.hideDecimal = env.hideFraction;
    this.skipAvailableClamp = skipAvailableClamp;
    for (const template of templates) {
      if (template.directive === "template" && template.type === "remainder") {
        this.remainder.push(template);
        this.remainderWeight += template.weight;
      } else if (template.directive === "template" && template.type !== "limit") {
        this.templates.push(template);
        if (template.priority !== null) this.priorities.add(template.priority);
      } else if (template.directive === "goal" && template.type === "goal") {
        this.goals.push(template);
      }
    }
    this.checkLimit(templates);
    this.checkSpend();
    this.checkGoal();
  }

  private runGoal() {
    const goal = this.goals[0];
    if (goal !== undefined) {
      if (this.isGoalOnly()) this.toBudgetAmount = this.previouslyBudgeted;
      this.isLongGoal = true;
      this.goalAmount = amountToInteger(goal.amount);
      return;
    }
    this.goalAmount = this.fullAmount;
  }

  // ---------------------------------------------------------------------------------------------
  // Checks
  // ---------------------------------------------------------------------------------------------

  private static checkPeriodicInterval(templates: ReadonlyArray<Template>) {
    for (const template of templates) {
      if (template.type !== "periodic") continue;
      const interval = template.period?.amount;
      if (!Number.isSafeInteger(interval) || interval < 1)
        throw new Error("Template repeat interval must be a whole number greater than 0");
    }
  }

  static checkByAndScheduleAndSpend(
    templates: ReadonlyArray<Template>,
    month: string,
    env: TemplateEnv,
  ): void {
    const dated = templates.filter(
      (template): template is ScheduleTemplate | ByTemplate =>
        template.type === "schedule" || template.type === "by",
    );
    if (dated.length === 0) return;
    const active = env.schedules.active();
    const ids = new Set(active.map((schedule) => schedule.id));
    const names = new Set(active.map((schedule) => schedule.name?.trim()).filter(Boolean));
    for (const template of dated) {
      if (template.type !== "schedule") continue;
      if (template.scheduleId) {
        if (!ids.has(template.scheduleId))
          throw new Error(`Schedule ${template.name ?? template.scheduleId} does not exist`);
      } else if (template.name) {
        if (!names.has(template.name.trim()))
          throw new Error(`Schedule ${template.name.trim()} does not exist`);
      } else {
        throw new Error("Schedule template has no scheduleId or name");
      }
    }
    const lowestPriority = Math.min(...dated.map((template) => template.priority));
    for (const template of dated)
      if (template.priority !== lowestPriority)
        throw new Error(
          `Schedule and By templates must be the same priority level. Fix by setting all Schedule and By templates to priority level ${lowestPriority}`,
        );
    for (const template of templates) {
      if (template.type !== "by" && template.type !== "spend") continue;
      const range = months.differenceInCalendarMonths(`${template.month}`, month);
      if (range < 0 && !(template.repeat || template.annual))
        throw new Error("Target month has passed, remove or update the target month");
    }
  }

  static checkPercentage(templates: ReadonlyArray<Template>, env: TemplateEnv): void {
    const percentages = templates.filter(
      (template): template is PercentageTemplate => template.type === "percentage",
    );
    if (percentages.length === 0) return;
    const incomes = env.categories().filter((category) => category.isIncome);
    const names = new Set(incomes.map((category) => category.name.toLocaleLowerCase()));
    const ids = new Set(incomes.map((category) => category.id));
    const special = new Set(["all income", "available funds"]);
    for (const template of percentages) {
      const raw = template.category;
      const lowered = raw.toLocaleLowerCase();
      if (special.has(lowered) || names.has(lowered) || ids.has(raw)) continue;
      throw new Error(`Category "${raw}" is not found in available income categories`);
    }
  }

  private checkLimit(templates: ReadonlyArray<Template>) {
    for (const template of templates) {
      let limitDef: Limit | LimitTemplate;
      if (template.type === "limit") limitDef = template;
      else if (
        template.type === "simple" ||
        template.type === "periodic" ||
        template.type === "remainder"
      ) {
        if (!template.limit) continue;
        limitDef = template.limit;
      } else continue;

      if (this.limitCheck) throw new Error("Only one `up to` allowed per category");

      if (limitDef.period === "daily") {
        const numDays = months.differenceInCalendarDays(
          months.addMonths(this.month, 1),
          this.month,
        );
        this.limitAmount += amountToInteger(limitDef.amount) * numDays;
      } else if (limitDef.period === "weekly") {
        if (!limitDef.start) throw new Error("Weekly limit requires a start date (YYYY-MM-DD)");
        const nextMonth = months.nextMonth(this.month);
        let week = limitDef.start;
        const baseLimit = amountToInteger(limitDef.amount);
        while (week < nextMonth) {
          if (week >= this.month) this.limitAmount += baseLimit;
          week = months.addWeeks(week, 1);
        }
      } else if (limitDef.period === "monthly") {
        this.limitAmount = amountToInteger(limitDef.amount);
      } else {
        throw new Error("Invalid limit period. Check template syntax");
      }

      this.limitCheck = true;
      this.limitHold = Boolean(limitDef.hold);
      if (this.fromLastMonth >= this.limitAmount) {
        this.limitMet = true;
        if (this.limitHold) {
          this.limitExcess = 0;
          this.toBudgetAmount = 0;
          this.fullAmount = 0;
        } else {
          this.limitExcess = this.fromLastMonth - this.limitAmount;
          this.toBudgetAmount = -this.limitExcess;
          this.fullAmount = -this.limitExcess;
        }
      }
    }
  }

  private checkSpend() {
    if (this.templates.filter((template) => template.type === "spend").length > 1)
      throw new Error("Only one spend template is allowed per category");
  }

  private checkGoal() {
    if (this.goals.length > 1) throw new Error("Only one #goal is allowed per category");
  }

  private removeFraction(amount: number): number {
    return amountToInteger(Math.round(integerToAmount(amount)));
  }

  // ---------------------------------------------------------------------------------------------
  // Each kind of template
  // ---------------------------------------------------------------------------------------------

  static runSimple(template: SimpleTemplate, context: CategoryTemplateContext): number {
    if (template.monthly != null) return amountToInteger(template.monthly);
    return context.limitAmount - context.fromLastMonth;
  }

  static runRefill(_template: RefillTemplate, context: CategoryTemplateContext): number {
    return context.limitAmount - context.fromLastMonth;
  }

  static runCopy(template: CopyTemplate, context: CategoryTemplateContext): number {
    return context.env.value(
      months.subMonths(context.month, template.lookBack),
      `budget-${context.category.id}`,
    );
  }

  static runPeriodic(template: PeriodicTemplate, context: CategoryTemplateContext): number {
    let toBudget = 0;
    const amount = amountToInteger(template.amount);
    const numPeriods = template.period.amount;
    let date =
      template.starting && template.starting.length > 0
        ? template.starting
        : months.firstDayOfMonth(context.month);

    let shift: (date: string, n: number) => string;
    switch (template.period.period) {
      case "day":
        shift = (value, n) => months.addDays(value, n);
        break;
      case "week":
        shift = (value, n) => months.addWeeks(value, n);
        break;
      case "month":
        shift = (value, n) => months.addMonths(value, n);
        break;
      case "year":
        shift = (value, n) => months.addMonths(value, n * 12);
        break;
      default:
        throw new Error(`Unrecognized periodic period: ${String(template.period.period)}`);
    }
    const advance = (current: string) => {
      const next = shift(current, numPeriods);
      if (!months.isAfter(next, current))
        throw new Error("Infinite loop detected in repeating template, check the repeat interval");
      return next;
    };

    while (context.month > date) date = advance(date);
    if (months.differenceInCalendarMonths(context.month, date) < 0) return 0;
    const nextMonth = months.addMonths(context.month, 1);
    while (date < nextMonth) {
      toBudget += amount;
      date = advance(date);
    }
    return toBudget;
  }

  static runSpend(template: SpendTemplate, context: CategoryTemplateContext): number {
    let fromMonth = `${template.from}`;
    let toMonth = `${template.month}`;
    let alreadyBudgeted = context.fromLastMonth;
    let firstMonth = true;
    const repeat = template.annual ? (template.repeat || 1) * 12 : template.repeat;
    let m = months.differenceInCalendarMonths(toMonth, context.month);
    if (repeat && m < 0) {
      while (m < 0) {
        toMonth = months.addMonths(toMonth, repeat);
        fromMonth = months.addMonths(fromMonth, repeat);
        m = months.differenceInCalendarMonths(toMonth, context.month);
      }
    }
    for (
      let at = fromMonth;
      months.differenceInCalendarMonths(context.month, at) > 0;
      at = months.addMonths(at, 1)
    ) {
      if (firstMonth) {
        const spent = context.env.value(at, `sum-amount-${context.category.id}`);
        const balance = context.env.value(at, `leftover-${context.category.id}`);
        alreadyBudgeted = balance - spent;
        firstMonth = false;
      } else {
        alreadyBudgeted += context.env.value(at, `budget-${context.category.id}`);
      }
    }
    const numMonths = months.differenceInCalendarMonths(toMonth, context.month);
    const target = amountToInteger(template.amount);
    if (numMonths < 0) return 0;
    return Math.round((target - alreadyBudgeted) / (numMonths + 1));
  }

  static runPercentage(
    template: PercentageTemplate,
    availableFunds: number,
    context: CategoryTemplateContext,
  ): number {
    const category = template.category.toLocaleLowerCase();
    const month = template.previous ? months.subMonths(context.month, 1) : context.month;
    let income: number;
    if (category === "all income") income = context.env.value(month, "total-income");
    else if (category === "available funds") income = availableFunds;
    else {
      const incomeCategory = context.env
        .categories()
        .find(
          (row) =>
            row.isIncome &&
            (row.id === template.category || row.name.toLocaleLowerCase() === category),
        );
      if (incomeCategory === undefined)
        throw new Error(`Income category "${template.category}" not found for percentage template`);
      income = context.env.value(month, `sum-amount-${incomeCategory.id}`);
    }
    return Math.max(0, Math.round(income * (template.percent / 100)));
  }

  static runAverage(template: AverageTemplate, context: CategoryTemplateContext): number {
    let average = context.env.categoryAverage(
      context.month,
      template.numMonths,
      context.category.id,
    );
    if (average < 0) average *= -1;
    if (template.adjustment !== undefined && template.adjustmentType) {
      if (template.adjustmentType === "percent") average *= 1 + template.adjustment / 100;
      else average += amountToInteger(template.adjustment);
    }
    return Math.round(average);
  }

  static runBy(context: CategoryTemplateContext): {
    toBudget: number;
    perTemplateNeed: Map<ByTemplate, number>;
  } {
    const byTemplates = context.templates.filter(
      (template): template is ByTemplate => template.type === "by",
    );
    const savedInfo: Array<{ numMonths: number; period: number | null }> = [];
    let shortest: number | undefined;
    for (const template of byTemplates) {
      let targetMonth = `${template.month}`;
      const period = template.annual
        ? (template.repeat || 1) * 12
        : template.repeat != null
          ? template.repeat
          : null;
      let numMonths = months.differenceInCalendarMonths(targetMonth, context.month);
      while (numMonths < 0 && period) {
        targetMonth = months.addMonths(targetMonth, period);
        numMonths = months.differenceInCalendarMonths(targetMonth, context.month);
      }
      savedInfo.push({ numMonths, period });
      if (shortest === undefined || numMonths < shortest) shortest = numMonths;
    }
    const shortNumMonths = shortest || 0;
    const perTemplateNeed = new Map<ByTemplate, number>();
    let totalNeeded = 0;
    byTemplates.forEach((template, i) => {
      const { numMonths, period } = savedInfo[i]!;
      let amount: number;
      // Back-interpolate what a longer target needs within the shortest window.
      if (numMonths > shortNumMonths && period)
        amount = Math.round(
          (amountToInteger(template.amount) / period) * (period - numMonths + shortNumMonths),
        );
      else if (numMonths > shortNumMonths)
        amount = Math.round(
          (amountToInteger(template.amount) / (numMonths + 1)) * (shortNumMonths + 1),
        );
      else amount = amountToInteger(template.amount);
      perTemplateNeed.set(template, amount);
      totalNeeded += amount;
    });
    const toBudget = Math.round((totalNeeded - context.fromLastMonth) / (shortNumMonths + 1));
    return { toBudget, perTemplateNeed };
  }
}

/**
 * `by` and schedule templates budget one total per priority, credited to the first of them; this
 * splits it across all of them by `weightOf`, for per-template projections.
 */
const redistributeBatch = (
  perTemplateLocal: Map<Template, number>,
  templates: ReadonlyArray<Template>,
  type: Template["type"],
  weightOf: (template: Template) => number,
) => {
  const siblings = templates.filter((template) => template.type === type);
  if (siblings.length < 2) return;
  let total = 0;
  for (const sibling of siblings) {
    total += perTemplateLocal.get(sibling) ?? 0;
    perTemplateLocal.set(sibling, 0);
  }
  if (total === 0) return;
  const totalWeight = siblings.reduce((sum, sibling) => sum + weightOf(sibling), 0);
  let remaining = total;
  siblings.forEach((sibling, i) => {
    const share =
      i === siblings.length - 1
        ? remaining
        : totalWeight <= 0
          ? Math.round(total / siblings.length)
          : Math.round((total * weightOf(sibling)) / totalWeight);
    const allocated = Math.max(0, Math.min(share, remaining));
    perTemplateLocal.set(sibling, (perTemplateLocal.get(sibling) ?? 0) + allocated);
    remaining -= allocated;
  });
};

/** Hands what is left of To Budget to the remainder templates by weight, as Actual does. */
export const distributeRemainder = (
  contexts: ReadonlyArray<CategoryTemplateContext>,
  available: number,
): number => {
  let availBudget = available;
  let remainderContexts = contexts.filter((context) => context.hasRemainder());
  while (availBudget > 0 && remainderContexts.length > 0) {
    const weight = remainderContexts.reduce(
      (sum, context) => sum + context.getRemainderWeight(),
      0,
    );
    const perWeight = availBudget / weight;
    const before = availBudget;
    for (const context of remainderContexts)
      availBudget -= context.runRemainder(availBudget, perWeight);
    if (availBudget === before) break;
    remainderContexts = contexts.filter((context) => context.hasRemainder());
  }
  return availBudget;
};
