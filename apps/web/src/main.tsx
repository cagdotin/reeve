import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, ErrorComponent, RouterProvider } from "@tanstack/react-router";
import { domMax, LazyMotion, MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Page } from "@/components/page";
import { ThemeProvider } from "@/components/theme-provider";
import { ToastProvider } from "@reeve/ui/components/toast";
import { TooltipProvider } from "@reeve/ui/components/tooltip";
import { initDesktopChrome } from "@/lib/desktop";
import { routeTree } from "./routeTree.gen";
import "./index.css";

initDesktopChrome();

const queryClient = new QueryClient({
  defaultOptions: {
    // SSE drives freshness; refetching on focus covers missed events.
    queries: { staleTime: 30_000, refetchOnWindowFocus: true },
  },
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  defaultNotFoundComponent: () => (
    <Page title="Not found">
      <p className="text-sm text-muted-foreground">There is no such page.</p>
    </Page>
  ),
  defaultErrorComponent: ({ error }) => (
    <Page title="Something went wrong">
      <ErrorComponent error={error} />
    </Page>
  ),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delay={400}>
          <ToastProvider position="bottom-right">
            <LazyMotion features={domMax} strict>
              <MotionConfig reducedMotion="user">
                <RouterProvider router={router} />
              </MotionConfig>
            </LazyMotion>
          </ToastProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
