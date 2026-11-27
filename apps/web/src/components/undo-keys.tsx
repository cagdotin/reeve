import { useQueryClient } from "@tanstack/react-query";
import { toastManager } from "@reeve/ui/components/toast";
import { bookKey, run, showError } from "@/lib/api";
import { useBook } from "@/lib/book";
import { useHotkeys } from "@/lib/hotkeys";

/** ⌘Z and ⇧⌘Z undo and redo the book's last change, wherever it came from. */
export function UndoKeys() {
  const { id: book } = useBook();
  const queryClient = useQueryClient();
  const step = (name: "undo" | "redo") =>
    run(name, { book })
      .then(({ done }) => {
        if (!done) toastManager.add({ title: `Nothing to ${name}` });
        return queryClient.invalidateQueries({ queryKey: bookKey(book) });
      })
      .catch(showError);
  useHotkeys({
    "mod+z": (event) => {
      if (isEditing(event.target)) return false;
      void step(event.shiftKey ? "redo" : "undo");
    },
    "mod+y": (event) => {
      if (isEditing(event.target)) return false;
      void step("redo");
    },
  });
  return null;
}

/** A text field keeps ⌘Z for its own text. */
const isEditing = (target: EventTarget | null) =>
  target instanceof HTMLElement && target.closest("input, textarea, [contenteditable]") !== null;
