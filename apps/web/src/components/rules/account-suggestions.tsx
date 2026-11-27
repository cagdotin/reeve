import type { AccountSuggestion } from "@reeve/contract/catalog";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PageAlert } from "@/components/page-alert";
import { Button } from "@reeve/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@reeve/ui/components/dialog";
import { bookQuery, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

/** Rules worth making on account numbers from bank lines, each in one click (docs/rules/bank.md). */
export function AccountSuggestions() {
  const { id: book } = useBook();
  const suggestions =
    useQuery(bookQuery(book, "suggest_account_rules", {})).data?.suggestions ?? [];
  const [open, setOpen] = useState(false);
  if (suggestions.length === 0 && !open) return null;
  return (
    <>
      {suggestions.length > 0 && (
        <PageAlert
          variant="info"
          title={`${plural(suggestions.length, "account number")} worth a rule`}
          action={
            <Button variant="ghost" onClick={() => setOpen(true)}>
              Review
            </Button>
          }
        >
          From what your banks sent: a payee they always go to, or your own account.
        </PageAlert>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Account numbers worth a rule</DialogTitle>
            <DialogDescription>
              A rule on the other party's account number holds when the bank changes its text.
              Numbers seen under several names, as a card clearing account or Klarna, are left out.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="grid grid-cols-1 gap-3">
            {suggestions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing left to review.</p>
            ) : (
              suggestions.map((suggestion) => (
                <Suggested key={suggestion.accountNumber} suggestion={suggestion} />
              ))
            )}
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Done</DialogClose>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}

function Suggested({ suggestion }: { suggestion: AccountSuggestion }) {
  const { id: book } = useBook();
  const accept = useBookMutation(book, "accept_account_suggestion");
  const dismiss = useBookMutation(book, "dismiss_account_suggestion");
  const { accountNumber } = suggestion;
  const transfer = suggestion.kind === "transfer";
  const target = transfer ? suggestion.account.name : suggestion.payee.name;
  return (
    <section
      aria-label={`Account ${accountNumber}`}
      className="grid grid-cols-1 gap-2 rounded-lg border p-3"
    >
      <div className="grid gap-0.5">
        <span className="font-mono text-sm break-all">{accountNumber}</span>
        <span className="text-sm text-muted-foreground">
          {transfer
            ? `Your account ${target}: ${plural(suggestion.lines, "line")} from it can become transfers.`
            : `Every one of ${plural(suggestion.lines, "line")} from it went to ${target}.`}
        </span>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="ghost"
          loading={dismiss.isPending}
          onClick={() => dismiss.mutate({ accountNumber })}
        >
          Dismiss
        </Button>
        <Button
          variant="outline"
          loading={accept.isPending}
          onClick={() => accept.mutate({ accountNumber })}
        >
          {transfer ? `Make transfers to ${target}` : `Rule: always ${target}`}
        </Button>
      </div>
    </section>
  );
}
