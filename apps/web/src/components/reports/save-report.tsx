import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, SaveIcon } from "lucide-react";
import { useState } from "react";
import { PageAlert } from "@/components/page-alert";
import { RenameDialog } from "@/components/reports/widget-card";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@reeve/ui/components/alert-dialog";
import { Button } from "@reeve/ui/components/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@reeve/ui/components/menu";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";
import type { ReportSave } from "./report-state";

/**
 * Saving over a saved report, after naming the widgets that show it when there are any: `request`
 * saves or asks, and `dialog` is the question.
 */
export function useConfirmedUpdate({
  report,
  dirty,
  update,
  onSaveAs,
}: {
  report: { readonly id: string; readonly name: string } | undefined;
  dirty: boolean;
  update: (() => void) | undefined;
  onSaveAs: () => void;
}) {
  const { id: book } = useBook();
  const [asking, setAsking] = useState(false);
  const usage = useQuery({
    ...bookQuery(book, "get_saved_report_usage", { id: report?.id ?? "" }),
    enabled: report !== undefined && dirty,
  });
  const placements = usage.data?.placements ?? [];
  const request =
    update &&
    (() => {
      if (usage.data?.placements.length === 0) update();
      else setAsking(true);
    });
  const dialog = (
    <AlertDialog open={asking} onOpenChange={setAsking}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Save “{report?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            {usage.data === undefined
              ? "Every widget that shows it will show these settings too."
              : placements.length === 1
                ? "The widget that shows it will show these settings too."
                : `The ${placements.length} widgets that show it will show these settings too.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="space-y-1 px-6 text-sm">
          {placements.map((placement) => (
            <li key={placement.id}>
              {placement.pageName}: {placement.title}
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
          <Button
            variant="outline"
            onClick={() => {
              setAsking(false);
              onSaveAs();
            }}
          >
            Save as new report
          </Button>
          <Button
            onClick={() => {
              setAsking(false);
              update?.();
            }}
          >
            Save report
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
  return { request, dialog };
}

/** Says that the address named a saved report this book does not hold. */
export function MissingReportAlert() {
  return (
    <PageAlert variant="info" title="That saved report no longer exists">
      It was deleted, or belongs to another book. Save as a new report to keep these settings.
    </PageAlert>
  );
}

/**
 * Save writes the settings over the saved report; a built-in report, or one whose saved report is
 * gone, saves as a new report instead.
 */
export function SaveReportActions({ name, save }: { name: string; save: ReportSave }) {
  const [creating, setCreating] = useState(false);
  const { request, dialog } = useConfirmedUpdate({
    report: save.report,
    dirty: save.dirty,
    update: save.update && (() => void save.update?.()),
    onSaveAs: () => setCreating(true),
  });
  return (
    <>
      {save.missing && <MissingReportAlert />}
      <Button
        variant={save.dirty ? "default" : "ghost"}
        disabled={request !== undefined && !save.dirty}
        loading={save.saving}
        onClick={request ?? (() => setCreating(true))}
      >
        <SaveIcon />
        <span className="max-md:sr-only">{request ? "Save report" : "Save as new report"}</span>
      </Button>
      <Menu>
        <MenuTrigger render={<Button variant="ghost" size="icon" aria-label="More ways to save" />}>
          <ChevronDownIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          {request && <MenuItem onClick={() => setCreating(true)}>Save as new report…</MenuItem>}
          <MenuItem disabled={!save.dirty} onClick={save.revert}>
            {save.report ? "Revert to saved" : "Reset to defaults"}
          </MenuItem>
        </MenuPopup>
      </Menu>
      <RenameDialog
        open={creating}
        onOpenChange={setCreating}
        title="Save as new report"
        name={save.report ? `${name} copy` : name}
        onSave={(next) => void save.create(next)}
      />
      {dialog}
    </>
  );
}
