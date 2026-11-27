import type { AccountScope } from "@reeve/contract/catalog";
import { Link } from "@tanstack/react-router";
import { RotateCwIcon } from "lucide-react";
import { useContext, type ReactNode } from "react";
import { Button } from "@reeve/ui/components/button";
import { WidgetTargetContext, widgetState, type WidgetQueryResult } from "./widget-state";

interface RefetchableQuery<T> extends WidgetQueryResult<T> {
  readonly refetch: () => unknown;
}

/** A short line in a widget that says why it shows no figures, with an action when it has one. */
export function WidgetMessage({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string | undefined;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-start justify-center gap-1.5 text-xs">
      <p className="font-medium">{title}</p>
      {detail && <p className="line-clamp-2 text-muted-foreground">{detail}</p>}
      {action}
    </div>
  );
}

export const Retry = ({ onRetry }: { onRetry: () => unknown }) => (
  <Button variant="outline" onClick={() => void onRetry()}>
    <RotateCwIcon />
    Retry
  </Button>
);

export const WidgetLoading = () => (
  <output
    aria-label="Loading"
    className="block flex-1 animate-pulse rounded-md bg-muted/60 motion-reduce:animate-none"
  />
);

/**
 * A widget's content from its query: a placeholder while it first loads, the failure with a retry,
 * a line when the result is empty, or the content. A failed refresh keeps the content and says so.
 * Content leads to the widget's target unless it `hasLinks` of its own.
 */
export function WidgetQuery<T>({
  query,
  isEmpty,
  empty = "Nothing to show yet.",
  hasLinks = false,
  children,
}: {
  query: RefetchableQuery<T>;
  isEmpty?: ((data: T) => boolean) | undefined;
  empty?: string | undefined;
  hasLinks?: boolean | undefined;
  children: (data: T) => ReactNode;
}) {
  const target = useContext(WidgetTargetContext);
  const view = widgetState(query, isEmpty);
  if (view.state === "loading") return <WidgetLoading />;
  if (view.state === "failed")
    return (
      <WidgetMessage
        title="This widget could not be loaded."
        detail={view.error.message}
        action={<Retry onRetry={query.refetch} />}
      />
    );
  const content =
    view.state === "empty" ? (
      <p className="flex flex-1 items-center text-xs text-muted-foreground">{empty}</p>
    ) : (
      children(view.data)
    );
  return (
    <>
      {target && !hasLinks ? (
        <Link
          to={target.to}
          search={target.search as never}
          params={target.params as never}
          tabIndex={-1}
          className="-m-1 flex min-h-0 flex-1 flex-col gap-2 rounded-md p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {content}
        </Link>
      ) : (
        content
      )}
      {view.refreshError && (
        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            Could not refresh. Showing earlier figures.
          </span>
          <Retry onRetry={query.refetch} />
        </div>
      )}
    </>
  );
}

export function Headline({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xl font-semibold">{children}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

export interface WidgetBodyProps<M> {
  readonly meta: M;
  readonly reportId?: string | undefined;
  readonly fontSize?: number | undefined;
  /** The accounts a report that follows accounts covers here (docs/rules/reports.md). */
  readonly scope?: AccountScope | undefined;
}
