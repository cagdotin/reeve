import { SearchIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Input } from "@reeve/ui/components/input";

export function TableToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-1.5 border-b px-3 py-1.5">
      {children}
    </div>
  );
}

export function TableSearch({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <div className="relative w-64 shrink-0 @max-md:w-40 max-md:w-full max-md:basis-full">
      <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        placeholder="Search"
        aria-label={label}
        className="*:data-[slot=input]:ps-8"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
    </div>
  );
}

export function TableFilterActions({ children }: { children: ReactNode }) {
  return (
    <div className="ms-auto flex flex-wrap items-center justify-end gap-1.5 max-md:ms-0">
      {children}
    </div>
  );
}
