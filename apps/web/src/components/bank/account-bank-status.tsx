import { formatAmount } from "@reeve/contract/rules";
import { Link } from "@tanstack/react-router";
import { RefreshCwIcon } from "lucide-react";
import { PageAlert } from "@/components/page-alert";
import { Button } from "@reeve/ui/components/button";
import { Spinner } from "@reeve/ui/components/spinner";
import {
  bankDifference,
  bankProblem,
  lastFetched,
  useBankLink,
  useFetchFromBank,
} from "@/lib/bank";

/** A linked account's way to fetch, and what stands out about its link. */
export function AccountBankStatus({ account }: { account: string }) {
  const link = useBankLink(account);
  const { fetchAccount, pending } = useFetchFromBank();
  if (link === undefined) return null;
  const problem = bankProblem(link);
  const difference = bankDifference(link);
  return (
    <>
      {problem !== undefined ? (
        <PageAlert
          variant="warning"
          title={problem}
          action={
            <Button
              variant="ghost"
              render={<Link to="/settings/$section" params={{ section: "banks" }} />}
            >
              Open Banks
            </Button>
          }
        />
      ) : (
        difference !== null &&
        difference !== 0 && (
          <PageAlert variant="warning" title={`${formatAmount(difference)} off the bank`}>
            Your cleared balance minus what the bank says.
          </PageAlert>
        )
      )}
      <span className="text-xs text-muted-foreground md:hidden">{lastFetched(link)}</span>
      <Button
        variant="ghost"
        title={lastFetched(link)}
        disabled={pending}
        onClick={() => fetchAccount(account)}
      >
        {pending ? <Spinner /> : <RefreshCwIcon />}
        <span className="max-md:sr-only">Fetch from bank</span>
      </Button>
    </>
  );
}
