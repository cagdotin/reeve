import * as d from "date-fns";
import Handlebars from "handlebars";
import { addDays, formatDate, parseDate, subDays } from "./dates.ts";

/** A Handlebars of its own with Actual's rule template helpers. */
export const templates = Handlebars.create();

const regexFormat = /^\/(.*)\/([gimuy]*)$/;

const mathHelper =
  (fn: (a: number, b: number) => number) =>
  (a: unknown, ...b: Array<unknown>) =>
    b.map(Number).reduce(fn, Number(a));

const regexHelper =
  (
    toRegex: (regex: string, flags: string) => string | RegExp,
    plain: (value: string) => string | RegExp,
    apply: (value: string, regex: string | RegExp, replace: string) => string,
  ) =>
  (value: unknown, regex: unknown, replace: unknown) => {
    if (value == null) return null;
    if (typeof regex !== "string" || typeof replace !== "string") return "";
    const match = regexFormat.exec(regex);
    return apply(String(value), match ? toRegex(match[1]!, match[2]!) : plain(regex), replace);
  };

const shift =
  (fn: (date: Date, n: number) => Date) =>
  (date?: string, n?: number): string | undefined =>
    !date || !n ? date : formatDate(fn(parseDate(date), n), "yyyy-MM-dd");

const helpers: Record<string, (...args: Array<any>) => unknown> = {
  regex: regexHelper(
    (regex, flags) => new RegExp(regex, flags),
    (value) => new RegExp(value),
    (value, regex, replace) => value.replace(regex, replace),
  ),
  replace: regexHelper(
    (regex, flags) => new RegExp(regex, flags),
    (value) => value,
    (value, regex, replace) => value.replace(regex, replace),
  ),
  replaceAll: regexHelper(
    (regex, flags) => new RegExp(regex, flags),
    (value) => value,
    (value, regex, replace) => value.replaceAll(regex, replace),
  ),
  add: mathHelper((a, b) => a + b),
  sub: mathHelper((a, b) => a - b),
  div: mathHelper((a, b) => a / b),
  mul: mathHelper((a, b) => a * b),
  mod: mathHelper((a, b) => a % b),
  floor: (a: unknown) => Math.floor(Number(a)),
  ceil: (a: unknown) => Math.ceil(Number(a)),
  round: (a: unknown) => Math.round(Number(a)),
  abs: (a: unknown) => Math.abs(Number(a)),
  min: mathHelper((a, b) => Math.min(a, b)),
  max: mathHelper((a, b) => Math.max(a, b)),
  fixed: (a: unknown, digits: unknown) => Number(a).toFixed(Number(digits)),
  day: (date?: string) => date && formatDate(date, "d"),
  month: (date?: string) => date && formatDate(date, "M"),
  year: (date?: string) => date && formatDate(date, "yyyy"),
  format: (date?: string, f?: string) => date && f && formatDate(date, f),
  addDays: (date?: string, days?: number) => (!date || !days ? date : addDays(date, days)),
  subDays: (date?: string, days?: number) => (!date || !days ? date : subDays(date, days)),
  addMonths: shift(d.addMonths),
  subMonths: shift(d.subMonths),
  addWeeks: shift(d.addWeeks),
  subWeeks: shift(d.subWeeks),
  addYears: shift(d.addYears),
  subYears: shift(d.subYears),
  setDay: (date?: string, day?: number) => {
    if (!date || day == null) return date;
    return addDays(date, day - Number(formatDate(date, "d")));
  },
  // oxlint-disable-next-line no-console
  debug: (value: unknown) => console.log(value),
  concat: (...args: Array<unknown>) => args.join(""),
};

for (const [name, fn] of Object.entries(helpers))
  // The last argument is Handlebars' options object.
  templates.registerHelper(name, (...args: Array<unknown>) => fn(...args.slice(0, -1)));
