import { useRouter } from "@tanstack/react-router";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@reeve/ui/components/button";
import { cn } from "@reeve/ui/lib/utils";
import { useHistoryPosition } from "@/lib/history";

/** Back and forward through the pages this window has shown. */
export function HistoryButtons({ className }: { className?: string }) {
  const router = useRouter();
  const { canGoBack, canGoForward } = useHistoryPosition();
  return (
    <div className={cn("flex shrink-0 items-center gap-0.5 app-no-drag max-md:hidden", className)}>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Go back"
        disabled={!canGoBack}
        onClick={() => router.history.back()}
      >
        <ChevronLeftIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Go forward"
        disabled={!canGoForward}
        onClick={() => router.history.forward()}
      >
        <ChevronRightIcon />
      </Button>
    </div>
  );
}
