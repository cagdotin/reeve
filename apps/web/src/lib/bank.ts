import type { BankLink, BankSyncResult } from "@reeve/contract/catalog";
import { toastManager } from "@reeve/ui/components/toast";
import { useQuery } from "@tanstack/react-query";
import { bookQuery, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";

export function useBankStatus() {
  const { id: book } = useBook();
  return useQuery(bookQuery(book, "bank_status", {}));
}

export function useBankLink(account: string): BankLink | undefined {
  return useBankStatus().data?.links.find((link) => link.account === account);
}

/** What a person has to act on; a bank asking to wait passes by itself. */
export const bankProblem = (link: BankLink): string | undefined => {
  switch (link.status) {
    case "reauth_required":
      return `The consent at ${link.bank} has ended`;
    case "attention":
    case "failed":
      return link.statusMessage ?? `The last fetch from ${link.bank} failed`;
    case "new":
    case "ok":
    case "rate_limited":
      return undefined;
  }
};

/** The cleared balance minus what the bank says, when the bank's figure is comparable. */
export const bankDifference = (link: BankLink): number | null =>
  link.bankBalance === null || !link.bankBalanceBooked ? null : link.cleared - link.bankBalance;

export const syncSummary = (result: BankSyncResult): string => {
  const parts = [`${result.added} new`, `${result.updated} updated`];
  if (result.dismissed > 0) parts.push(`${result.dismissed} left out`);
  if (result.conflicts > 0) parts.push(`${result.conflicts} to check`);
  return parts.join(", ");
};

export const lastFetched = (link: BankLink): string =>
  link.lastSyncedAt === null
    ? "Not fetched yet"
    : `Last fetched ${new Date(link.lastSyncedAt).toLocaleString()}`;

export function useFetchFromBank() {
  const { id: book } = useBook();
  const sync = useBookMutation(book, "sync_bank_accounts");
  const fetchAccount = (account: string, force = false) =>
    sync.mutate(
      { account, force },
      {
        onSuccess: ([result]) => {
          if (result === undefined) return;
          if (result.status === "ok") {
            toastManager.add({ type: "success", title: `Fetched: ${syncSummary(result)}` });
            return;
          }
          toastManager.add({
            type: "error",
            title: result.message ?? "The bank did not answer",
            ...(result.status === "rate_limited" && !force
              ? {
                  actionProps: {
                    children: "Fetch anyway",
                    onClick: () => fetchAccount(account, true),
                  },
                }
              : {}),
          });
        },
      },
    );
  return { fetchAccount, pending: sync.isPending };
}
