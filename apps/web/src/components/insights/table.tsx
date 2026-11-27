import { ArrowDownIcon, ArrowUpIcon, EllipsisIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@reeve/ui/components/button";
import { Menu, MenuPopup, MenuTrigger } from "@reeve/ui/components/menu";
import { cn } from "@reeve/ui/lib/utils";
import type { Sort } from "@/lib/insights";

/** The column titles' row. */
export const TABLE_HEAD = "flex h-8 items-center gap-2 border-b px-3 text-xs text-muted-foreground";

/** A row; add its height. Its `group/row` is what shows `RowMenu` on hover. */
export const TABLE_ROW =
  "group/row relative isolate flex h-9 items-center gap-2 border-b px-3 text-[13px] hover:bg-muted/40";

export function TableHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn(TABLE_HEAD, className)} {...props} />;
}

export function TableRow({
  className,
  onOpen,
  children,
  ...props
}: ComponentProps<"div"> & { onOpen?: () => void }) {
  return (
    <div className={cn(TABLE_ROW, onOpen && "cursor-pointer", className)} {...props}>
      {onOpen && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          className="absolute inset-0 -z-10 cursor-pointer"
          onClick={onOpen}
        />
      )}
      {children}
    </div>
  );
}

/** A row heading the rows below it; add its gap. */
export const TABLE_SECTION = "flex h-7 items-center border-b px-3 text-xs text-muted-foreground";

/** A row's options: the button shows on hover or focus, and always on a phone. */
export function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 max-md:opacity-100"
          />
        }
        aria-label={label}
      >
        <EllipsisIcon className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="end">{children}</MenuPopup>
    </Menu>
  );
}

/** The sentence where a table has no rows. */
export const TableEmpty = ({ children }: { children: ReactNode }) => (
  <p className="p-10 text-center text-sm text-muted-foreground">{children}</p>
);

/** A column's title that sorts by it; a second click reverses the order. */
export function SortHeader<Key extends string>({
  column,
  label,
  title,
  sort,
  onSort,
  end = false,
}: {
  column: Key;
  label: string;
  title?: string;
  sort: Sort<Key>;
  onSort: (key: Key) => void;
  end?: boolean;
}) {
  const active = sort.key === column;
  const Arrow = sort.descending ? ArrowDownIcon : ArrowUpIcon;
  return (
    <button
      type="button"
      aria-label={`Sort by ${title ?? label}`}
      aria-pressed={active}
      title={title}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        end && "flex-row-reverse",
        active && "font-medium text-foreground",
      )}
      onClick={() => onSort(column)}
    >
      {label}
      {active && <Arrow className="size-3" />}
    </button>
  );
}
