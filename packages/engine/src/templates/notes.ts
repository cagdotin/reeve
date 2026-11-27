/** Templates written in category notes, as Actual's `template-notes.ts` and `cleanup-template-notes.ts`. */
import { parseCleanup, parseTemplate } from "./grammar.ts";
import type { CleanupTemplate, Limit, RefillTemplate, Template } from "./types.ts";

export const TEMPLATE_PREFIX = "#template";
export const GOAL_PREFIX = "#goal";
const CLEANUP_PREFIX = "#cleanup";

const checkAdjustment = (template: Template) => {
  if (
    (template.type === "average" || template.type === "schedule") &&
    template.adjustment !== undefined &&
    template.adjustmentType === "percent" &&
    (template.adjustment <= -100 || template.adjustment > 1000)
  )
    throw new Error(
      `Invalid adjustment percentage (${template.adjustment}%). Must be between -100% and 1000%`,
    );
};

/**
 * The templates of a note, one per `#template` or `#goal` line; a line that does not parse is an
 * `error` template. Prose lines right above a template line are its description.
 */
export const templatesOfNote = (note: string | null): Array<Template> => {
  if (!note) return [];
  const templates: Array<Template> = [];
  let descriptionLines: Array<string> = [];
  for (const line of note.split("\n")) {
    const trimmed = line.substring(line.indexOf("#")).trim();
    if (!trimmed.startsWith(TEMPLATE_PREFIX) && !trimmed.startsWith(GOAL_PREFIX)) {
      if (line.trim() === "" || trimmed.startsWith(CLEANUP_PREFIX)) descriptionLines = [];
      else descriptionLines.push(line.trimEnd());
      continue;
    }
    const description = descriptionLines.length > 0 ? descriptionLines.join("\n") : undefined;
    descriptionLines = [];
    let template: Template;
    try {
      template = parseTemplate(trimmed);
      checkAdjustment(template);
    } catch (error) {
      template = {
        type: "error",
        directive: "error",
        line,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    templates.push(description !== undefined ? { ...template, description } : template);
  }
  return templates;
};

/** Actual's check: each line that does not parse, and each schedule that does not exist. */
export const templateErrors = (
  categoryName: string,
  templates: ReadonlyArray<Template>,
  scheduleNames: ReadonlyArray<string | null>,
): Array<string> =>
  templates.flatMap((template) => {
    if (template.type === "error")
      return template.error.includes("adjustment")
        ? [`${categoryName}: ${template.line}\nError: ${template.error}`]
        : [`${categoryName}: ${template.line}`];
    if (template.type === "schedule" && template.name && !scheduleNames.includes(template.name))
      return [`${categoryName}: Schedule "${template.name}" does not exist`];
    return [];
  });

// ---------------------------------------------------------------------------------------------
// Writing templates back as note lines (Actual's `unparse`)
// ---------------------------------------------------------------------------------------------

const prefixFromPriority = (priority: number | null | undefined) =>
  priority === null || priority === undefined || priority === 0
    ? TEMPLATE_PREFIX
    : `${TEMPLATE_PREFIX}-${priority}`;

const limitToString = (limit: Pick<Limit, "amount" | "hold" | "period" | "start">) => {
  const base =
    limit.period === "weekly"
      ? `up to ${limit.amount} per week starting ${limit.start}`
      : limit.period === "daily"
        ? `up to ${limit.amount} per day`
        : `up to ${limit.amount}`;
  return limit.hold ? `${base} hold` : base;
};

const repeatToString = (annual: boolean | undefined, repeat: number | undefined) => {
  if (annual === undefined) return null;
  if (annual) return !repeat || repeat === 1 ? "year" : `${repeat} years`;
  return !repeat || repeat === 1 ? "month" : `${repeat} months`;
};

const trimTrailingZeros = (n: number) => {
  const s = n.toString();
  if (!s.includes(".")) return s;
  return s.replace(/\.0+$/, "").replace(/(\.[0-9]*[1-9])0+$/, "$1");
};

const adjustmentToString = (adjustment: number | undefined, type: string | undefined) => {
  if (adjustment === undefined) return "";
  const op = adjustment >= 0 ? "increase" : "decrease";
  return ` [${op} ${Math.abs(adjustment)}${type === "percent" ? "%" : ""}]`;
};

const templateToLine = (template: Template, refill: RefillTemplate | undefined): string | null => {
  if (template.type === "error") return null;
  if (template.type === "goal") return `${GOAL_PREFIX} ${template.amount}`;
  const prefix = prefixFromPriority(template.priority);
  switch (template.type) {
    case "simple": {
      let result = prefix;
      if (template.monthly != null) result += ` ${template.monthly}`;
      if (template.limit) result += ` ${limitToString(template.limit)}`;
      return result.trim();
    }
    case "schedule":
      return `${prefix} schedule${template.full ? " full" : ""} ${template.name}${adjustmentToString(template.adjustment, template.adjustmentType)}`;
    case "percentage":
      return `${prefix} ${trimTrailingZeros(template.percent)}% of ${template.previous ? "previous " : ""}${template.category}`.trim();
    case "periodic": {
      let result = `${prefix} ${template.amount} repeat every ${template.period.amount} ${template.period.period}s starting ${template.starting}`;
      if (template.limit) result += ` ${limitToString(template.limit)}`;
      return result;
    }
    case "by":
    case "spend": {
      let result = `${prefix} ${template.amount} by ${template.month}`;
      if (template.type === "spend" && template.from) result += ` spend from ${template.from}`;
      const repeat = repeatToString(template.annual, template.repeat);
      if (repeat) result += ` repeat every ${repeat}`;
      return result;
    }
    case "remainder": {
      let result = `${prefix} remainder`;
      if (template.weight !== 1) result += ` ${template.weight}`;
      if (template.limit) result += ` ${limitToString(template.limit)}`;
      return result;
    }
    case "average":
      return `${prefix} average ${template.numMonths} months${adjustmentToString(template.adjustment, template.adjustmentType)}`;
    case "copy":
      return `${prefix} copy from ${template.lookBack} months ago`;
    case "limit":
      return refill
        ? `${prefixFromPriority(refill.priority)} ${limitToString(template)}`
        : `${prefix} 0 ${limitToString(template)}`;
    default:
      return null;
  }
};

/** Templates as note text: each line under its description. A refill merges into the limit. */
export const unparse = (templates: ReadonlyArray<Template>): string => {
  const refill = templates.find(
    (template): template is RefillTemplate => template.type === "refill",
  );
  return templates
    .filter((template) => template.type !== "refill")
    .flatMap((template) => {
      const line = templateToLine(template, refill);
      if (line === null) return [];
      const description = (template.description ?? "")
        .split("\n")
        .map((descriptionLine) => descriptionLine.trimEnd())
        .filter((descriptionLine) => descriptionLine !== "");
      return [...description, line];
    })
    .join("\n");
};

// ---------------------------------------------------------------------------------------------
// Cleanup lines
// ---------------------------------------------------------------------------------------------

/**
 * The `#cleanup` lines of a note; lines that do not parse are skipped, as Actual does. A group is
 * named case-insensitively, so its id is the lower-cased name; `names` collects each group's name
 * as first written.
 */
export const cleanupOfNote = (
  note: string | null,
  names?: Map<string, string>,
): Array<CleanupTemplate> => {
  if (!note) return [];
  const rows: Array<CleanupTemplate> = [];
  for (const line of note.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.toLowerCase().startsWith(`${CLEANUP_PREFIX} `)) continue;
    try {
      const raw = parseCleanup(trimmed);
      const groupId = raw.group === null ? null : groupKey(raw.group);
      if (raw.group !== null && groupId !== null && !names?.has(groupId))
        names?.set(groupId, raw.group.trim());
      if (raw.type === "source") rows.push({ role: "source", groupId });
      else if (raw.type === "sink") rows.push({ role: "sink", groupId, weight: raw.weight ?? 1 });
      else if (groupId !== null && groupId !== "") rows.push({ role: "overspend", groupId });
    } catch {
      // Actual skips a line that does not parse.
    }
  }
  return rows;
};

export const groupKey = (name: string): string => name.trim().toLowerCase();
