import type { CrossoverReport } from "@reeve/contract/catalog";
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import -- the reports routes are code-split, so recharts loads only with them.
import { CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { slot, useChartTheme } from "./chart-theme";
import { ChartBox, ChartLegend } from "./chart-parts";
import { categoryAxis, gridProps, valueAxis } from "./axes";
import { seriesTooltip } from "./series-tooltip";
import { intervalLabel } from "./meta";

/**
 * Monthly investment income at the safe withdrawal rate against monthly expenses; the projected
 * months are dashed, and the month income first covers expenses is marked.
 */
export function CrossoverGraph({
  report,
  compact = false,
  fetching,
  className,
}: {
  report: CrossoverReport;
  compact?: boolean | undefined;
  fetching?: boolean | undefined;
  className?: string | undefined;
}) {
  const theme = useChartTheme();
  const lastActual = report.points.findLastIndex((point) => !point.isProjection);
  const data = report.points.map((point, index) => {
    const actual = index <= lastActual;
    const projected = index >= lastActual;
    const expenses = point.adjustedExpenses ?? point.expenses;
    return {
      month: point.month,
      income: actual ? point.investmentIncome : null,
      expenses: actual ? expenses : null,
      incomeProjected: projected ? point.investmentIncome : null,
      expensesProjected: projected ? expenses : null,
    };
  });
  const names = compact
    ? { income: "Investment income", expenses: "Expenses" }
    : {
        income: "Investment income",
        expenses: "Expenses",
        incomeProjected: "Projected income",
        expensesProjected: "Projected expenses",
      };
  const lineProps = {
    type: "monotone" as const,
    strokeWidth: 2,
    dot: false,
    isAnimationActive: false,
  };
  return (
    <div className={className ?? "grid h-80 grid-rows-[auto_1fr] gap-2"}>
      {compact ? (
        <span />
      ) : (
        <ChartLegend
          items={[
            { label: "Investment income", color: slot(theme, 0), mark: "line" },
            { label: "Expenses", color: theme.out, mark: "line" },
            { label: "Projection", color: theme.tick, mark: "dashed" },
          ]}
        />
      )}
      <ChartBox fetching={fetching}>
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          {!compact && <CartesianGrid {...gridProps(theme)} />}
          <XAxis
            dataKey="month"
            {...categoryAxis(theme)}
            tickFormatter={intervalLabel}
            hide={compact}
          />
          <YAxis {...valueAxis(theme)} hide={compact} />
          <Tooltip
            cursor={{ stroke: theme.axis }}
            content={seriesTooltip({ names, title: intervalLabel })}
          />
          {report.crossoverMonth !== null && (
            <ReferenceLine
              x={report.crossoverMonth}
              stroke={theme.tick}
              {...(compact
                ? {}
                : {
                    label: {
                      value: "Crossover",
                      position: "insideTopRight",
                      fill: theme.tick,
                      fontSize: 11,
                    },
                  })}
            />
          )}
          <Line {...lineProps} dataKey="income" stroke={slot(theme, 0)} />
          <Line {...lineProps} dataKey="expenses" stroke={theme.out} />
          <Line
            {...lineProps}
            dataKey="incomeProjected"
            stroke={slot(theme, 0)}
            strokeDasharray="5 4"
          />
          <Line
            {...lineProps}
            dataKey="expensesProjected"
            stroke={theme.out}
            strokeDasharray="5 4"
          />
        </LineChart>
      </ChartBox>
    </div>
  );
}
