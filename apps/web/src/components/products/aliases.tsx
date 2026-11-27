import type { ProductAlias } from "@reeve/contract/catalog";
import { BanIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ChoiceSelect } from "@/components/choice-select";
import { Button } from "@reeve/ui/components/button";
import { Input } from "@reeve/ui/components/input";
import { Popover, PopoverPopup, PopoverTrigger } from "@reeve/ui/components/popover";
import { useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";

const ANY = "any";

/** Adds a receipt text that names the product, at one store or any. */
function AddAlias({
  product,
  stores,
}: {
  product: string;
  stores: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}) {
  const { id: book } = useBook();
  const create = useBookMutation(book, "create_alias");
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [code, setCode] = useState("");
  const [store, setStore] = useState(ANY);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim() === "") return;
    create.mutate(
      {
        productId: product,
        text: text.trim(),
        ...(store === ANY ? {} : { payeeId: store }),
        ...(code.trim() === "" ? {} : { code: code.trim() }),
      },
      {
        onSuccess: () => {
          setText("");
          setCode("");
          setOpen(false);
        },
      },
    );
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" />}>
        <PlusIcon />
        Add alias
      </PopoverTrigger>
      <PopoverPopup align="end" className="w-72">
        <form className="grid gap-2" onSubmit={submit}>
          <Input
            autoFocus
            aria-label="Alias text"
            placeholder="As the receipt prints it"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <Input
            aria-label="Alias code"
            placeholder="Article code, if any"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <ChoiceSelect
            items={[
              { value: ANY, label: "Any store" },
              ...stores.map((each) => ({ value: each.id, label: each.name })),
            ]}
            value={store}
            onChange={setStore}
          />
          <Button type="submit" disabled={text.trim() === ""} loading={create.isPending}>
            Add
          </Button>
        </form>
      </PopoverPopup>
    </Popover>
  );
}

/** The receipt texts that name the product, per store or at any; delete one or reject it. */
export function Aliases({
  aliases,
  product,
  stores,
}: {
  aliases: ReadonlyArray<ProductAlias>;
  product: string;
  stores: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}) {
  const { id: book } = useBook();
  const remove = useBookMutation(book, "delete_alias");
  const reject = useBookMutation(book, "reject_alias");
  return (
    <div className="grid gap-1">
      {aliases.length === 0 ? (
        <p className="px-1.5 py-1 text-xs text-muted-foreground">
          No aliases yet. Assigning the product to a line with “Remember for this store” adds one.
        </p>
      ) : (
        <ul className="grid gap-px">
          {aliases.map((alias) => (
            <li
              key={alias.id}
              className="group/alias flex h-7 items-center gap-2 rounded-md px-1.5 text-xs hover:bg-accent"
            >
              <span className="min-w-0 flex-1 truncate" title={alias.text}>
                <span className={alias.rejected ? "text-muted-foreground line-through" : ""}>
                  {alias.text}
                </span>
                {alias.code !== null && (
                  <span className="ms-1.5 font-mono text-muted-foreground">{alias.code}</span>
                )}
              </span>
              <span className="max-w-24 shrink-0 truncate text-muted-foreground">
                {alias.rejected ? "Rejected · " : ""}
                {alias.payee ?? "Any store"}
              </span>
              <span className="flex shrink-0 items-center opacity-0 group-focus-within/alias:opacity-100 group-hover/alias:opacity-100 max-md:opacity-100">
                {!alias.rejected && (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Reject ${alias.text}`}
                    title="Not this product: never fill it in or suggest it for this text"
                    onClick={() =>
                      reject.mutate({
                        productId: alias.productId,
                        text: alias.text,
                        payeeId: alias.payeeId,
                        code: alias.code,
                      })
                    }
                  >
                    <BanIcon />
                  </Button>
                )}
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Delete ${alias.text}`}
                  onClick={() => remove.mutate({ id: alias.id })}
                >
                  <Trash2Icon />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end">
        <AddAlias product={product} stores={stores} />
      </div>
    </div>
  );
}
