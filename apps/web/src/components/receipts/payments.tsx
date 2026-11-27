import type { Receipt } from "@reeve/contract/catalog";
import { PageAlert } from "@/components/page-alert";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckIcon, LinkIcon, SearchIcon, UnlinkIcon } from "lucide-react";
import { useState } from "react";
import { Money } from "@/components/money";
import { Badge } from "@reeve/ui/components/badge";
import { Button } from "@reeve/ui/components/button";
import { Spinner } from "@reeve/ui/components/spinner";
import { bookQuery, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";

/** The transactions that pay the receipt, and the ones that may. */
export function Payments({ receipt }: { receipt: Receipt }) {
  const { id: book, formatDay } = useBook();
  const unlink = useBookMutation(book, "unlink_receipt_payment");
  const [finding, setFinding] = useState(false);
  const payable = receipt.total !== 0;
  const open = payable && (finding || receipt.payments.length === 0);
  const warnings = receipt.warnings.filter(
    (each) => each.code === "unpaid" || each.code === "overpaid",
  );

  return (
    <div className="grid gap-2">
      {!open && payable && !receipt.status.matched && (
        <Button variant="ghost" className="justify-self-start" onClick={() => setFinding(true)}>
          <SearchIcon />
          Find matching transaction
        </Button>
      )}
      {receipt.payments.map((payment) => (
        <div
          key={payment.transactionId}
          className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[13px]"
        >
          <div className="grid min-w-0 flex-1">
            <span className="truncate">{payment.payee ?? "No payee"}</span>
            <span className="truncate text-xs text-muted-foreground">
              {formatDay(payment.date)} ·{" "}
              {payment.accountId === null ? (
                (payment.account ?? "Transfer")
              ) : (
                <Link
                  to="/accounts/$account"
                  params={{ account: payment.accountId }}
                  className="hover:underline"
                >
                  {payment.account}
                </Link>
              )}
            </span>
          </div>
          <div className="grid justify-items-end">
            <Money amount={payment.amount} tone="none" />
            {payment.amount !== -payment.transactionAmount && (
              <span className="text-[11px] text-muted-foreground">
                of <Money amount={-payment.transactionAmount} tone="none" />
              </span>
            )}
          </div>
          {payment.applied && <Badge variant="success">Applied</Badge>}
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Unlink"
            title="Unlink: the transaction stays as it is"
            onClick={() =>
              unlink.mutate({ receipt: receipt.id, transaction: payment.transactionId })
            }
          >
            <UnlinkIcon />
          </Button>
        </div>
      ))}
      {open && <Matches receipt={receipt.id} />}
      {!payable && (
        <p className="text-xs text-muted-foreground">
          A receipt's total can't be zero. Enter what was paid to link a payment.
        </p>
      )}
      {payable && receipt.payments.length === 0 && (
        <p className="text-xs text-muted-foreground">
          A cash purchase needs a transaction on a cash account to link to.
        </p>
      )}
      {warnings.map((warning) => (
        <PageAlert key={warning.code} variant="warning" title={warning.message} />
      ))}
    </div>
  );
}

/** Transactions that may pay the receipt, best first, with why. */
function Matches({ receipt }: { receipt: string }) {
  const { id: book, formatDay } = useBook();
  const matches = useQuery(bookQuery(book, "suggest_receipt_matches", { id: receipt, limit: 6 }));
  const link = useBookMutation(book, "link_receipt_payment");
  if (matches.isPending)
    return (
      <div className="flex justify-center p-3">
        <Spinner />
      </div>
    );
  const candidates = matches.data ?? [];
  return (
    <div className="grid gap-1.5">
      <span className="text-xs text-muted-foreground">
        {candidates.length === 0
          ? "No transaction within 3 days before to 10 days after for this amount."
          : "Transactions that may pay it"}
      </span>
      {candidates.map((match) => (
        <div
          key={match.transactionId}
          className="grid gap-1 rounded-lg border border-dashed px-2.5 py-1.5 text-[13px]"
        >
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{match.payee ?? "No payee"}</span>
            <Money amount={-match.amount} tone="none" />
            <Button
              variant={match.sure ? "default" : "outline"}
              loading={link.isPending && link.variables?.transaction === match.transactionId}
              onClick={() => link.mutate({ receipt, transaction: match.transactionId })}
            >
              <LinkIcon />
              Link
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
            <span>
              {formatDay(match.date)} · {match.account}
            </span>
            <Badge variant={match.sure ? "success" : "outline"} size="sm">
              {match.sure && <CheckIcon />}
              {Math.round(match.score * 100)}%
            </Badge>
            {match.reasons.map((reason) => (
              <span key={reason} className="rounded bg-muted px-1">
                {reason}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
