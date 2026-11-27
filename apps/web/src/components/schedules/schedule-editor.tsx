import type { Schedule } from "@reeve/contract/catalog";
import { useState, type FormEvent, useId } from "react";
import { Button } from "@reeve/ui/components/button";
import { Checkbox } from "@reeve/ui/components/checkbox";
import { PaneActions } from "@/components/pane-form";
import { PaneFooter, SplitPanel, usePaneTask } from "@/components/split-panel";
import { Input } from "@reeve/ui/components/input";
import { Label } from "@reeve/ui/components/label";
import { useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { draftKey } from "@/lib/draft-key";
import {
  initialFields,
  readFields,
  saveBody,
  type ScheduleDraft,
  type ScheduleFields,
} from "./schedule-form";
import {
  AccountLine,
  AmountLine,
  DateMatchLine,
  DatesPreview,
  PatternList,
  RepeatLine,
  WeekendAndEndLines,
} from "./schedule-form-lines";

export type { ScheduleDraft } from "./schedule-form";

/** Creates or edits a schedule: a sentence of what, how much, where and when, with its next dates. */
export function ScheduleEditor({
  schedule,
  draft,
  open,
  onOpenChange,
}: {
  schedule: Schedule | null;
  draft: ScheduleDraft | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) return null;
  return (
    <SplitPanel
      title={schedule === null ? "New schedule" : "Edit schedule"}
      onClose={() => onOpenChange(false)}
    >
      <Form
        key={schedule?.id ?? (draft === null ? "new" : draftKey(draft))}
        schedule={schedule}
        draft={draft ?? {}}
        onDone={() => onOpenChange(false)}
      />
    </SplitPanel>
  );
}

function Form({
  schedule,
  draft,
  onDone,
}: {
  schedule: Schedule | null;
  draft: ScheduleDraft;
  onDone: () => void;
}) {
  const { id: book, format, parse } = useBook();
  const create = useBookMutation(book, "create_schedule", { quiet: true });
  const update = useBookMutation(book, "update_schedule", { quiet: true });
  const [fields, setFields] = useState(() => initialFields(schedule, draft, format));
  const [initial] = useState(() => JSON.stringify(fields));
  const set = (change: Partial<ScheduleFields>) => setFields((now) => ({ ...now, ...change }));
  const read = readFields(fields, parse);
  const line = { fields, read, set };
  const formId = useId();
  const task = usePaneTask({
    dirty: JSON.stringify(fields) !== initial,
    save: async () => {
      const body = saveBody(fields, read);
      if (body === null) throw new Error("The amount is not a number.");
      if (schedule === null) await create.mutateAsync(body);
      else await update.mutateAsync({ id: schedule.id, ...body });
    },
    done: onDone,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    task.submit();
  };

  return (
    <form id={formId} onSubmit={submit} className="grid gap-4">
      <div className="grid gap-3">
        <Input
          aria-label="Name"
          placeholder="Name (optional)"
          value={fields.name}
          onChange={(event) => set({ name: event.target.value })}
        />
        <div className="grid gap-2.5 rounded-lg border p-3">
          <AmountLine {...line} />
          <AccountLine {...line} />
          <RepeatLine {...line} />
          {fields.repeats && fields.frequency === "monthly" && <PatternList {...line} />}
          {fields.repeats && <WeekendAndEndLines {...line} />}
          <DateMatchLine {...line} />
        </div>
        <DatesPreview {...line} />
        <Input
          aria-label="Notes"
          placeholder="Notes the transaction gets (optional)"
          value={fields.notes}
          onChange={(event) => set({ notes: event.target.value })}
        />
        <Label className="flex items-center gap-2 font-normal">
          <Checkbox checked={fields.posts} onCheckedChange={(posts) => set({ posts })} />
          Add the transaction automatically on its day
        </Label>
      </div>
      <PaneFooter>
        <PaneActions>
          <Button variant="ghost" type="button" onClick={task.cancel}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={read.invalid} loading={task.saving}>
            {schedule === null ? "Create schedule" : "Save"}
          </Button>
        </PaneActions>
      </PaneFooter>
    </form>
  );
}
