import type { ItemCategory } from "@reeve/contract/catalog";
import type { Unit } from "@reeve/contract/receipts";
import { parseAmount, type MoneyFormat } from "@reeve/contract/rules";
import { addDays, format, parseISO } from "date-fns";
import type { ChoiceItem } from "@/components/choice-select";

/** The URL the server streams a receipt photo's bytes at. */
export const photoUrl = (book: string, photo: string) =>
  `/api/books/${encodeURIComponent(book)}/receipt-photos/${encodeURIComponent(photo)}/file`;

const PRICE_SCALE = 10_000;

/** A unit price as typed (fractions of a cent allowed, arithmetic too) in minor units. */
export const parsePrice = (text: string, money: MoneyFormat): number | null => {
  if (text.trim() === "") return null;
  const scaled = parseAmount(`(${text})*${PRICE_SCALE}`, money);
  return scaled === null ? null : scaled / PRICE_SCALE;
};

/** Minor units, fractions kept, in the book's decimal separator: 129.9 is `1.299`. */
export const formatPrice = (amount: number, formatMoney: (amount: number) => string): string => {
  if (Number.isInteger(amount)) return formatMoney(amount);
  const decimal = formatMoney(1).replaceAll(/\d/g, "").at(-1) ?? ".";
  const text = (amount / 100).toFixed(4).replace(/0+$/, "");
  return text.replace(".", decimal);
};

/** A quantity as typed; null when it is not a number. */
export const parseQuantity = (text: string): number | null => {
  const value = Number(text.trim().replace(",", "."));
  return text.trim() === "" || !Number.isFinite(value) ? null : value;
};

export const UNIT_LABELS: Record<Unit, string> = {
  piece: "pc",
  pack: "pack",
  g: "g",
  kg: "kg",
  ml: "ml",
  l: "L",
  oz: "oz",
  lb: "lb",
  fl_oz: "fl oz",
};

/**
 * How a price per one of `unit` reads best: per gram and per millilitre become per kilogram and
 * per litre, as shelf labels show them.
 */
export const displayUnit = (unit: Unit): { readonly label: string; readonly factor: number } =>
  unit === "g"
    ? { label: "kg", factor: 1000 }
    : unit === "ml"
      ? { label: "L", factor: 1000 }
      : { label: UNIT_LABELS[unit], factor: 1 };

/** The item categories as select items, indented by depth. */
export const itemCategoryItems = (
  categories: ReadonlyArray<ItemCategory>,
): Array<ChoiceItem<string>> =>
  categories.map((category) => ({
    value: category.id,
    label: category.name,
    depth: category.depth,
  }));

/** `YYYY-MM-DD` moved by `days`. */
export const shiftDay = (day: string, days: number) =>
  format(addDays(parseISO(day), days), "yyyy-MM-dd");
