import { ApiError } from "@reeve/contract/client";
import { Spinner } from "@reeve/ui/components/spinner";
import { useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PageAlert } from "@/components/page-alert";
import { SlotsContext } from "@/components/page-slots";
import { useSync } from "@/components/sync-provider";

export type PageWidth = "column" | "window";

const MAIN: Record<PageWidth, string> = {
  column:
    "@container mx-auto flex w-full max-w-[1240px] min-w-0 flex-1 flex-col px-(--page-gutter) pt-10 pb-10 max-md:pt-4 max-md:pb-6",
  window: "@container flex min-w-0 flex-1 flex-col",
};

/** What `useQuery` returns, as far as a page waits on it. */
export interface PageQuery<T> {
  readonly data: T | undefined;
  readonly error: Error | null;
}

interface PageBase {
  /** The h1: visible beside the back arrow, for screen readers under tabs. */
  readonly title: ReactNode;
  /** Shown in every state, so an action that needs the data disables itself on `query.data === undefined`. */
  readonly actions?: ReactNode;
  /** What this page shows of its tab, chosen right after the tabs: a dashboard or a report. */
  readonly context?: ReactNode;
  readonly width?: PageWidth;
}

export type PageProps<T> = PageBase &
  (
    | { readonly query?: undefined; readonly children: ReactNode }
    | { readonly query: PageQuery<T>; readonly children: (data: T) => ReactNode }
  );

/** A page: its title and actions for the frame, and its `<main>`, whose content may wait on a query. */
export function Page<T = never>(props: PageProps<T>) {
  const slots = useContext(SlotsContext);
  const body =
    props.query === undefined ? (
      props.children
    ) : (
      <QueryBody query={props.query}>{props.children}</QueryBody>
    );
  return (
    <>
      {slots.title &&
        createPortal(
          <h1 className="min-w-0 truncate text-sm font-medium">{props.title}</h1>,
          slots.title,
        )}
      {slots.context && createPortal(props.context, slots.context)}
      {slots.actions && createPortal(props.actions, slots.actions)}
      <main className={MAIN[props.width ?? "column"]}>{body}</main>
    </>
  );
}

/**
 * The same wait for one region, where controls stay above it. It waits on the data and not on `isPending`, so what
 * a query keeps through a scope change or a failed refresh stays on the page.
 */
export function QueryBody<T>({
  query,
  children,
}: {
  query: PageQuery<T>;
  children: (data: T) => ReactNode;
}) {
  const waiting = query.data === undefined;
  const connection = useSync().status;
  const saidByConnectionAlert =
    !waiting &&
    !(query.error instanceof ApiError) &&
    (connection === "reconnecting" || connection === "offline");
  return (
    <>
      {query.error !== null && !saidByConnectionAlert && (
        <PageAlert
          variant="error"
          title={waiting ? "This could not be loaded" : "This could not be refreshed"}
        >
          {query.error.message}
        </PageAlert>
      )}
      {query.data !== undefined
        ? children(query.data)
        : query.error === null && (
            <div className="flex flex-1 items-center justify-center p-10">
              <Spinner />
            </div>
          )}
    </>
  );
}
