import { StickyNoteIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@reeve/ui/components/button";
import { Popover, PopoverPopup, PopoverTrigger } from "@reeve/ui/components/popover";
import { Textarea } from "@reeve/ui/components/textarea";
import { cn } from "@reeve/ui/lib/utils";
import { useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";

/**
 * The note of an account, a category, a group or a month, edited in a popover. As a `mark` it is
 * a small glyph shown only while there is a note or the popover is open (`open`, from a menu).
 */
export function NotesButton({
  id,
  notes,
  className,
  mark = false,
  open,
  onOpenChange,
}: {
  id: string;
  notes: string | null;
  className?: string;
  mark?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { id: book } = useBook();
  const save = useBookMutation(book, "set_note");
  const [draft, setDraft] = useState<string | null>(null);
  if (mark && !notes && !open) return null;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next && draft !== null && draft !== (notes ?? "")) save.mutate({ id, note: draft });
        if (!next) setDraft(null);
        onOpenChange?.(next);
      }}
    >
      <PopoverTrigger
        render={
          mark ? (
            <button
              type="button"
              aria-label={notes ? "Edit note" : "Add note"}
              title={notes ?? undefined}
              className={cn(
                "flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                className,
              )}
            />
          ) : (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={notes ? "Edit note" : "Add note"}
              title={notes ?? undefined}
              className={cn(
                "shrink-0 text-muted-foreground",
                !notes &&
                  "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100",
                className,
              )}
            />
          )
        }
      >
        <StickyNoteIcon className={cn(mark && "size-3", notes && "fill-current/20")} />
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-72">
        <Textarea
          autoFocus
          rows={4}
          placeholder="Notes"
          value={draft ?? notes ?? ""}
          onChange={(event) => setDraft(event.target.value)}
        />
      </PopoverPopup>
    </Popover>
  );
}
