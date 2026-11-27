import type {
  AccountScope,
  DashboardPage,
  SavedReport,
  SavedReportInfo,
  Widget,
  WidgetConfig,
} from "@reeve/contract/catalog";
import { effectiveScope, followsScope, sameScope } from "@reeve/contract/rules";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowDownIcon, ArrowUpIcon, EllipsisIcon, GripVerticalIcon } from "lucide-react";
import { Component, useContext, useId, useState, type ReactNode } from "react";
import { Button } from "@reeve/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@reeve/ui/components/dialog";
import { Field, FieldLabel } from "@reeve/ui/components/field";
import { Input } from "@reeve/ui/components/input";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "@reeve/ui/components/menu";
import { Textarea } from "@reeve/ui/components/textarea";
import { cn } from "@reeve/ui/lib/utils";
import { bookQuery, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { scopeLabel } from "@/lib/report-scope";
import { Retry, WidgetLoading, WidgetMessage } from "./card-body";
import { Choice } from "./controls";
import type { Arrange } from "./dashboard-grid";
import type { MarkdownMeta } from "./meta";
import { specOf, widgetName, widgetTarget } from "./widgets";
import {
  WidgetHostContext,
  WidgetTargetContext,
  widgetState,
  type WidgetTarget,
} from "./widget-state";

const UNAVAILABLE: Record<Exclude<Widget["availability"], "available">, string> = {
  "missing-reference": "Its saved report was deleted.",
  unsupported: "This widget cannot be shown in reeve yet.",
  "invalid-config": "Its settings could not be read.",
};

const FONT_SIZES = ["16", "20", "24", "28", "32", "40", "48", "64"].map((size) => ({
  value: size,
  label: `${size}px`,
}));

const settingsOf = (config: WidgetConfig | null): Record<string, unknown> =>
  config !== null && "settings" in config ? config.settings : {};

/** Keeps a widget's rendering failure inside its card, so its neighbours stay on the page. */
class WidgetBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    if (this.state.error === null) return this.props.children;
    return (
      <WidgetMessage
        title="This widget could not be shown."
        detail={this.state.error.message}
        action={<Retry onRetry={() => this.setState({ error: null })} />}
      />
    );
  }
}

/** A widget's content: what its type renders from its settings, or why it renders nothing. */
function WidgetContent({
  widget,
  scope,
  onRemove,
}: {
  widget: Widget;
  scope: AccountScope | undefined;
  onRemove: () => void;
}) {
  const { id: book } = useBook();
  const spec = specOf(widget.type);
  const reports = useQuery({
    ...bookQuery(book, "list_saved_reports", {}),
    enabled: spec?.report !== undefined,
  });
  const remove = (
    <Button variant="outline" onClick={onRemove}>
      Remove widget
    </Button>
  );
  if (widget.availability !== "available")
    return <WidgetMessage title={UNAVAILABLE[widget.availability]} action={remove} />;
  if (spec?.Body === undefined)
    return <WidgetMessage title={UNAVAILABLE.unsupported} action={remove} />;
  const { Body } = spec;
  const fontSize = widget.config?.presentation.fontSize ?? spec.fontSize;
  if (spec.report === undefined)
    return <Body meta={settingsOf(widget.config) as never} fontSize={fontSize} />;
  const view = widgetState(reports);
  if (view.state === "loading") return <WidgetLoading />;
  if (view.state === "failed")
    return (
      <WidgetMessage
        title="This widget could not be loaded."
        detail={view.error.message}
        action={<Retry onRetry={reports.refetch} />}
      />
    );
  const report = view.data.find(
    (each): each is SavedReport => each.id === widget.reportId && "definition" in each,
  );
  if (report === undefined)
    return <WidgetMessage title={UNAVAILABLE["missing-reference"]} action={remove} />;
  return (
    <Body
      meta={report.definition.settings as never}
      reportId={report.id}
      fontSize={fontSize}
      scope={scope}
    />
  );
}

/**
 * The accounts a report widget covers, if its report follows accounts; `opened` while they differ
 * from its saved report's, for its full report to open with.
 */
const useWidgetScope = (config: WidgetConfig | null, saved: SavedReportInfo | undefined) => {
  const host = useContext(WidgetHostContext);
  const placement = config && "scope" in config ? config.scope?.accounts : undefined;
  if (saved === undefined || !("definition" in saved) || !followsScope(saved.definition))
    return { scope: undefined, opened: undefined, fixed: undefined };
  const scope = effectiveScope({ placement, host, saved: saved.definition.scope.accounts });
  return {
    scope,
    opened: sameScope(scope, saved.definition.scope.accounts) ? undefined : scope,
    fixed: placement?.mode === "fixed" ? scope : undefined,
  };
};

/** A widget's name, leading to its full report, and the accounts its placement fixes, if any. */
function WidgetTitle({
  name,
  target,
  fixed,
}: {
  name: string;
  target: WidgetTarget | null;
  fixed: AccountScope | undefined;
}) {
  return (
    <>
      {target ? (
        <TargetLink target={target} className="hover:underline">
          {name}
        </TargetLink>
      ) : (
        name
      )}
      {fixed && <FixedScope scope={fixed} />}
    </>
  );
}

/** Names the accounts a placement fixes, so it does not pass for one that follows its page. */
function FixedScope({ scope }: { scope: AccountScope }) {
  const { id: book } = useBook();
  const accounts = useQuery(bookQuery(book, "list_accounts", {}));
  return (
    <span className="ms-1.5 font-normal text-muted-foreground">
      {scopeLabel(scope, accounts.data)} · Fixed
    </span>
  );
}

/**
 * A widget in any host: its title and actions over its live content. The host owns the box it
 * fills; on a dashboard in edit mode, `arrange` gives the title bar its handle.
 */
export function WidgetCard({
  widget,
  pages,
  arrange,
}: {
  widget: Widget;
  pages: ReadonlyArray<DashboardPage>;
  arrange?: Arrange | undefined;
}) {
  const editing = arrange !== undefined;
  const { id: book } = useBook();
  const reports = useQuery({
    ...bookQuery(book, "list_saved_reports", {}),
    enabled: widget.reportId !== null,
  });
  const remove = useBookMutation(book, "remove_widget");
  const [configuring, setConfiguring] = useState(false);
  const spec = specOf(widget.type);
  const saved = reports.data?.find((each) => each.id === widget.reportId);
  const name = widgetName(widget, saved?.name);
  const config = widget.availability === "available" ? widget.config : null;
  const { scope, opened, fixed } = useWidgetScope(config, saved);
  const target = editing ? null : widgetTarget(widget, name, opened);
  const isText = spec?.kind === "text";

  return (
    <section
      aria-label={isText ? "Text" : name}
      className={cn(
        "group/card flex h-full flex-col overflow-hidden rounded-xl border bg-card shadow-card",
        editing && "ring-1 ring-ring/20",
      )}
    >
      <WidgetHeader
        arrange={arrange}
        label={isText ? "text widget" : name}
        title={
          isText ? null : (
            <WidgetTitle
              name={name}
              target={spec?.report === undefined ? null : target}
              fixed={fixed}
            />
          )
        }
      >
        <WidgetMenu
          widget={widget}
          pages={pages}
          label={isText ? "text widget" : name}
          open={
            target && {
              target,
              label: spec?.report === undefined ? target.label : "Edit saved report",
            }
          }
          onConfigure={config ? () => setConfiguring(true) : undefined}
          onRemove={() => remove.mutate({ id: widget.id })}
        />
      </WidgetHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-3.5 pb-3">
        <WidgetTargetContext value={target}>
          <WidgetBoundary>
            <WidgetContent
              widget={widget}
              scope={scope}
              onRemove={() => remove.mutate({ id: widget.id })}
            />
          </WidgetBoundary>
        </WidgetTargetContext>
      </div>
      {config && (
        <WidgetSettingsDialog
          open={configuring}
          onOpenChange={setConfiguring}
          widget={widget}
          config={config}
          defaultTitle={widgetName({ ...widget, config: { ...config, title: null } }, saved?.name)}
        />
      )}
    </section>
  );
}

/** A widget's title bar; in edit mode, dragging it or its handle's arrow keys arrange the widget. */
function WidgetHeader({
  arrange,
  label,
  title,
  children,
}: {
  arrange: Arrange | undefined;
  label: string;
  title: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div
      className={cn(
        "flex h-9 shrink-0 items-center gap-1.5 ps-3.5 pe-1.5",
        arrange?.drag && "cursor-grab touch-none active:cursor-grabbing",
      )}
      onPointerDown={arrange?.drag}
    >
      {arrange && (
        <>
          <button
            type="button"
            aria-label={`Arrange ${label}`}
            aria-describedby={`${id}-keys`}
            className="-ms-2 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onKeyDown={arrange.onKeyDown}
          >
            <GripVerticalIcon className="size-3.5" />
          </button>
          <span id={`${id}-keys`} hidden>
            {arrange.step
              ? "Arrow keys move it up or down."
              : "Arrow keys move it, Shift and the arrow keys resize it."}
          </span>
        </>
      )}
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{title}</span>
      {arrange?.step && (
        <>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Move ${label} up`}
            disabled={arrange.first}
            onClick={() => arrange.step?.("up")}
          >
            <ArrowUpIcon />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Move ${label} down`}
            disabled={arrange.last}
            onClick={() => arrange.step?.("down")}
          >
            <ArrowDownIcon />
          </Button>
        </>
      )}
      {children}
    </div>
  );
}

function WidgetMenu({
  widget,
  pages,
  label,
  open,
  onConfigure,
  onRemove,
}: {
  widget: Widget;
  pages: ReadonlyArray<DashboardPage>;
  label: string;
  open: { target: WidgetTarget; label: string } | null;
  onConfigure: (() => void) | undefined;
  onRemove: () => void;
}) {
  const { id: book } = useBook();
  const copy = useBookMutation(book, "copy_widget");
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Actions for ${label}`}
            className="opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 pointer-coarse:opacity-100"
            onPointerDown={(event) => event.stopPropagation()}
          />
        }
      >
        <EllipsisIcon />
      </MenuTrigger>
      <MenuPopup align="end">
        {open && <MenuItem render={<TargetLink target={open.target} />}>{open.label}</MenuItem>}
        {onConfigure && <MenuItem onClick={onConfigure}>Widget settings…</MenuItem>}
        <MenuSub>
          <MenuSubTrigger>Copy to dashboard</MenuSubTrigger>
          <MenuSubPopup>
            {pages.map((page) => (
              <MenuItem
                key={page.id}
                onClick={() => copy.mutate({ id: widget.id, pageId: page.id })}
              >
                {page.name}
              </MenuItem>
            ))}
          </MenuSubPopup>
        </MenuSub>
        <MenuSeparator />
        <MenuItem variant="destructive" onClick={onRemove}>
          Remove
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

function TargetLink({
  target,
  className,
  children,
}: {
  target: WidgetTarget;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Link
      to={target.to}
      search={target.search as never}
      params={target.params as never}
      className={className}
    >
      {children}
    </Link>
  );
}

/** What a placement owns: its title, font size and, for text, its content. */
function WidgetSettingsDialog({
  open,
  onOpenChange,
  widget,
  config,
  defaultTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  widget: Widget;
  config: WidgetConfig;
  defaultTitle: string;
}) {
  const { id: book } = useBook();
  const update = useBookMutation(book, "update_widget");
  const spec = specOf(widget.type);
  const isText = spec?.kind === "text";
  const settings = settingsOf(config);
  const text = settings as MarkdownMeta;
  const fields = spec?.fields ?? [];
  const initial = () => ({
    title: config.title ?? "",
    fontSize: String(config.presentation.fontSize ?? spec?.fontSize ?? ""),
    content: text.content ?? "",
    align: text.text_align ?? ("left" as const),
    fields: Object.fromEntries(
      fields.map((field) => [field.key, String(settings[field.key] ?? field.default)]),
    ),
  });
  const [draft, setDraft] = useState(initial);
  const set = (change: Partial<ReturnType<typeof initial>>) =>
    setDraft((current) => ({ ...current, ...change }));
  const save = () => {
    const presentation = { ...config.presentation };
    if (spec?.fontSize !== undefined) presentation.fontSize = Number(draft.fontSize);
    update.mutate({
      id: widget.id,
      config: {
        ...config,
        title: draft.title.trim() === "" ? null : draft.title.trim(),
        presentation,
        ...(isText ? { settings: { content: draft.content, text_align: draft.align } } : {}),
        ...(fields.length > 0
          ? {
              settings: {
                ...settings,
                ...Object.fromEntries(
                  fields.map((field) => [field.key, Number(draft.fields[field.key])]),
                ),
              },
            }
          : {}),
      } as WidgetConfig,
    });
    onOpenChange(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(initial());
        onOpenChange(next);
      }}
    >
      <DialogPopup className="max-w-lg">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <DialogHeader>
            <DialogTitle>Widget settings</DialogTitle>
          </DialogHeader>
          <DialogPanel className="grid gap-4">
            {!isText && (
              <Field>
                <FieldLabel>Title</FieldLabel>
                <Input
                  autoFocus
                  placeholder={defaultTitle}
                  value={draft.title}
                  onChange={(event) => set({ title: event.target.value })}
                />
              </Field>
            )}
            {fields.map((field) => (
              <Field key={field.key}>
                <FieldLabel>{field.label}</FieldLabel>
                <Input
                  type="number"
                  required
                  min={field.min}
                  max={field.max}
                  step={1}
                  value={draft.fields[field.key]}
                  onChange={(event) =>
                    set({ fields: { ...draft.fields, [field.key]: event.target.value } })
                  }
                />
              </Field>
            ))}
            {spec?.fontSize !== undefined && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                Font size
                <Choice
                  label="Font size"
                  className="min-w-20"
                  items={FONT_SIZES}
                  value={draft.fontSize}
                  onChange={(fontSize) => set({ fontSize })}
                />
              </div>
            )}
            {isText && (
              <>
                <Textarea
                  aria-label="Markdown"
                  className="min-h-48 font-mono text-xs"
                  value={draft.content}
                  onChange={(event) => set({ content: event.target.value })}
                />
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  Align
                  <Choice
                    label="Align"
                    items={[
                      { value: "left", label: "Left" },
                      { value: "center", label: "Center" },
                      { value: "right", label: "Right" },
                    ]}
                    value={draft.align}
                    onChange={(align) => set({ align })}
                  />
                </div>
              </>
            )}
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

export function RenameDialog({
  open,
  onOpenChange,
  name,
  title,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  title: string;
  onSave: (name: string) => void;
}) {
  const [text, setText] = useState(name);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setText(name);
        onOpenChange(next);
      }}
    >
      <DialogPopup className="max-w-sm">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim() === "") return;
            onSave(text.trim());
            onOpenChange(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <Input
              autoFocus
              aria-label="Name"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
