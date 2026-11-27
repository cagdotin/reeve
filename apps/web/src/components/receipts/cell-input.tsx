import { useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@reeve/ui/lib/utils";

/**
 * Text that reads as a cell and edits in place, as `AmountInput`: the draft lives only while it
 * has focus, so a refresh never fights the typing. Enter or leaving commits, Escape cancels;
 * `onDraft` hears every keystroke (for live totals), and null when editing ends without a commit.
 */
export function CellInput({
  value,
  onCommit,
  onDraft,
  label,
  placeholder,
  align = "left",
  mono = false,
  invalid = false,
  className,
}: {
  value: string;
  onCommit: (text: string) => void;
  onDraft?: ((text: string | null) => void) | undefined;
  label: string;
  placeholder?: string | undefined;
  align?: "left" | "right";
  mono?: boolean;
  invalid?: boolean;
  className?: string | undefined;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // What it read when focused: the value may follow the typing (a live total), the commit may not.
  const initial = useRef(value);

  const end = (commit: boolean) => {
    if (draft === null) return;
    setDraft(null);
    if (commit && draft !== initial.current) onCommit(draft);
    else onDraft?.(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.currentTarget.blur();
    else if (event.key === "Escape") {
      const input = event.currentTarget;
      end(false);
      requestAnimationFrame(() => input.blur());
    }
  };

  return (
    <input
      aria-label={label}
      aria-invalid={invalid || undefined}
      placeholder={placeholder}
      className={cn(
        "h-7 w-full min-w-0 rounded-md border border-transparent bg-transparent px-1.5 text-[13px] outline-none placeholder:text-muted-foreground/60 hover:border-input focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/24 aria-invalid:text-destructive-foreground",
        align === "right" && "text-right",
        mono && "tabular-nums",
        className,
      )}
      value={draft ?? value}
      onFocus={(event) => {
        setDraft(value);
        initial.current = value;
        const input = event.currentTarget;
        requestAnimationFrame(() => input.select());
      }}
      onChange={(event) => {
        setDraft(event.target.value);
        onDraft?.(event.target.value);
      }}
      onBlur={() => end(true)}
      onKeyDown={onKeyDown}
    />
  );
}
