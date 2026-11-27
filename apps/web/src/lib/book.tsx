import type { Book } from "@reeve/contract";
import { formatAmount, parseAmount, type MoneyFormat } from "@reeve/contract/rules";
import { format as formatDate, parseISO } from "date-fns";
import { createContext, useContext, useMemo, type ReactNode } from "react";

export interface BookContext {
  readonly id: string;
  readonly book: Book;
  readonly money: MoneyFormat;
  /** Minor units as the book writes money: `1,234.56`. */
  readonly format: (amount: number) => string;
  /** What a person typed as money, arithmetic allowed; null when it is not money. */
  readonly parse: (text: string) => number | null;
  /** A `YYYY-MM-DD` day in the book's date format. */
  readonly formatDay: (day: string) => string;
}

const Context = createContext<BookContext | null>(null);

export function BookProvider({ book, children }: { book: Book; children: ReactNode }) {
  const value = useMemo((): BookContext => {
    const money: MoneyFormat = {
      numberFormat: book.settings.numberFormat,
      hideFraction: book.settings.hideFraction,
    };
    return {
      id: book.id,
      book,
      money,
      format: (amount) => formatAmount(amount, money),
      parse: (text) => parseAmount(text, money),
      formatDay: (day) => formatDate(parseISO(day), book.settings.dateFormat),
    };
  }, [book]);
  return <Context value={value}>{children}</Context>;
}

/** The open book; every page below the root has one. */
export const useBook = (): BookContext => {
  const value = useContext(Context);
  if (value === null) throw new Error("useBook outside a BookProvider");
  return value;
};
