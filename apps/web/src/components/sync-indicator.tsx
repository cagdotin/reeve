import { Button } from "@reeve/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@reeve/ui/components/tooltip";
import { PageAlert } from "@/components/page-alert";
import { useSync } from "@/components/sync-provider";
import { SYNC_DOTS, SYNC_LABELS } from "@/lib/sync-status";
import { cn } from "@reeve/ui/lib/utils";

/** The books never leave this machine, whatever the connection, so this says only the connection. */
const SHORT = {
  connecting: "On this computer · connecting",
  live: "On this computer · live",
  reconnecting: "On this computer · reconnecting",
  offline: "On this computer · offline",
} as const;

/** The connection's state, and a retry when it is down. */
export function SyncStatus() {
  const { status, retry } = useSync();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            className="gap-1.5 font-normal text-muted-foreground"
            onClick={retry}
            aria-label={SYNC_LABELS[status]}
          >
            <span className={cn("size-1.5 rounded-full", SYNC_DOTS[status])} />
            {SHORT[status]}
          </Button>
        }
      />
      <TooltipContent>{SYNC_LABELS[status]}</TooltipContent>
    </Tooltip>
  );
}

/** Says nothing until the connection is lost: a working one is not news. */
export function SyncAlert() {
  const { status, retry } = useSync();
  if (status !== "reconnecting" && status !== "offline") return null;
  return (
    <PageAlert
      variant={status === "offline" ? "error" : "warning"}
      title={status === "offline" ? "This page lost its connection" : "Reconnecting…"}
      action={
        <Button variant="ghost" onClick={retry}>
          Retry
        </Button>
      }
    >
      Your books are safe on this computer. The page may be out of date until it reconnects.
    </PageAlert>
  );
}
