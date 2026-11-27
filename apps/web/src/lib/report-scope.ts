import type { AccountScope } from "@reeve/contract/catalog";

const MODES = new Set(["all", "budgeted", "offbudget", "selected"]);

/** An account scope read from an address, when it is one. */
export const parseScope = (value: unknown): AccountScope | undefined => {
  if (typeof value !== "object" || value === null || !("mode" in value)) return undefined;
  const { mode } = value;
  if (typeof mode !== "string" || !MODES.has(mode)) return undefined;
  if (mode !== "selected") return { mode } as AccountScope;
  const ids = "ids" in value ? value.ids : undefined;
  return Array.isArray(ids) && ids.length > 0 && ids.every((id) => typeof id === "string")
    ? { mode, ids }
    : undefined;
};

/** What an operation that follows accounts takes for a scope. */
export const scopeInput = (scope: AccountScope | undefined) =>
  scope === undefined ? {} : { scope };

const GROUPS = {
  all: "All accounts",
  budgeted: "Budget accounts",
  offbudget: "Off-budget accounts",
} as const;

/** A scope's name: its group, its one account, or how many accounts it picks. */
export const scopeLabel = (
  scope: AccountScope,
  accounts: ReadonlyArray<{ readonly id: string; readonly name: string }> | undefined,
) => {
  if (scope.mode !== "selected") return GROUPS[scope.mode];
  const names = scope.ids.flatMap((id) => accounts?.find((a) => a.id === id)?.name ?? []);
  if (names.length === 0)
    return scope.ids.length === 1 ? "1 account" : `${scope.ids.length} accounts`;
  return names.length <= 2 && names.length === scope.ids.length
    ? names.join(" and ")
    : `${scope.ids.length} accounts`;
};
