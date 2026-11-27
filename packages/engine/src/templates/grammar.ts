/**
 * Actual's template grammars (`goal-template.pegjs`, `cleanup-template.pegjs`), rule for rule,
 * on the engine in `peg.ts`: the same accepted language, values and error messages.
 */
import {
  alt,
  any,
  cls,
  lazy,
  lit,
  map,
  named,
  not,
  opt,
  plus,
  run,
  seq,
  star,
  text,
  where,
  type Parser,
} from "./peg.ts";
import type { Limit, Template } from "./types.ts";

// ---------------------------------------------------------------------------------------------
// Goal templates
// ---------------------------------------------------------------------------------------------

const _ = named("whitespace", text(star(cls(/[ \t]/, "[ \\t]"))));
const d = named("digit", cls(/[0-9]/, "[0-9]"));
const number = named("number", text(plus(d)));
const positive = text(seq(cls(/[1-9]/, "[1-9]"), star(cls(/[0-9]/, "[0-9]"))));
const currencySymbol = named(
  "currency symbol",
  where(any, (symbol) => /\p{Sc}/u.test(symbol)),
);
const amount = named(
  "amount",
  map(
    seq(
      opt(currencySymbol),
      opt(_),
      text(seq(opt(lit("-")), plus(d), opt(seq(lit("."), opt(seq(d, opt(d))))))),
    ),
    ([, , value]) => +value,
  ),
);
const percent = named(
  "percentage",
  map(
    seq(text(seq(plus(d), opt(seq(lit("."), opt(plus(d)))))), opt(_), lit("%")),
    ([value]) => value,
  ),
);
const year = named("year", text(seq(d, d, d, d)));
const month = named("month", text(seq(year, lit("-"), d, d)));
const day = named("day", text(seq(d, d)));
const date = text(seq(month, lit("-"), day));

const by = lit("by", true);
const of = lit("of", true);
const repeatEvery = seq(lit("repeat", true), _, lit("every", true));
const starting = lit("starting", true);
const upTo = seq(lit("up", true), _, lit("to", true));
const hold = map(lit("hold", true), () => true);
const schedule = lit("schedule", true);
const full = map(seq(lit("full", true), _), () => true);
const priority = map(seq(lit("-", true), number), ([, value]) => value);
const remainder = map(
  seq(lit("remainder", true), opt(_), opt(positive)),
  ([, , weight]) => +(weight ?? 0) || 1,
);
const template = map(seq(lit("#template"), opt(priority)), ([, value]) => ({
  priority: +(value ?? 0),
  directive: "template" as const,
}));
const goal = map(lit("#goal", true), () => "goal" as const);

const increaseOrDecrease = alt(lit("increase", true), lit("decrease", true));
const decimal = text(seq(plus(d), opt(seq(lit("."), opt(plus(d))))));
const percentOrNumber = alt<{ value: string; type: "percent" | "fixed" }>(
  map(seq(decimal, opt(_), lit("%")), ([value]) => ({ value, type: "percent" })),
  map(decimal, (value) => ({ value, type: "fixed" })),
);
const modifier = map(seq(increaseOrDecrease, _, percentOrNumber), ([op, , value]) => ({
  adjustment: (op.toLowerCase() === "increase" ? 1 : -1) * +value.value,
  adjustmentType: value.type,
}));
const modifiers = map(seq(_, lit("["), modifier, lit("]")), ([, , value]) => value);

const repeat = named(
  "repeat interval",
  alt<{ annual: boolean; repeat?: number }>(
    map(lit("month", true), () => ({ annual: false })),
    map(seq(positive, _, lit("months", true)), ([n]) => ({ annual: false, repeat: +n })),
    map(lit("year", true), () => ({ annual: true })),
    map(seq(positive, _, lit("years", true)), ([n]) => ({ annual: true, repeat: +n })),
  ),
);

const limit: Parser<Limit> = alt<Limit>(
  map(
    seq(opt(_), upTo, _, amount, _, lit("per week starting", true), _, date, opt(_), opt(hold)),
    ([, , , value, , , , start, , held]) => ({
      amount: value,
      hold: held,
      period: "weekly",
      start,
    }),
  ),
  map(seq(opt(_), upTo, _, amount, _, lit("per day", true), opt(_), opt(hold)), (v) => ({
    amount: v[3],
    hold: v[7],
    period: "daily",
    start: null,
  })),
  map(seq(opt(_), upTo, _, amount, opt(_), opt(hold)), (v) => ({
    amount: v[3],
    hold: v[5],
    period: "monthly",
    start: null,
  })),
);

const percentOf = alt(
  map(seq(percent, _, of, _, lit("previous", true), _), ([value]) => ({
    percent: value,
    prev: true,
  })),
  map(seq(percent, _, of, _), ([value]) => ({ percent: value, prev: false })),
);

type Period = { period: "day" | "week" | "month" | "year"; amount: number };
const periodCount = alt<Period>(
  map(lit("day", true), () => ({ period: "day", amount: 1 })),
  map(seq(positive, _, lit("days", true), _), ([n]) => ({ period: "day", amount: +n })),
  map(seq(lit("week", true), _), () => ({ period: "week", amount: 1 })),
  map(seq(positive, _, lit("weeks", true)), ([n]) => ({ period: "week", amount: +n })),
  map(seq(positive, _, lit("months", true), _), ([n]) => ({ period: "month", amount: +n })),
  map(seq(lit("year", true), _), () => ({ period: "year", amount: 1 })),
  map(seq(positive, _, lit("years", true), _), ([n]) => ({ period: "year", amount: +n })),
);

const spendFrom = map(
  seq(_, lit("spend", true), _, lit("from", true), _, month),
  ([, , , , , value]) => value,
);

const startsModifier = seq(lit("["), increaseOrDecrease);
const rawScheduleName = map(
  text(
    seq(
      not(startsModifier),
      cls(/[^ \t\r\n]/, "[^ \\t\\r\\n]"),
      star(seq(not(seq(_, startsModifier)), cls(/[^\r\n]/, "[^\\r\\n]"))),
    ),
  ),
  (value) => value.trim(),
);

const name = named("Name", text(plus(cls(/[^\r\n\t]/, "[^\\r\\n\\t]"))));

const expr: Parser<Template> = alt<Template>(
  map(seq(template, _, percentOf, name), ([t, , p, category]) => ({
    type: "percentage",
    percent: +p.percent,
    previous: p.prev,
    category,
    priority: t.priority,
    directive: t.directive,
  })),
  map(
    seq(template, _, amount, _, repeatEvery, _, periodCount, _, starting, _, date, opt(limit)),
    ([t, , value, , , , period, , , , start, lim]) => ({
      type: "periodic",
      amount: value,
      period,
      starting: start,
      limit: lim,
      priority: t.priority,
      directive: t.directive,
    }),
  ),
  map(
    seq(template, _, amount, _, by, _, month, opt(spendFrom), opt(seq(_, repeatEvery, _, repeat))),
    ([t, , value, , , , target, from, rep]) =>
      ({
        type: from ? "spend" : "by",
        amount: value,
        month: target,
        ...(rep ? rep[3] : {}),
        from,
        priority: t.priority,
        directive: t.directive,
      }) as Template,
  ),
  map(seq(template, _, amount, opt(limit)), ([t, , monthly, lim]) => ({
    type: "simple",
    monthly,
    limit: lim,
    priority: t.priority,
    directive: t.directive,
  })),
  map(seq(template, _, limit), ([t, , lim]) => ({
    type: "simple",
    monthly: null,
    limit: lim,
    priority: t.priority,
    directive: t.directive,
  })),
  map(
    seq(template, _, schedule, _, opt(full), rawScheduleName, opt(modifiers)),
    ([t, , , , isFull, scheduleName, mods]) => ({
      type: "schedule",
      name: scheduleName.trim(),
      priority: t.priority,
      directive: t.directive,
      full: isFull,
      adjustment: mods?.adjustment,
      adjustmentType: mods?.adjustmentType,
    }),
  ),
  map(seq(template, _, remainder, opt(limit)), ([t, , weight, lim]) => ({
    type: "remainder",
    priority: null,
    directive: t.directive,
    weight,
    limit: lim,
  })),
  map(
    seq(
      template,
      _,
      lit("average", true),
      _,
      positive,
      _,
      opt(lit("months", true)),
      opt(modifiers),
    ),
    ([t, , , , count, , , mods]) => ({
      type: "average",
      numMonths: +count,
      priority: t.priority,
      directive: t.directive,
      adjustment: mods?.adjustment,
      adjustmentType: mods?.adjustmentType,
    }),
  ),
  map(
    seq(template, _, lit("copy from", true), _, positive, _, lit("months ago", true), opt(limit)),
    ([t, , , , lookBack, , , lim]) => ({
      type: "copy",
      priority: t.priority,
      directive: t.directive,
      lookBack: +lookBack,
      limit: lim,
    }),
  ),
  map(seq(goal, amount), ([directive, value]) => ({
    type: "goal",
    amount: value,
    priority: null,
    directive,
  })),
);

/** Parses one `#template` or `#goal` line, or throws a `TemplateSyntaxError`. */
export const parseTemplate = (line: string): Template => run(expr, line);

// ---------------------------------------------------------------------------------------------
// Cleanup templates
// ---------------------------------------------------------------------------------------------

export interface CleanupLine {
  readonly type: "source" | "sink" | null;
  readonly group: string | null;
  readonly weight?: number;
}

const space = named("space", plus(lit(" ")));
const digit = named("digit", cls(/[0-9]/, "[0-9]"));
const weight = named(
  "weight",
  map(text(plus(digit)), (value) => +value),
);
const source = lit("source");
const sink = lit("sink");
const sourceGroup = named("Name", text(star(seq(not(lit(" source")), any))));
const sinkGroup = named("Name", text(star(seq(not(lit(" sink")), any))));

const inner = alt<CleanupLine>(
  map(source, () => ({ group: null, type: "source" })),
  map(seq(sink, opt(space), opt(weight)), ([, , w]) => ({
    type: "sink",
    weight: +(w ?? 0) || 1,
    group: null,
  })),
  map(seq(sourceGroup, opt(space), source), ([group]) => ({
    group: group || null,
    type: "source",
  })),
  map(seq(opt(sinkGroup), opt(space), sink, opt(space), opt(weight)), ([group, , , , w]) => ({
    type: "sink",
    weight: +(w ?? 0) || 1,
    group: group || null,
  })),
  map(sourceGroup, (group) => ({ group, type: null })),
);

const cleanup = map(
  seq(
    lit("#cleanup"),
    space,
    lazy(() => inner),
  ),
  ([, , value]) => value,
);

/** Parses one `#cleanup` line, or throws a `TemplateSyntaxError`. */
export const parseCleanup = (line: string): CleanupLine => run(cleanup, line);
