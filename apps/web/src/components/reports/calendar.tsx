import type { CalendarReport } from "@reeve/contract/catalog";
import { format, parseISO } from "date-fns";
import { cn } from "@reeve/ui/lib/utils";
import { useBook } from "@/lib/book";
import { slot, useChartTheme } from "./chart-theme";
import { longMonth, shortMonth } from "./meta";

type Month = CalendarReport["months"][number];

/** One month as a grid of days, each with its income and expense as bars sized by their share. */
export function CalendarMonth({
  month,
  compact = false,
  onPickDay,
}: {
  month: Month;
  compact?: boolean | undefined;
  onPickDay?: ((day: string) => void) | undefined;
}) {
  const theme = useChartTheme();
  const { format: money } = useBook();
  const income = slot(theme, 0);
  const expense = theme.out;
  return (
    <div className="grid min-w-0 content-start gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn("font-medium", compact ? "text-xs" : "text-sm")}>
          {compact ? shortMonth(month.month) : longMonth(month.month)}
        </span>
        {!compact && (
          <span className="flex gap-3 text-xs tabular-nums">
            <span className="flex items-center gap-1">
              <span
                aria-hidden
                className="size-2 rounded-[2px]"
                style={{ backgroundColor: income }}
              />
              {money(month.totalIncome)}
            </span>
            <span className="flex items-center gap-1">
              <span
                aria-hidden
                className="size-2 rounded-[2px]"
                style={{ backgroundColor: expense }}
              />
              {money(month.totalExpense)}
            </span>
          </span>
        )}
      </div>
      <div className="grid grid-cols-7 gap-px text-[10px] text-muted-foreground">
        {month.days.slice(0, 7).map((day) => (
          <span key={day.date} className="text-center">
            {format(parseISO(day.date), compact ? "EEEEE" : "EEE")}
          </span>
        ))}
        {month.days.map((day) => {
          const title = `${day.date}: income ${money(day.income)}, expenses ${money(day.expense)}`;
          const body = (
            <>
              <span className={cn("leading-none", compact ? "text-[9px]" : "text-[11px]")}>
                {Number(day.date.slice(8, 10))}
              </span>
              <span className="mt-auto grid gap-px">
                <span
                  className="h-1 rounded-r-[2px]"
                  style={{
                    width: `${Math.max(day.incomeSize, day.income > 0 ? 4 : 0)}%`,
                    backgroundColor: income,
                  }}
                />
                <span
                  className="h-1 rounded-r-[2px]"
                  style={{
                    width: `${Math.max(day.expenseSize, day.expense > 0 ? 4 : 0)}%`,
                    backgroundColor: expense,
                  }}
                />
              </span>
            </>
          );
          const cell = cn(
            "flex flex-col rounded-[3px] p-0.5 text-left",
            compact ? "h-7" : "h-12",
            day.inMonth ? "bg-muted/60 text-foreground" : "invisible",
          );
          return onPickDay && day.inMonth ? (
            <button
              key={day.date}
              type="button"
              title={title}
              className={cn(cell, "cursor-pointer hover:bg-accent")}
              onClick={() => onPickDay(day.date)}
            >
              {body}
            </button>
          ) : (
            <span key={day.date} title={title} className={cell}>
              {body}
            </span>
          );
        })}
      </div>
    </div>
  );
}
