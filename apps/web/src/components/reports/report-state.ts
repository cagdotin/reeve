import type { AccountScope, ReportType, SavedReport } from "@reeve/contract/catalog";
import { ApiError } from "@reeve/contract/client";
import { effectiveScope, sameScope } from "@reeve/contract/rules";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { bookQuery, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { parseScope } from "@/lib/report-scope";

/**
 * The search a report page takes: the saved report it shows, `explore`, the page's settings while
 * they differ from that report's (or the built-in defaults), and `scope`, the accounts a widget
 * opened it with. Back, Forward and a reload keep them without writing the saved report (decisions
 * 0056 and 0059).
 */
export interface ReportSearch {
  readonly report?: string | undefined;
  readonly explore?: Explore | undefined;
  readonly scope?: AccountScope | undefined;
}

export type Explore = Readonly<Record<string, unknown>>;

const isExplore = (value: unknown): value is Explore =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The `explore` of a search, when it is one. */
export const exploreOf = (search: Record<string, unknown>): { explore?: Explore } =>
  isExplore(search["explore"]) ? { explore: search["explore"] } : {};

/** The `scope` of a search, when it is one. */
export const scopeOf = (search: Record<string, unknown>): { scope?: AccountScope } => {
  const scope = parseScope(search["scope"]);
  return scope === undefined ? {} : { scope };
};

export const validateReportSearch = (search: Record<string, unknown>): ReportSearch => ({
  ...(typeof search["report"] === "string" ? { report: search["report"] } : {}),
  ...exploreOf(search),
  ...scopeOf(search),
});

/**
 * The accounts a report page covers: the ones a widget opened it with, else its saved report's.
 * `explored` is set while they differ from the saved report's.
 */
export const useReportScope = (saved: AccountScope | undefined) => {
  const opened = useSearch({ strict: false, select: (search) => parseScope(search.scope) });
  const scope = effectiveScope({ explored: opened, saved });
  const explored = opened !== undefined && !sameScope(opened, saved ?? { mode: "all" });
  return { scope, explored: explored ? scope : undefined };
};

/** A report page's settings: the saved definition's settings and the report's name. */
export const reportMeta = <T>(report: SavedReport | undefined): T =>
  (report === undefined
    ? {}
    : { ...report.definition.settings, name: report.name }) as unknown as T;

/** Whether a page's settings differ from what its saved report holds. */
export const differs = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);

const settingsOf = (meta: object) => {
  const { name, ...settings } = Object.fromEntries(
    Object.entries(meta).filter(([, value]) => value !== undefined),
  ) as { name?: unknown };
  return {
    name: typeof name === "string" && name.trim() !== "" ? name.trim() : undefined,
    settings,
  };
};

/** Where a report page's settings go: over its saved report, or into a new one. */
export interface Saver<T> {
  /** The saved report it writes over; undefined for a built-in or a saved report that is gone. */
  readonly report: SavedReport | undefined;
  /** The address named a saved report this book does not hold. */
  readonly missing: boolean;
  readonly saving: boolean;
  readonly update: ((meta: T) => Promise<unknown>) | undefined;
  readonly create: (meta: T, name: string, scope: AccountScope) => Promise<SavedReport>;
}

/** A saver that writes `prepare(meta)`, for a page whose saved settings are not its working ones. */
export const prepareSaver = <T>(saver: Saver<T>, prepare: (meta: T) => T): Saver<T> => ({
  ...saver,
  update: saver.update && ((meta) => saver.update!(prepare(meta))),
  create: (meta, name, scope) => saver.create(prepare(meta), name, scope),
});

/** The saved report a report page shows, and the ways to save its settings. */
export const useSavedReport = <T>(type: ReportType, id: string | undefined) => {
  const { id: book } = useBook();
  const query = useQuery({
    ...bookQuery(book, "get_saved_report", { id: id ?? "" }),
    enabled: id !== undefined,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 3,
  });
  const update = useBookMutation(book, "update_saved_report");
  const create = useBookMutation(book, "create_saved_report");
  const report = query.data !== undefined && "definition" in query.data ? query.data : undefined;
  const missing = id !== undefined && query.error instanceof ApiError && query.error.status === 404;
  const saver: Saver<T> = {
    report,
    missing,
    saving: update.isPending || create.isPending,
    update:
      report &&
      ((meta) => {
        const { name, settings } = settingsOf(meta as object);
        return update.mutateAsync({
          id: report.id,
          ...(name === undefined ? {} : { name }),
          settings: settings as never,
        });
      }),
    create: (meta, name, scope) =>
      create.mutateAsync({
        name,
        definition: {
          version: 1,
          type,
          settings: settingsOf(meta as object).settings,
          scope: { accounts: scope },
        } as never,
      }),
  };
  return {
    report,
    query,
    loading: id !== undefined && query.data === undefined && !missing,
    saver,
  };
};

/** What a report page's Save menu does with the settings it shows. */
export interface ReportSave {
  readonly dirty: boolean;
  /** The accounts a widget opened the report with, while they differ from the saved report's. */
  readonly explored: AccountScope | undefined;
  readonly saving: boolean;
  readonly report: SavedReport | undefined;
  readonly missing: boolean;
  readonly update: (() => Promise<void>) | undefined;
  readonly revert: () => void;
  readonly create: (name: string) => Promise<void>;
}

/**
 * Settings explored in the address: `explore` while they differ from `base`, else `base`. A change
 * replaces the history entry, so Back leaves the report rather than stepping through each filter.
 */
export const useExplore = <T extends object>(base: T) => {
  const navigate = useNavigate();
  const explore = useSearch({ strict: false, select: (search) => search.explore });
  const write = (next: (current: T) => T) =>
    navigate({
      to: ".",
      replace: true,
      search: (previous: ReportSearch) => {
        const settings = next((previous.explore ?? base) as T);
        return {
          ...previous,
          explore: differs(settings, base) ? (settings as Explore) : undefined,
        };
      },
    });
  return {
    meta: (explore ?? base) as T,
    dirty: explore !== undefined && differs(explore, base),
    set: (change: Partial<T>) => void write((current) => ({ ...current, ...change })),
    reset: () => write(() => base),
  };
};

/** A report page's settings, the saved report's with the page's defaults filled in, and its Save menu. */
export const useReportState = <T extends object>(
  initial: T,
  defaults: Partial<T>,
  saver: Saver<T>,
) => {
  const navigate = useNavigate();
  const { meta, dirty, set, reset } = useExplore({ ...defaults, ...initial } as T);
  const { scope, explored } = useReportScope(saver.report?.definition.scope.accounts);
  const save: ReportSave = {
    dirty,
    explored,
    saving: saver.saving,
    report: saver.report,
    missing: saver.missing,
    update:
      saver.update &&
      (async () => {
        const saved = await saver.update?.(meta).then(
          () => true,
          () => false,
        );
        if (saved) await reset();
      }),
    revert: () => void reset(),
    create: async (name) => {
      const created = await saver.create(meta, name, scope).catch(() => undefined);
      if (created !== undefined)
        await navigate({ to: ".", replace: true, search: { report: created.id } as never });
    },
  };
  return { meta, set, save, scope };
};
