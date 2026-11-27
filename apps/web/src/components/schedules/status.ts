import type { ScheduleStatus } from "@reeve/contract/catalog";

/** How each schedule status reads, and its badge. */
export const STATUS: Record<
  ScheduleStatus,
  { label: string; variant: "error" | "warning" | "info" | "secondary" | "success" | "outline" }
> = {
  missed: { label: "Missed", variant: "error" },
  due: { label: "Due", variant: "warning" },
  upcoming: { label: "Upcoming", variant: "info" },
  scheduled: { label: "Scheduled", variant: "outline" },
  paid: { label: "Paid", variant: "success" },
  completed: { label: "Completed", variant: "secondary" },
};
