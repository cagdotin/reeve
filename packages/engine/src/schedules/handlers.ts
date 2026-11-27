import type { schedules } from "@reeve/contract/catalog";
import type { DomainHandlers } from "../handler.ts";
import { scheduleActivity } from "./activity.ts";
import { findSchedules } from "./find.ts";
import { forecastBalances } from "./forecast.ts";
import { getRecurringDescription, getScheduleDates, getUpcomingDates } from "./recurrence.ts";
import {
  completeSchedule,
  createSchedule,
  deleteSchedule,
  getSchedule,
  listScheduledTransactions,
  listSchedules,
  loadById,
  postScheduleTransaction,
  restoreSchedule,
  runSchedules,
  skipScheduleDate,
  updateSchedule,
} from "./schedules.ts";
import { invalid, readSettings } from "../book.ts";
import { today } from "@reeve/contract/rules";

export { advanceSchedules } from "./schedules.ts";

/** Schedules: recurring and one-off transactions, upcoming and auto-posted. */
export const scheduleHandlers = {
  list_schedules: listSchedules,
  schedule_activity: scheduleActivity,
  get_schedule: getSchedule,
  create_schedule: createSchedule,
  update_schedule: updateSchedule,
  delete_schedule: (book, { id }) => deleteSchedule(book, id),
  skip_schedule_date: (book, { id }) => skipScheduleDate(book, id),
  post_schedule_transaction: postScheduleTransaction,
  complete_schedule: (book, { id }) => completeSchedule(book, id),
  restore_schedule: (book, { id }) => restoreSchedule(book, id),
  list_schedule_dates: (book, { id, from, to, count }) => {
    const schedule = loadById(book.db, id);
    if (schedule.date === null) return [];
    if (count !== undefined && count < 0) return invalid("The count cannot be negative");
    return getScheduleDates(schedule.date, {
      start: from ?? today(),
      ...(to !== undefined ? { end: to } : {}),
      ...(count !== undefined ? { count } : to === undefined ? { count: 10 } : {}),
    });
  },
  preview_recurrence: (book, { count, ...config }) => {
    if (count !== undefined && count < 1) return invalid("The count is at least 1");
    return {
      description: getRecurringDescription(config, readSettings(book.db).dateFormat),
      dates: getUpcomingDates(config, count ?? 5),
    };
  },
  list_scheduled_transactions: listScheduledTransactions,
  find_schedules: (book, input) => findSchedules(book, input),
  run_schedules: runSchedules,
  forecast_balances: (book, input) => forecastBalances(book, input),
} satisfies DomainHandlers<typeof schedules>;
