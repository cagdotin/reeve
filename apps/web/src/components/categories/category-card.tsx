import type { Category, CategoryGroup } from "@reeve/contract";
import { useQuery } from "@tanstack/react-query";
import {
  EllipsisIcon,
  EyeIcon,
  EyeOffIcon,
  PencilIcon,
  PlusIcon,
  StickyNoteIcon,
  TargetIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "lucide-react";
import { useState, type ReactElement, type ReactNode } from "react";
import { toastTemplates } from "@/components/budget/templates";
import { hasTargets, useCategoryTargets } from "@/components/budget/targets/use-targets";
import type { CategoryRequest } from "@/components/categories/category-dialog";
import { NotesButton } from "@/components/notes-button";
import { Button } from "@reeve/ui/components/button";
import {
  Popover,
  PopoverClose,
  PopoverDescription,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
} from "@reeve/ui/components/popover";
import { bookQuery, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { groupRuleCount, ruleCounts } from "@/lib/categories";
import { monthLabel } from "@/lib/months";

/** Takes no room until its row is hovered, then pushes the row's marks aside. */
const TRIGGER =
  "-ms-1 flex h-6 w-0 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md text-muted-foreground opacity-0 outline-none transition-[width,margin,opacity] duration-150 group-hover/row:ms-0 group-hover/row:w-6 group-hover/row:opacity-100 hover:bg-accent focus-visible:ms-0 focus-visible:w-6 focus-visible:opacity-100 data-popup-open:ms-0 data-popup-open:w-6 data-popup-open:opacity-100";

/** What opens a card instead of the options button: a phone's row opens it from the name. */
export interface CardTrigger {
  readonly as: ReactElement;
  readonly label: ReactNode;
}

function Card({
  name,
  trigger,
  children,
}: {
  name: string;
  trigger: CardTrigger | undefined;
  children: ReactNode;
}) {
  return (
    <Popover>
      {trigger === undefined ? (
        <PopoverTrigger className={TRIGGER} aria-label={`${name} options`}>
          <EllipsisIcon className="size-3.5" />
        </PopoverTrigger>
      ) : (
        <PopoverTrigger render={trigger.as} aria-label={`${name} options`}>
          {trigger.label}
        </PopoverTrigger>
      )}
      <PopoverPopup align="start" className="w-64">
        <PopoverTitle className="text-sm font-medium leading-snug break-words">{name}</PopoverTitle>
        {children}
      </PopoverPopup>
    </Popover>
  );
}

function Details({
  description,
  rules,
}: {
  description: string | null;
  rules: number | undefined;
}) {
  return (
    <>
      {description && (
        <PopoverDescription className="mt-1.5 text-[13px] whitespace-pre-line">
          {description}
        </PopoverDescription>
      )}
      {rules !== undefined && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <WandSparklesIcon className="size-3.5 shrink-0" />
          {rules === 1 ? "1 rule" : `${rules === 0 ? "No" : rules} rules`}
        </p>
      )}
    </>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="-mx-2 -mb-2 mt-3 grid gap-0.5 border-t pt-2">{children}</div>;
}

function Action({
  icon,
  danger = false,
  onClick,
  children,
}: {
  icon?: ReactNode;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <PopoverClose
      render={
        <Button
          variant="ghost"
          className={
            danger
              ? "justify-start font-normal text-destructive-foreground"
              : "justify-start font-normal"
          }
          onClick={onClick}
        />
      }
    >
      {icon}
      {children}
    </PopoverClose>
  );
}

/** A category's name, details and everything that can be done to it, on desktop and on a phone. */
export function CategoryCard({
  category,
  group,
  level,
  months,
  onTargets,
  onRequest,
  trigger,
}: {
  category: Category;
  group: CategoryGroup;
  level: number;
  months: ReadonlyArray<string>;
  /** Left out where a category has no targets: income in an envelope budget. */
  onTargets: (() => void) | undefined;
  onRequest: (request: CategoryRequest) => void;
  trigger?: CardTrigger;
}) {
  return (
    <Card name={category.name} trigger={trigger}>
      <CategoryBody
        category={category}
        group={group}
        level={level}
        months={months}
        onTargets={onTargets}
        onRequest={onRequest}
      />
    </Card>
  );
}

function CategoryBody({
  category,
  group,
  level,
  months,
  onTargets,
  onRequest,
}: {
  category: Category;
  group: CategoryGroup;
  level: number;
  months: ReadonlyArray<string>;
  onTargets: (() => void) | undefined;
  onRequest: (request: CategoryRequest) => void;
}) {
  const { id: book, book: settings } = useBook();
  const rules = useQuery(bookQuery(book, "list_rules", {})).data;
  const update = useBookMutation(book, "update_category");
  const apply = useBookMutation(book, "apply_category_templates");
  const targets = useCategoryTargets(category.id);
  return (
    <>
      <Details
        description={category.description}
        rules={rules === undefined ? undefined : (ruleCounts(rules).get(category.id) ?? 0)}
      />
      <Actions>
        <Action
          icon={<PencilIcon />}
          onClick={() => onRequest({ kind: "edit-category", category })}
        >
          Edit…
        </Action>
        {level + 1 < settings.settings.categoryDepth && (
          <Action
            icon={<PlusIcon />}
            onClick={() => onRequest({ kind: "create-category", group, parent: category })}
          >
            Add subcategory
          </Action>
        )}
        {onTargets && (
          <Action icon={<TargetIcon />} onClick={onTargets}>
            {hasTargets(targets) ? "Edit targets…" : "Set a target…"}
          </Action>
        )}
        {onTargets &&
          months.map((month) => (
            <Action
              key={month}
              onClick={() =>
                apply.mutate({ month, category: category.id }, { onSuccess: toastTemplates })
              }
            >
              Apply targets to {monthLabel(month)}
            </Action>
          ))}
        <Action
          icon={category.hidden ? <EyeIcon /> : <EyeOffIcon />}
          onClick={() => update.mutate({ id: category.id, hidden: !category.hidden })}
        >
          {category.hidden ? "Show" : "Hide"}
        </Action>
        <Action
          danger
          icon={<Trash2Icon />}
          onClick={() => onRequest({ kind: "delete-category", category, group })}
        >
          Delete
        </Action>
      </Actions>
    </>
  );
}

/** A group's card, and the mark of its note, which the card opens. */
export function GroupCard({
  group,
  months,
  onRequest,
  trigger,
}: {
  group: CategoryGroup;
  months: ReadonlyArray<string>;
  onRequest: (request: CategoryRequest) => void;
  trigger?: CardTrigger;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  return (
    <>
      <NotesButton
        id={group.id}
        notes={group.notes}
        mark
        open={noteOpen}
        onOpenChange={setNoteOpen}
      />
      <Card name={group.name} trigger={trigger}>
        <GroupBody
          group={group}
          months={months}
          onNote={() => setNoteOpen(true)}
          onRequest={onRequest}
        />
      </Card>
    </>
  );
}

function GroupBody({
  group,
  months,
  onNote,
  onRequest,
}: {
  group: CategoryGroup;
  months: ReadonlyArray<string>;
  onNote: () => void;
  onRequest: (request: CategoryRequest) => void;
}) {
  const { id: book } = useBook();
  const rules = useQuery(bookQuery(book, "list_rules", {})).data;
  const update = useBookMutation(book, "update_category_group");
  const apply = useBookMutation(book, "apply_group_templates");
  return (
    <>
      <Details
        description={group.description}
        rules={rules === undefined ? undefined : groupRuleCount(rules, group)}
      />
      <Actions>
        <Action icon={<PencilIcon />} onClick={() => onRequest({ kind: "edit-group", group })}>
          Edit…
        </Action>
        <Action icon={<PlusIcon />} onClick={() => onRequest({ kind: "create-category", group })}>
          Add category
        </Action>
        <Action icon={<StickyNoteIcon />} onClick={onNote}>
          {group.notes ? "Edit note…" : "Add note…"}
        </Action>
        {!group.isIncome &&
          months.map((month) => (
            <Action
              key={month}
              onClick={() =>
                apply.mutate({ month, group: group.id }, { onSuccess: toastTemplates })
              }
            >
              Apply targets to {monthLabel(month)}
            </Action>
          ))}
        {!group.isIncome && (
          <Action
            icon={group.hidden ? <EyeIcon /> : <EyeOffIcon />}
            onClick={() => update.mutate({ id: group.id, hidden: !group.hidden })}
          >
            {group.hidden ? "Show" : "Hide"}
          </Action>
        )}
        {!group.isIncome && (
          <Action
            danger
            icon={<Trash2Icon />}
            onClick={() => onRequest({ kind: "delete-group", group })}
          >
            Delete
          </Action>
        )}
      </Actions>
    </>
  );
}
