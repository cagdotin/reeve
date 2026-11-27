export const SYNC_LABELS = {
  connecting: "Connecting…",
  live: "Live: changes from the CLI and agents appear instantly",
  reconnecting: "Reconnecting…",
  offline: "Offline: click to retry",
} as const;

export const SYNC_DOTS = {
  connecting: "bg-sync-pending animate-pulse",
  live: "bg-sync-live",
  reconnecting: "bg-sync-pending animate-pulse",
  offline: "bg-destructive",
} as const;
