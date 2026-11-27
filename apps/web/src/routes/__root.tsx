import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { RefreshCwIcon, ServerOffIcon } from "lucide-react";
import { useState } from "react";
import { AppFrame } from "@/components/app-frame";
import { AppLoading } from "@/components/app-loading";
import { CommandPalette } from "@/components/command-palette";
import { SyncProvider } from "@/components/sync-provider";
import { UndoKeys } from "@/components/undo-keys";
import { Button } from "@reeve/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@reeve/ui/components/empty";
import { WindowDragArea } from "@/components/window-drag-area";
import { healthQuery, run } from "@/lib/api";
import { BookProvider } from "@/lib/book";
import { CommandsContext } from "@/lib/commands";
import { useHotkeys } from "@/lib/hotkeys";
import { lastBook } from "@/lib/prefs";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Root,
});

/** The book this window shows: the one picked last, else the default book. */
const openBook = async () => {
  const remembered = lastBook.get();
  if (remembered !== null) {
    try {
      return await run("get_book", { book: remembered });
    } catch {
      lastBook.set(null);
    }
  }
  return run("get_book", {});
};

function Root() {
  const health = useQuery(healthQuery);
  const book = useQuery({
    queryKey: ["open-book"],
    queryFn: openBook,
    enabled: health.isSuccess,
    staleTime: Infinity,
  });

  if (health.isPending || (health.isSuccess && book.isPending)) return <AppLoading />;

  if (health.isError || book.isError) {
    return (
      <Empty className="h-svh">
        <WindowDragArea />
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ServerOffIcon />
          </EmptyMedia>
          <EmptyTitle>Can't reach reeve</EmptyTitle>
          <EmptyDescription>
            {book.error?.message ?? "Make sure the reeve server is running, then try again."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant="outline"
            onClick={() => void (health.isError ? health.refetch() : book.refetch())}
          >
            <RefreshCwIcon data-icon="inline-start" />
            Retry
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <SyncProvider>
      <BookProvider book={book.data!}>
        <Shell />
      </BookProvider>
    </SyncProvider>
  );
}

function Shell() {
  const [palette, setPalette] = useState(false);
  useHotkeys({ "mod+k": () => setPalette((open) => !open) });
  return (
    <CommandsContext.Provider value={setPalette}>
      <AppFrame>
        <Outlet />
        <CommandPalette open={palette} onOpenChange={setPalette} />
        <UndoKeys />
      </AppFrame>
    </CommandsContext.Provider>
  );
}
