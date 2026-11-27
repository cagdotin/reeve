import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SectionTitle } from "@/components/section-sidebar";
import {
  BankCardObject,
  BookObject,
  PaletteObject,
  ServerObject,
  SlidersObject,
} from "@/components/settings/objects";
import { useTheme } from "@/components/theme-provider";
import { bookQuery, booksQuery } from "@/lib/api";
import { useBook } from "@/lib/book";
import type { SETTINGS_SECTIONS, SettingsSectionId } from "@/lib/settings-sections";

const OBJECTS: Record<SettingsSectionId, ReactNode> = {
  general: <SlidersObject />,
  books: <BookObject />,
  banks: <BankCardObject />,
  appearance: <PaletteObject />,
  agents: <ServerObject />,
};

function useStandings(): Record<SettingsSectionId, string> {
  const { id, book } = useBook();
  const { data: books = [] } = useQuery(booksQuery);
  const { data: banks } = useQuery(bookQuery(id, "bank_status", {}));
  const { resolvedTheme } = useTheme();
  const linked = banks?.links.length ?? 0;
  return {
    general: `${book.settings.name}, ${book.settings.budgetType === "tracking" ? "tracking" : "envelope"} budget`,
    books: `${books.length} ${books.length === 1 ? "book" : "books"} on this computer`,
    banks:
      linked === 0 ? "No bank linked" : `${linked} linked ${linked === 1 ? "account" : "accounts"}`,
    appearance: resolvedTheme === "dark" ? "Night" : "Day",
    agents: "Let an agent work on this budget",
  };
}

/** Opens a section: its name, where it stands, and its object. */
export function SectionHead({ section }: { section: (typeof SETTINGS_SECTIONS)[number] }) {
  const standings = useStandings();
  return (
    <SectionTitle
      title={section.label}
      subtitle={standings[section.id]}
      object={OBJECTS[section.id]}
    />
  );
}
