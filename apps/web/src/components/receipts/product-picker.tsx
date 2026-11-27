import type { ReceiptLine } from "@reeve/contract/catalog";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BoxIcon, PlusIcon, SparklesIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@reeve/ui/components/button";
import { Checkbox } from "@reeve/ui/components/checkbox";
import { Input } from "@reeve/ui/components/input";
import { Label } from "@reeve/ui/components/label";
import { Popover, PopoverPopup, PopoverTrigger } from "@reeve/ui/components/popover";
import { ScrollArea } from "@reeve/ui/components/scroll-area";
import { cn } from "@reeve/ui/lib/utils";
import { bookQuery, run, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";

const REASONS = {
  alias: "alias",
  "store-alias": "store alias",
  code: "code",
  name: "name",
  "alias-text": "alias text",
} as const;

/**
 * A line's product: suggestions for its text first, a search of every product, or a new product.
 * Assigning can remember the text for the store and fill other lines like it.
 */
export function ProductPicker({ line, payeeId }: { line: ReceiptLine; payeeId: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={line.product === null ? "Assign a product" : `Product: ${line.product}`}
        className={cn(
          "flex h-7 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md border border-transparent px-1.5 text-left text-xs hover:border-input",
          line.productId === null && "text-muted-foreground",
        )}
      >
        <BoxIcon className="size-3.5 shrink-0 opacity-60" />
        <span className="truncate">{line.product ?? "Product…"}</span>
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-80 *:data-[slot=popover-viewport]:p-0">
        {open && <PickerPanel line={line} payeeId={payeeId} onDone={() => setOpen(false)} />}
      </PopoverPopup>
    </Popover>
  );
}

function PickerPanel({
  line,
  payeeId,
  onDone,
}: {
  line: ReceiptLine;
  payeeId: string | null;
  onDone: () => void;
}) {
  const { id: book } = useBook();
  const [search, setSearch] = useState("");
  const [remember, setRemember] = useState(payeeId !== null);
  const [similar, setSimilar] = useState(true);
  const assign = useBookMutation(book, "assign_line_product");
  const reject = useBookMutation(book, "reject_alias");
  const suggestions = useQuery(
    bookQuery(book, "suggest_products", {
      text: line.text,
      ...(payeeId === null ? {} : { payeeId }),
      ...(line.code === null ? {} : { code: line.code }),
      limit: 6,
    }),
  );
  const found = useQuery({
    ...bookQuery(book, "list_products", { query: search.trim(), limit: 8 }),
    enabled: search.trim() !== "",
    placeholderData: keepPreviousData,
  });

  const pick = (productId: string | null) =>
    assign.mutate(
      {
        line: line.id,
        productId,
        ...(productId === null ? {} : { remember, applyToSimilar: similar }),
      },
      { onSuccess: onDone },
    );
  const createAndPick = async (name: string) => {
    const product = await run("create_product", {
      book,
      name,
      ...(line.unit === null ? {} : { unit: line.unit }),
      ...(line.itemCategoryId === null ? {} : { itemCategoryId: line.itemCategoryId }),
    });
    pick(product.id);
  };
  const newName = search.trim() === "" ? line.text.trim() : search.trim();

  return (
    <div className="grid">
      <div className="border-b p-2">
        <Input
          autoFocus
          type="search"
          placeholder="Search products"
          aria-label="Search products"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <ScrollArea className="max-h-64">
        <div className="grid p-1">
          {search.trim() === "" ? (
            <>
              <p className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground">
                Suggestions for “{line.text}”
              </p>
              {(suggestions.data ?? []).map((each) => (
                <div key={each.productId} className="group/item flex items-center">
                  <Option onClick={() => pick(each.productId)}>
                    <SparklesIcon className="size-3.5 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{each.product}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {REASONS[each.reason]} · {Math.round(each.score * 100)}%
                    </span>
                  </Option>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Not this product: never suggest it for this text"
                    aria-label={`Not ${each.product}`}
                    onClick={() =>
                      reject.mutate({ productId: each.productId, text: line.text, payeeId })
                    }
                  >
                    <XIcon />
                  </Button>
                </div>
              ))}
              {suggestions.isSuccess && suggestions.data.length === 0 && (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">No suggestions.</p>
              )}
            </>
          ) : (
            (found.data?.products ?? []).map((product) => (
              <Option key={product.id} onClick={() => pick(product.id)}>
                <BoxIcon className="size-3.5 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{product.name}</span>
              </Option>
            ))
          )}
          {newName !== "" && (
            <Option onClick={() => void createAndPick(newName)}>
              <PlusIcon className="size-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">Create “{newName}”</span>
            </Option>
          )}
        </div>
      </ScrollArea>
      <div className="grid gap-1.5 border-t p-2.5 text-xs">
        <Label className="flex items-center gap-2 text-xs font-normal">
          <Checkbox checked={remember} disabled={payeeId === null} onCheckedChange={setRemember} />
          Remember for this store
        </Label>
        <Label className="flex items-center gap-2 text-xs font-normal">
          <Checkbox checked={similar} onCheckedChange={setSimilar} />
          Also set it on other lines like this
        </Label>
        {line.productId !== null && (
          <Button variant="ghost" className="justify-self-start" onClick={() => pick(null)}>
            <XIcon />
            Clear product
          </Button>
        )}
      </div>
    </div>
  );
}

function Option({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] outline-none hover:bg-accent focus-visible:bg-accent"
    >
      {children}
    </button>
  );
}
