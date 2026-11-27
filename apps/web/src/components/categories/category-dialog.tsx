import type { Category, CategoryGroup } from "@reeve/contract";
import { useState, type FormEvent } from "react";
import { CategorySelect } from "@/components/category-select";
import { ChoiceSelect } from "@/components/choice-select";
import { Button } from "@reeve/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@reeve/ui/components/dialog";
import { Field, FieldLabel } from "@reeve/ui/components/field";
import { Input } from "@reeve/ui/components/input";
import { Textarea } from "@reeve/ui/components/textarea";
import { useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";

export type CategoryRequest =
  | { readonly kind: "create-group" }
  | {
      readonly kind: "create-category";
      /** Left out to choose one in the dialog; every category sits in a group. */
      readonly group?: CategoryGroup;
      /** Makes it a subcategory of this one. */
      readonly parent?: Category;
    }
  | { readonly kind: "edit-group"; readonly group: CategoryGroup }
  | { readonly kind: "edit-category"; readonly category: Category }
  | { readonly kind: "delete-group"; readonly group: CategoryGroup }
  | {
      readonly kind: "delete-category";
      readonly category: Category;
      readonly group: CategoryGroup;
    };

/** Creating, editing and deleting categories and groups. */
export function CategoryDialog({
  request,
  groups,
  onClose,
}: {
  request: CategoryRequest | null;
  groups: ReadonlyArray<CategoryGroup>;
  onClose: () => void;
}) {
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-sm">
        {request && <Body request={request} groups={groups} onClose={onClose} />}
      </DialogPopup>
    </Dialog>
  );
}

const titleOf = (request: CategoryRequest) => {
  switch (request.kind) {
    case "create-group":
      return "New category group";
    case "create-category":
      if (request.parent) return `New subcategory of ${request.parent.name}`;
      return request.group ? `New category in ${request.group.name}` : "New category";
    case "edit-group":
      return `Edit ${request.group.name}`;
    case "edit-category":
      return `Edit ${request.category.name}`;
    case "delete-group":
      return `Delete ${request.group.name}`;
    case "delete-category":
      return `Delete ${request.category.name}`;
  }
};

const initialName = (request: CategoryRequest) => {
  if (request.kind === "edit-group") return request.group.name;
  return request.kind === "edit-category" ? request.category.name : "";
};

/** The categories a deleted category's or group's money may move to. */
const transferTargets = (request: CategoryRequest, groups: ReadonlyArray<CategoryGroup>) => {
  if (request.kind === "delete-group")
    return { groups: groups.filter((group) => group.id !== request.group.id), income: false };
  const income = request.kind === "delete-category" ? request.group.isIncome : false;
  return {
    groups: groups.filter((group) => group.isIncome === income),
    income,
    ...(request.kind === "delete-category" ? { exclude: request.category.id } : {}),
  };
};

interface Values {
  readonly name: string;
  readonly description: string;
  readonly groupId: string | null;
  readonly transfer: string | null;
}

/** Runs a request with what the dialog holds. */
function useSubmit(request: CategoryRequest, onClose: () => void) {
  const { id: book } = useBook();
  const createGroup = useBookMutation(book, "create_category_group");
  const createCategory = useBookMutation(book, "create_category");
  const updateGroup = useBookMutation(book, "update_category_group");
  const updateCategory = useBookMutation(book, "update_category");
  const deleteGroup = useBookMutation(book, "delete_category_group");
  const deleteCategory = useBookMutation(book, "delete_category");
  const done = { onSuccess: onClose };

  return ({ name, description, groupId, transfer }: Values) => {
    const trimmed = name.trim();
    const transferCategory = transfer === null ? {} : { transferCategory: transfer };
    if (request.kind === "delete-group")
      return deleteGroup.mutate({ id: request.group.id, ...transferCategory }, done);
    if (request.kind === "delete-category")
      return deleteCategory.mutate({ id: request.category.id, ...transferCategory }, done);
    if (trimmed === "") return;
    switch (request.kind) {
      case "create-group":
        return createGroup.mutate({ name: trimmed, description }, done);
      case "create-category": {
        if (request.parent)
          return createCategory.mutate(
            { name: trimmed, description, parent: request.parent.id, before: null },
            done,
          );
        const group = request.group?.id ?? groupId;
        if (group === null) return;
        return createCategory.mutate(
          { name: trimmed, description, groupId: group, before: null },
          done,
        );
      }
      case "edit-group":
        return updateGroup.mutate({ id: request.group.id, name: trimmed, description }, done);
      case "edit-category":
        return updateCategory.mutate({ id: request.category.id, name: trimmed, description }, done);
    }
  };
}

function Body({
  request,
  groups,
  onClose,
}: {
  request: CategoryRequest;
  groups: ReadonlyArray<CategoryGroup>;
  onClose: () => void;
}) {
  const run = useSubmit(request, onClose);
  const [name, setName] = useState(() => initialName(request));
  const [description, setDescription] = useState(() =>
    request.kind === "edit-category"
      ? (request.category.description ?? "")
      : request.kind === "edit-group"
        ? (request.group.description ?? "")
        : "",
  );
  const [groupId, setGroupId] = useState<string | null>(
    () => groups.find((group) => !group.isIncome)?.id ?? groups[0]?.id ?? null,
  );
  const [transfer, setTransfer] = useState<string | null>(null);
  const deleting = request.kind === "delete-group" || request.kind === "delete-category";
  const choosesGroup = request.kind === "create-category" && !request.group && !request.parent;
  const target = transferTargets(request, groups);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    run({ name, description, groupId, transfer });
  };

  return (
    <form onSubmit={submit} className="contents">
      <DialogHeader>
        <DialogTitle>{titleOf(request)}</DialogTitle>
        {deleting && (
          <DialogDescription>
            Its transactions and budgets move to the category you pick; one with transactions cannot
            be deleted without it.
            {request.kind === "delete-category" && " Its subcategories move up a level."}
          </DialogDescription>
        )}
      </DialogHeader>
      <DialogPanel className="grid gap-4">
        {deleting ? (
          <Field>
            <FieldLabel>Move to</FieldLabel>
            <CategorySelect
              groups={target.groups}
              value={transfer}
              onChange={setTransfer}
              income={target.income}
              placeholder="Nothing to move"
              {...(target.exclude === undefined ? {} : { exclude: target.exclude })}
            />
          </Field>
        ) : (
          <Field>
            <FieldLabel>Name</FieldLabel>
            <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
        )}
        {choosesGroup && (
          <Field>
            <FieldLabel>Group</FieldLabel>
            <ChoiceSelect
              label="Group"
              items={groups.map((group) => ({ value: group.id, label: group.name }))}
              value={groupId}
              onChange={setGroupId}
            />
          </Field>
        )}
        {!deleting && (
          <Field>
            <FieldLabel>Description</FieldLabel>
            <Textarea
              aria-label="Description"
              placeholder="What belongs here, for you and your agents"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
        )}
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" type="button" />}>Cancel</DialogClose>
        <Button
          type="submit"
          variant={deleting ? "destructive" : "default"}
          disabled={!deleting && name.trim() === ""}
        >
          {deleting ? "Delete" : request.kind.startsWith("create") ? "Create" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}
