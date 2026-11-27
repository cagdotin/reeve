import type { ProductSummary } from "@reeve/contract/catalog";
import { Link } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { ChoiceSelect } from "@/components/choice-select";
import { Button } from "@reeve/ui/components/button";
import { useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";

/** The products that are a kind of this one, with what each took; add one or take one out. */
export function Kinds({
  product,
  kinds,
  candidates,
}: {
  product: string;
  kinds: ProductSummary["kinds"];
  /** Products that could become a kind of it. */
  candidates: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}) {
  const { id: book, format } = useBook();
  const update = useBookMutation(book, "update_product");
  return (
    <div className="grid gap-1">
      {kinds.length === 0 ? (
        <p className="px-1.5 py-1 text-xs text-muted-foreground">
          Nothing is a kind of it. Oat drink can be a kind of Milk: the prices and spending here
          take it in.
        </p>
      ) : (
        <ul className="grid gap-px">
          {kinds.map((kind) => (
            <li
              key={kind.id}
              className="group/kind flex h-7 items-center gap-2 rounded-md px-1.5 text-xs hover:bg-accent"
            >
              <Link
                to="/products/$product"
                params={{ product: kind.id }}
                className={`min-w-0 flex-1 truncate hover:underline ${kind.archived ? "text-muted-foreground" : ""}`}
              >
                {kind.name}
              </Link>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {kind.purchases} · {format(kind.spent)}
              </span>
              <Button
                size="icon-xs"
                variant="ghost"
                className="opacity-0 group-focus-within/kind:opacity-100 group-hover/kind:opacity-100 max-md:opacity-100"
                aria-label={`Take ${kind.name} out`}
                title="It stays a product, no longer a kind of this one"
                onClick={() => update.mutate({ id: kind.id, parentId: null })}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {candidates.length > 0 && (
        <ChoiceSelect
          items={candidates.map((each) => ({ value: each.id, label: each.name }))}
          value={null}
          placeholder="Add a kind…"
          onChange={(id: string) => update.mutate({ id, parentId: product })}
        />
      )}
    </div>
  );
}
