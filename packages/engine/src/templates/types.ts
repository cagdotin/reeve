/** Actual's template shapes (`types/models/templates.ts`); amounts are in whole currency units. */

interface BaseTemplate {
  readonly description?: string;
}

interface WithPriority extends BaseTemplate {
  readonly directive: "template";
  readonly priority: number;
}

export interface Limit {
  readonly amount: number;
  readonly hold: boolean | null;
  readonly period: "daily" | "weekly" | "monthly";
  readonly start?: string | null;
}

export interface PercentageTemplate extends WithPriority {
  readonly type: "percentage";
  readonly percent: number;
  readonly previous: boolean;
  readonly category: string;
}

export interface PeriodicTemplate extends WithPriority {
  readonly type: "periodic";
  readonly amount: number;
  readonly period: { readonly period: "day" | "week" | "month" | "year"; readonly amount: number };
  readonly starting: string;
  readonly limit?: Limit | null;
}

export interface ByTemplate extends WithPriority {
  readonly type: "by";
  readonly amount: number;
  readonly month: string;
  readonly annual?: boolean;
  readonly repeat?: number;
  readonly from?: string | null;
}

export interface SpendTemplate extends WithPriority {
  readonly type: "spend";
  readonly amount: number;
  readonly month: string;
  readonly from: string;
  readonly annual?: boolean;
  readonly repeat?: number;
}

export interface SimpleTemplate extends WithPriority {
  readonly type: "simple";
  readonly monthly?: number | null;
  readonly limit?: Limit | null;
}

export interface ScheduleTemplate extends WithPriority {
  readonly type: "schedule";
  readonly name?: string;
  readonly scheduleId?: string;
  readonly full?: boolean | null;
  readonly adjustment?: number | undefined;
  readonly adjustmentType?: "percent" | "fixed" | undefined;
}

export interface AverageTemplate extends WithPriority {
  readonly type: "average";
  readonly numMonths: number;
  readonly adjustment?: number | undefined;
  readonly adjustmentType?: "percent" | "fixed" | undefined;
}

export interface CopyTemplate extends WithPriority {
  readonly type: "copy";
  readonly lookBack: number;
  readonly limit?: Limit | null;
}

export interface RemainderTemplate extends BaseTemplate {
  readonly type: "remainder";
  readonly weight: number;
  readonly limit?: Limit | null;
  readonly directive: "template";
  readonly priority: null;
}

export interface RefillTemplate extends WithPriority {
  readonly type: "refill";
}

export interface GoalTemplate extends BaseTemplate {
  readonly type: "goal";
  readonly amount: number;
  readonly directive: "goal";
  readonly priority?: null;
}

export interface LimitTemplate extends BaseTemplate {
  readonly type: "limit";
  readonly amount: number;
  readonly hold: boolean;
  readonly period: "daily" | "weekly" | "monthly";
  readonly start?: string;
  readonly directive: "template";
  readonly priority: null;
}

export interface ErrorTemplate extends BaseTemplate {
  readonly type: "error";
  readonly line: string;
  readonly error: string;
  readonly directive: "error";
}

export type Template =
  | PercentageTemplate
  | PeriodicTemplate
  | ByTemplate
  | SpendTemplate
  | SimpleTemplate
  | ScheduleTemplate
  | RemainderTemplate
  | AverageTemplate
  | GoalTemplate
  | CopyTemplate
  | RefillTemplate
  | LimitTemplate
  | ErrorTemplate;

/** A `#cleanup` line: give leftover money away (source), take it (sink), or be topped up (overspend). */
export type CleanupTemplate =
  | { readonly role: "source"; readonly groupId: string | null }
  | { readonly role: "sink"; readonly groupId: string | null; readonly weight: number }
  | { readonly role: "overspend"; readonly groupId: string };
