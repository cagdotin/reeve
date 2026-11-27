import { useState, type KeyboardEvent } from "react";
import { cn } from "@reeve/ui/lib/utils";
import { useBook } from "@/lib/book";

/**
 * An amount that reads as text and edits in place, as Actual's budget cells: click or focus to
 * type (arithmetic allowed), Enter or leaving saves, Escape cancels. Tab moves on as usual.
 */
export function AmountInput({
  value,
  onCommit,
  className,
  label,
  disabled = false,
  zeroAsBlank = false,
}: {
  value: number;
  onCommit: (amount: number) => void;
  className?: string;
  label: string;
  disabled?: boolean;
  /** Show nothing for zero until focused, as an empty budget cell. */
  zeroAsBlank?: boolean;
}) {
  const { format, parse } = useBook();
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const amount = draft.trim() === "" ? 0 : parse(draft);
    setDraft(null);
    if (amount !== null && amount !== value) onCommit(amount);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      setDraft(null);
      event.currentTarget.blur();
    }
  };

  return (
    <input
      aria-label={label}
      disabled={disabled}
      inputMode="decimal"
      className={cn(
        "h-7 w-full min-w-0 rounded-md border border-transparent bg-transparent px-1.5 pb-px text-right text-[13px] tabular-nums outline-none hover:border-input focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/24 disabled:pointer-events-none",
        className,
      )}
      value={draft ?? (zeroAsBlank && value === 0 ? "" : format(value))}
      placeholder={zeroAsBlank ? format(0) : undefined}
      onFocus={(event) => {
        setDraft(value === 0 ? "" : format(value));
        const input = event.currentTarget;
        requestAnimationFrame(() => input.select());
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  );
}
