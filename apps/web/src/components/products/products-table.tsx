import type { ProductActivity } from "@reeve/contract/catalog";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ChevronRightIcon,
  FolderTreeIcon,
  MergeIcon,
  PackageOpenIcon,
  Trash2Icon,
} from "lucide-react";
import { HelpCard } from "@/components/insights/help-card";
import { RowMenu, SortHeader, TABLE_HEAD, TABLE_ROW } from "@/components/insights/table";
import { Checkbox } from "@reeve/ui/components/checkbox";
import { MenuItem, MenuSeparator } from "@reeve/ui/components/menu";
import { cn } from "@reeve/ui/lib/utils";
import { useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import {
  latestPrice,
  priceText,
  type ProductSort,
  type ProductSortKey,
  type TableRow,
} from "@/lib/products";
import { UNIT_LABELS } from "@/lib/receipts";
import { PriceChange } from "./price-change";
import { PriceSparkline } from "./price-sparkline";
import type { ProductRequest } from "./product-dialogs";
import { UnitPrice } from "./unit-price";

/**
 * The columns, shared by the header and every row. They fold on the width the page has:
 * down to the product, its latest price and how that moved.
 */
const SELECT = "flex w-4 shrink-0";
const NAME = "flex min-w-0 flex-1 items-center gap-1";
const CATEGORY = "w-28 shrink-0 truncate @max-3xl:hidden";
const SPARK = "flex w-14 shrink-0 justify-end @max-xl:hidden";
const PRICE = "flex w-24 shrink-0 justify-end truncate";
const CHANGE = "flex w-12 shrink-0 justify-end";
const COUNT = "flex w-10 shrink-0 justify-end tabular-nums @max-3xl:hidden";
const SPENT = "flex w-20 shrink-0 justify-end tabular-nums @max-lg:hidden";
const LAST = "flex w-22 shrink-0 justify-end tabular-nums @max-3xl:hidden";
const OPTIONS = "flex w-6 shrink-0 justify-center";

export function ProductsHeader({
  sort,
  onSort,
}: {
  sort: ProductSort;
  onSort: (key: ProductSortKey) => void;
}) {
  const shared = { sort, onSort };
  return (
    <div className={TABLE_HEAD}>
      <span className={SELECT} />
      <span className={cn(NAME, "ps-6")}>
        <SortHeader {...shared} column="name" label="Product" />
      </span>
      <span className={CATEGORY}>
        <SortHeader {...shared} column="category" label="Category" title="Item category" />
      </span>
      <span className={SPARK} />
      <span className={PRICE}>
        <SortHeader {...shared} end column="price" label="Latest" title="Latest price per unit" />
      </span>
      <span className={CHANGE}>
        <SortHeader
          {...shared}
          end
          column="change"
          label="Move"
          title="How the latest price moved"
        />
      </span>
      <span className={COUNT}>
        <SortHeader
          {...shared}
          end
          column="purchases"
          label="Lines"
          title="Purchases in the range"
        />
      </span>
      <span className={cn(SPENT, "items-center gap-1")}>
        <HelpCard
          label="Spent: what this counts"
          title="Spent"
          body={[
            "What these lines took of what their receipts paid, with each receipt's tax and discounts spread over its lines, as the Item spending report does.",
            "A product with kinds counts them too. Its kinds' rows show their part, so nothing counts twice.",
          ]}
        />
        <SortHeader {...shared} end column="spent" label="Spent" title="Spent in the range" />
      </span>
      <span className={LAST}>
        <SortHeader {...shared} end column="last" label="Last" title="Last bought" />
      </span>
      <span className={OPTIONS} />
    </div>
  );
}

const spentTitle = (row: ProductActivity, format: (amount: number) => string) =>
  row.kinds === 0
    ? undefined
    : `${format(row.spent)} itself, ${format(row.rollup.spent - row.spent)} in its kinds`;

const changeTitle = (
  row: ProductActivity,
  format: (amount: number) => string,
  formatDay: (day: string) => string,
) => {
  const { change } = row;
  if (change !== null)
    return `${priceText(change.before, row.unit, format)} before, ${priceText(change.latest, row.unit, format)} at ${change.payee ?? "no store"} on ${formatDay(change.date)}`;
  return row.kinds > 0
    ? "A product with kinds shows only its own purchases moving: a mix of kinds is not a price change"
    : undefined;
};

function RowName({ entry, onFold }: { entry: TableRow; onFold: () => void }) {
  const { row, depth, folds, open } = entry;
  return (
    <span
      className={NAME}
      style={depth === 0 ? undefined : { paddingInlineStart: `${depth * 1.25}rem` }}
    >
      {folds ? (
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? "Hide" : "Show"} the kinds of ${row.name}`}
          className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onFold}
        >
          <ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        </button>
      ) : (
        <span className="w-5 shrink-0" />
      )}
      <Link
        to="/products/$product"
        params={{ product: row.id }}
        title={row.name}
        className={cn(
          "min-w-0 truncate outline-none hover:underline focus-visible:underline",
          row.archived && "text-muted-foreground",
        )}
      >
        {row.name}
      </Link>
      {row.size !== null && row.sizeUnit !== null && (
        <span className="shrink-0 text-xs text-muted-foreground @max-xl:hidden">
          {row.size} {UNIT_LABELS[row.sizeUnit]}
        </span>
      )}
      {row.archived && <span className="shrink-0 text-xs text-muted-foreground">Archived</span>}
    </span>
  );
}

function ProductRowMenu({
  row,
  onRequest,
}: {
  row: ProductActivity;
  onRequest: (request: ProductRequest) => void;
}) {
  const { id: book } = useBook();
  const navigate = useNavigate();
  const update = useBookMutation(book, "update_product");
  return (
    <RowMenu label={`${row.name} options`}>
      <MenuItem
        onClick={() => void navigate({ to: "/products/$product", params: { product: row.id } })}
      >
        <PackageOpenIcon />
        Open
      </MenuItem>
      <MenuItem onClick={() => onRequest({ kind: "category", products: [row] })}>
        <FolderTreeIcon />
        Set item category…
      </MenuItem>
      <MenuItem onClick={() => onRequest({ kind: "merge", products: [row] })}>
        <MergeIcon />
        Merge into…
      </MenuItem>
      <MenuItem onClick={() => update.mutate({ id: row.id, archived: !row.archived })}>
        <ArchiveIcon />
        {row.archived ? "Unarchive" : "Archive"}
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        variant="destructive"
        onClick={() => onRequest({ kind: "delete", products: [row] })}
      >
        <Trash2Icon />
        Delete…
      </MenuItem>
    </RowMenu>
  );
}

export function ProductRow({
  entry,
  categoryName,
  selected,
  onSelect,
  onFold,
  onRequest,
}: {
  entry: TableRow;
  categoryName: string | undefined;
  selected: boolean;
  onSelect: () => void;
  onFold: () => void;
  onRequest: (request: ProductRequest) => void;
}) {
  const { format, formatDay } = useBook();
  const { row, context } = entry;
  const price = latestPrice(row);
  const { change } = row;
  return (
    <div
      className={cn(
        TABLE_ROW,
        "h-9",
        selected && "bg-accent/60",
        context && "text-muted-foreground",
      )}
    >
      <span className={SELECT}>
        <Checkbox aria-label={`Select ${row.name}`} checked={selected} onCheckedChange={onSelect} />
      </span>
      <RowName entry={entry} onFold={onFold} />
      <span className={cn(CATEGORY, "text-muted-foreground")} title={categoryName}>
        {categoryName}
      </span>
      <span className={SPARK}>
        <PriceSparkline prices={row.prices.map((each) => each.price)} />
      </span>
      <span
        className={PRICE}
        title={
          row.unmeasured > 0
            ? `${row.unmeasured} of its lines cannot be measured per its unit, so they are left out`
            : undefined
        }
      >
        {price !== null && <UnitPrice price={price} unit={row.unit} />}
      </span>
      <span className={cn(CHANGE, "text-xs")} title={changeTitle(row, format, formatDay)}>
        {change !== null && <PriceChange percent={change.changePct} />}
      </span>
      <span className={cn(COUNT, "text-muted-foreground")}>{row.rollup.purchases || ""}</span>
      <span className={SPENT} title={spentTitle(row, format)}>
        {row.rollup.spent === 0 ? "" : format(row.rollup.spent)}
      </span>
      <span className={cn(LAST, "text-muted-foreground")}>
        {row.rollup.lastBought === null ? "" : formatDay(row.rollup.lastBought)}
      </span>
      <span className={OPTIONS}>
        <ProductRowMenu row={row} onRequest={onRequest} />
      </span>
    </div>
  );
}
