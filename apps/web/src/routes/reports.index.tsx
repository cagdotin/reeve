import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { Page } from "@/components/page";
import { ReportSelector } from "@/components/reports/report-selector";
import { Button } from "@reeve/ui/components/button";
import { REPORT_LIBRARY } from "@/lib/report-library";

export const Route = createFileRoute("/reports/")({
  beforeLoad: ({ search }) => {
    const page = (search as Record<string, unknown>)["page"];
    if (typeof page === "string")
      throw redirect({ to: "/", search: { dashboard: page }, replace: true });
  },
  component: AllReports,
});

/** Every report, whatever the dashboards hold: a dashboard shows only what a person pinned to it. */
function AllReports() {
  return (
    <Page
      title="All reports"
      context={<ReportSelector name="All reports" />}
      actions={
        <Button variant="ghost" render={<Link to="/reports/custom" />}>
          <PlusIcon />
          New custom report
        </Button>
      }
    >
      <div className="grid gap-6">
        {REPORT_LIBRARY.map((group) => (
          <section key={group.label} aria-label={group.label} className="grid gap-3">
            <h2 className="text-[17px] text-muted-foreground">{group.label}</h2>
            <ul className="grid grid-cols-2 gap-2 max-lg:grid-cols-1">
              {group.reports.map((report) => (
                <li key={report.to}>
                  <Link
                    to={report.to}
                    className="flex h-16 items-center gap-3 rounded-xl border bg-card px-4 outline-none transition-shadow duration-150 hover:shadow-[inset_0_0_0_1px_var(--input)] focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary">
                      <report.icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{report.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {report.about}
                      </span>
                    </span>
                    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Page>
  );
}
