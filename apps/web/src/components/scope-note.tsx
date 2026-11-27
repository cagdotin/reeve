import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { scopePhrase, useAccountScope } from "@/lib/account-scope";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";

/** The accounts shown, as a sentence names them: "Checking", "budget accounts", "every account". */
export const useScopePhrase = () => {
  const { id: book } = useBook();
  const scope = useAccountScope();
  const accounts = useQuery(bookQuery(book, "list_accounts", { closed: true })).data ?? [];
  return scopePhrase(scope, accounts.find((account) => account.id === scope)?.name);
};

/** Why a scoped page lists what it lists, and what editing it reaches. Nothing under all accounts. */
export function ScopeNote({ children }: { children: (where: string) => ReactNode }) {
  const scope = useAccountScope();
  const where = useScopePhrase();
  if (scope === "all") return null;
  return (
    <p data-testid="scope-note" className="px-3 pt-2 pb-1 text-xs text-muted-foreground">
      {children(where)}
    </p>
  );
}
