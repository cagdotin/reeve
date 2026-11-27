import type { LeftoverRule, Target } from "@reeve/contract/targets";

/** What the editor's fields and checks need from the book. */
export interface EditorContext {
  /** The month the editor previews and applies to. */
  readonly month: string;
  readonly schedules: ReadonlyArray<{ readonly name: string; readonly completed: boolean }>;
  readonly incomes: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}

export const firstOfMonth = (month: string) => `${month}-01`;

/** A target in the editor, with a key that survives reordering. */
export interface Entry {
  readonly key: string;
  readonly target: Target;
}

let nextKey = 0;
export const entry = (target: Target): Entry => ({ key: `target-${nextKey++}`, target });

/** Where a category's leftover money goes at month end: one choice. */
export type LeftoverChoice =
  | { readonly kind: "keep" }
  | { readonly kind: "give-back" }
  | { readonly kind: "send"; readonly to: string | null }
  | { readonly kind: "pool-give"; readonly pool: string };

/** The editor's leftover form: one destination, collecting, and the rest of the pool rules. */
export interface LeftoverForm {
  readonly choice: LeftoverChoice;
  /** The share this category collects of what others give back; null when it does not. */
  readonly collect: number | null;
  readonly pools: ReadonlyArray<
    Extract<LeftoverRule, { kind: "pool-receive" | "pool-cover" }> & { readonly key: string }
  >;
  /** Rules the form has no place for (a second destination): kept as they are. */
  readonly extra: ReadonlyArray<LeftoverRule>;
}

const isDestination = (
  rule: LeftoverRule,
): rule is Extract<LeftoverRule, { kind: "give-back" | "send" | "pool-give" }> =>
  rule.kind === "give-back" || rule.kind === "send" || rule.kind === "pool-give";

export const leftoverForm = (rules: ReadonlyArray<LeftoverRule>): LeftoverForm => {
  const destination = rules.find(isDestination);
  const collect = rules.find((rule) => rule.kind === "receive");
  return {
    choice: destination ?? { kind: "keep" },
    collect: collect?.kind === "receive" ? collect.weight : null,
    pools: rules.flatMap((rule) =>
      rule.kind === "pool-receive" || rule.kind === "pool-cover"
        ? [{ ...rule, key: `pool-${nextKey++}` }]
        : [],
    ),
    extra: rules.filter(
      (rule) =>
        (isDestination(rule) && rule !== destination) ||
        (rule.kind === "receive" && rule !== collect),
    ),
  };
};

/** The rules a leftover form saves; null while it is not complete (a send without a category). */
export const leftoverRules = (form: LeftoverForm): Array<LeftoverRule> | null => {
  const rules: Array<LeftoverRule> = [];
  const { choice } = form;
  if (choice.kind === "send") {
    if (choice.to === null) return null;
    rules.push({ kind: "send", to: choice.to });
  } else if (choice.kind === "pool-give") {
    if (choice.pool.trim() === "") return null;
    rules.push({ kind: "pool-give", pool: choice.pool.trim() });
  } else if (choice.kind === "give-back") rules.push({ kind: "give-back" });
  if (form.collect !== null) rules.push({ kind: "receive", weight: form.collect });
  for (const { key: _key, ...rule } of form.pools) {
    if (rule.pool.trim() === "") return null;
    rules.push({ ...rule, pool: rule.pool.trim() });
  }
  return [...rules, ...form.extra];
};

export const newPoolRule = (): LeftoverForm["pools"][number] => ({
  kind: "pool-receive",
  pool: "",
  weight: 1,
  key: `pool-${nextKey++}`,
});
