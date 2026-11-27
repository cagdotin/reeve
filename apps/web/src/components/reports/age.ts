/** The age Actual calls good (a month), and the color of an age: good, getting there, or short. */
export const TARGET_AGE = 30;

export const ageTone = (age: number | null) =>
  age === null
    ? "text-muted-foreground"
    : age >= TARGET_AGE
      ? "text-success-foreground"
      : age >= 14
        ? "text-warning-foreground"
        : "text-destructive-foreground";

export const TREND = {
  up: "↑ Improving",
  down: "↓ Declining",
  stable: "→ Stable",
} as const;

export const ageText = (age: number | null) =>
  age === null ? "N/A" : `${age} ${age === 1 ? "day" : "days"}`;
