/** The contract's schedule and rule types, read off the catalog entries that carry them. */
import type { rules, schedules } from "@reeve/contract/catalog";

type Success<K extends keyof typeof schedules> = (typeof schedules)[K]["success"]["Type"];

export type Schedule = Success<"get_schedule">;
export type ScheduleStatus = Schedule["status"];
export type ScheduleAmount = NonNullable<Schedule["amount"]>;
export type Recurrence = Exclude<Schedule["date"], string>;
export type ScheduledTransaction = Success<"list_scheduled_transactions">[number];
export type DiscoveredSchedule = Success<"find_schedules">[number];
export type ScheduleOverview = Success<"schedule_activity">;
export type ScheduleActivity = ScheduleOverview["schedules"][number];
export type Forecast = Success<"forecast_balances">;

type Rule = (typeof rules)["get_rule"]["success"]["Type"];
export type RuleCondition = Rule["conditions"][number];
export type RuleAction = Rule["actions"][number];
