import type { TargetKind } from "@reeve/contract/targets";
import {
  CornerUpRightIcon,
  ArrowUpToLineIcon,
  CalendarCheckIcon,
  CalendarClockIcon,
  ChartPieIcon,
  FlagIcon,
  HistoryIcon,
  PercentIcon,
  RepeatIcon,
  type LucideIcon,
} from "lucide-react";

/** Each kind of target's icon, in the editor and on the category's row. */
export const ICONS: Record<TargetKind, LucideIcon> = {
  fixed: RepeatIcon,
  "save-by": CalendarClockIcon,
  "top-up": ArrowUpToLineIcon,
  goal: FlagIcon,
  schedule: CalendarCheckIcon,
  percentage: PercentIcon,
  history: HistoryIcon,
  remainder: ChartPieIcon,
};

/** End-of-month leftover rules: money that moves on when the month closes. */
export const LEFTOVER_ICON: LucideIcon = CornerUpRightIcon;
