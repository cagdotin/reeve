import type { CategoryGroup } from "@reeve/contract";
import type { ItemCategory } from "@reeve/contract/catalog";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  EllipsisIcon,
  IndentDecreaseIcon,
  IndentIncreaseIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useRef, useState, type FormEvent, type RefObject } from "react";
import { CellInput } from "@/components/receipts/cell-input";
import { BudgetCategorySelect } from "@/components/receipts/line-selects";
import { Button } from "@reeve/ui/components/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@reeve/ui/components/dialog";
import { Input } from "@reeve/ui/components/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "@reeve/ui/components/menu";
import { bookQuery, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { indentStyle } from "@/lib/categories";

/** The item-category tree: what things are, each with where its money goes by default. */
export function ItemCategoriesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { id: book } = useBook();
  const categories = useQuery(bookQuery(book, "list_item_categories", {})).data ?? [];
  const groups = useQuery(bookQuery(book, "list_categories", {})).data ?? [];
  const [parent, setParent] = useState<ItemCategory | null>(null);
  const newName = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-2xl" initialFocus={newName}>
        <DialogHeader>
          <DialogTitle>Item categories</DialogTitle>
          <DialogDescription>
            What things are (Dairy, Produce, Cleaning), apart from budget categories. A line takes
            the budget category of its nearest item category up the tree.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid gap-3">
          <div className="overflow-hidden rounded-lg border">
            {categories.map((category) => (
              <CategoryRow
                key={category.id}
                category={category}
                categories={categories}
                groups={groups}
                onAddChild={() => {
                  setParent(category);
                  // After the menu hands focus back to its trigger.
                  setTimeout(() => newName.current?.focus(), 0);
                }}
              />
            ))}
            {categories.length === 0 && (
              <p className="p-4 text-center text-sm text-muted-foreground">
                No item categories yet.
              </p>
            )}
          </div>
          <NewCategory parent={parent} onClearParent={() => setParent(null)} inputRef={newName} />
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

const siblingsOf = (category: ItemCategory, categories: ReadonlyArray<ItemCategory>) =>
  categories.filter((each) => each.parentId === category.parentId);

function CategoryRow({
  category,
  categories,
  groups,
  onAddChild,
}: {
  category: ItemCategory;
  categories: ReadonlyArray<ItemCategory>;
  groups: ReadonlyArray<CategoryGroup>;
  onAddChild: () => void;
}) {
  const { id: book } = useBook();
  const update = useBookMutation(book, "update_item_category");
  const move = useBookMutation(book, "move_item_category");
  const remove = useBookMutation(book, "delete_item_category");
  const siblings = siblingsOf(category, categories);
  const index = siblings.indexOf(category);
  const previous = siblings[index - 1];
  const parent = categories.find((each) => each.id === category.parentId);
  const names = new Map(
    groups.flatMap((group) => group.categories).map((each) => [each.id, each.name]),
  );

  const moveTo = (parentId: string | null, before: string | null) =>
    move.mutate({ id: category.id, parentId, before });
  const outdent = () => {
    if (parent === undefined) return;
    const parentSiblings = siblingsOf(parent, categories);
    const after = parentSiblings[parentSiblings.indexOf(parent) + 1];
    moveTo(parent.parentId, after?.id ?? null);
  };

  return (
    <div className="group/cat flex items-center gap-2 border-b px-2 py-1 last:border-b-0">
      <div className="min-w-0 flex-1" style={indentStyle(category.depth, 1.25)}>
        <CellInput
          label="Name"
          value={category.name}
          onCommit={(name) =>
            name.trim() !== "" && update.mutate({ id: category.id, name: name.trim() })
          }
        />
      </div>
      <BudgetCategorySelect
        groups={groups}
        className="w-52 shrink-0"
        value={category.budgetCategoryId}
        effective={names.get(category.effectiveBudgetCategoryId ?? "") ?? null}
        inheritLabel={parent === undefined ? "None" : `From ${parent.name}`}
        placeholder="No budget category"
        onChange={(budgetCategoryId) => update.mutate({ id: category.id, budgetCategoryId })}
      />
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`${category.name} actions`}
              className="text-muted-foreground"
            />
          }
        >
          <EllipsisIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem onClick={onAddChild}>
            <PlusIcon />
            Add a category inside
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            disabled={previous === undefined}
            onClick={() => moveTo(category.parentId, previous?.id ?? null)}
          >
            <ArrowUpIcon />
            Move up
          </MenuItem>
          <MenuItem
            disabled={index === siblings.length - 1}
            onClick={() => moveTo(category.parentId, siblings[index + 2]?.id ?? null)}
          >
            <ArrowDownIcon />
            Move down
          </MenuItem>
          <MenuItem
            disabled={previous === undefined}
            onClick={() => previous !== undefined && moveTo(previous.id, null)}
          >
            <IndentIncreaseIcon />
            Move into {previous?.name ?? "the one above"}
          </MenuItem>
          <MenuItem disabled={parent === undefined} onClick={outdent}>
            <IndentDecreaseIcon />
            Move out of {parent?.name ?? "its parent"}
          </MenuItem>
          <MenuSeparator />
          <MenuItem variant="destructive" onClick={() => remove.mutate({ id: category.id })}>
            <Trash2Icon />
            Delete
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  );
}

function NewCategory({
  parent,
  onClearParent,
  inputRef,
}: {
  parent: ItemCategory | null;
  onClearParent: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const { id: book } = useBook();
  const create = useBookMutation(book, "create_item_category");
  const [name, setName] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === "") return;
    create.mutate(
      { name: name.trim(), parentId: parent?.id ?? null },
      { onSuccess: () => setName("") },
    );
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      {parent !== null && (
        <span className="inline-flex h-8 items-center gap-1 rounded-lg border border-input bg-popover ps-2.5 pe-1 text-sm dark:bg-input/32">
          Inside {parent.name}
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Add at the top level instead"
            className="text-muted-foreground"
            onClick={onClearParent}
          >
            <XIcon />
          </Button>
        </span>
      )}
      <Input
        ref={inputRef}
        aria-label="New item category"
        placeholder="New item category"
        className="min-w-40 flex-1"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Button type="submit" variant="outline" disabled={name.trim() === ""}>
        <PlusIcon />
        Add
      </Button>
    </form>
  );
}
