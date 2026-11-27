import type { RuleActivity } from "@reeve/contract/catalog";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { SplitPanel } from "@/components/split-panel";
import { Money } from "@/components/money";
import { counterpartText } from "@/components/register/entry";
import type { Names } from "@/components/rules/rule-model";
import { Button } from "@reeve/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@reeve/ui/components/dialog";
import { toastManager } from "@reeve/ui/components/toast";
import { scopeInput, scopePhrase, useAccountScope } from "@/lib/account-scope";
import { bookQuery, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { reachText, registerSearchFor, ruleSentence } from "@/lib/rules";

export type RuleRequest = { readonly kind: "delete"; readonly rules: ReadonlyArray<RuleActivity> };

const LISTED = 100;

/** Asks before deleting, and keeps rules that belong to a schedule, as delete_rules does. */
function DeleteForm({
  rules,
  names,
  onDone,
}: {
  rules: ReadonlyArray<RuleActivity>;
  names: Names;
  onDone: () => void;
}) {
  const { id: book, format } = useBook();
  const remove = useBookMutation(book, "delete_rules");
  const free = rules.filter((rule) => rule.schedule === null);
  const kept = rules.length - free.length;
  const [only] = free;
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {free.length === 0
            ? "These rules stay"
            : free.length === 1
              ? "Delete this rule?"
              : `Delete ${free.length} rules?`}
        </DialogTitle>
        <DialogDescription>
          {free.length === 1 && only !== undefined && (
            <>
              {ruleSentence(only, names, format)}.
              <br />
            </>
          )}
          {free.length > 0 &&
            `New and imported transactions stop getting ${free.length === 1 ? "its" : "their"} changes. Transactions ${free.length === 1 ? "it" : "they"} already changed stay as they are. You can undo this.`}
          {kept > 0 &&
            ` ${kept} ${kept === 1 ? "belongs" : "belong"} to a schedule and ${kept === 1 ? "stays" : "stay"}: deleting the schedule deletes its rule.`}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button
          variant="destructive"
          disabled={free.length === 0}
          loading={remove.isPending}
          onClick={() =>
            remove.mutate(
              { ids: free.map((rule) => rule.id) },
              {
                onSuccess: ({ deleted }) => {
                  toastManager.add({
                    type: "success",
                    title: `Deleted ${deleted.length} ${deleted.length === 1 ? "rule" : "rules"}`,
                  });
                  onDone();
                },
              },
            )
          }
        >
          Delete
        </Button>
      </DialogFooter>
    </>
  );
}

export function RuleMatches({
  rule,
  names,
  onClose,
}: {
  rule: RuleActivity;
  names: Names;
  onClose: () => void;
}) {
  return (
    <SplitPanel title="Matching transactions" onClose={onClose}>
      <MatchesView key={rule.id} rule={rule} names={names} onClose={onClose} />
    </SplitPanel>
  );
}

/** What the rule's conditions match, newest first, with the register's view when it can say so. */
function MatchesView({
  rule,
  names,
  onClose,
}: {
  rule: RuleActivity;
  names: Names;
  onClose: () => void;
}) {
  const { id: book, format, formatDay } = useBook();
  const scope = useAccountScope();
  const preview = useQuery(
    bookQuery(book, "preview_rule", { ...scopeInput(scope), rule: rule.id, limit: LISTED }),
  );
  const search = registerSearchFor(rule);
  const where = scopePhrase(scope, names.accounts.get(scope));
  const rows = preview.data?.rows ?? [];
  const total = preview.data?.total ?? 0;
  return (
    <div className="@container grid gap-4">
      <p className="text-sm text-muted-foreground">
        {ruleSentence(rule, names, format)}.{" "}
        {scope === "all"
          ? "Its conditions match these today, whether or not the rule changed them."
          : `Its conditions match these on ${where} today, whether or not the rule changed them.`}
      </p>
      <p className="text-xs text-muted-foreground">{reachText(rule, names, format)}</p>
      <div>
        {preview.isError ? (
          <p className="text-sm text-muted-foreground">{preview.error.message}</p>
        ) : preview.isSuccess && rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {scope === "all"
              ? "Its conditions match no transaction."
              : `Its conditions match no transaction on ${where}.`}
          </p>
        ) : (
          <ul className="grid text-[13px]">
            {rows.map((row) => (
              <li
                key={row.postingId}
                className="flex h-8 items-center gap-3 border-b last:border-b-0"
              >
                <span className="w-22 shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatDay(row.date)}
                </span>
                <span className="min-w-0 flex-1 truncate">{row.payee ?? ""}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground @max-md:hidden">
                  {counterpartText(row) ?? "Uncategorized"}
                </span>
                <span className="w-24 shrink-0 truncate text-muted-foreground @max-md:hidden">
                  {row.accountName}
                </span>
                <span className="w-20 shrink-0 text-right">
                  <Money amount={row.amount} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {total > rows.length && (
          <span className="me-auto self-center text-xs text-muted-foreground tabular-nums">
            Newest {rows.length} of {total} register rows
          </span>
        )}
        {search !== null && (
          <Button
            variant="outline"
            render={<Link to="/accounts/$account" params={{ account: scope }} search={search} />}
          >
            Open in register
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

export function RuleDialogs({
  request,
  names,
  onClose,
  onDeleted,
}: {
  request: RuleRequest | null;
  names: Names;
  onClose: () => void;
  onDeleted: () => void;
}) {
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-lg">
        {request?.kind === "delete" && (
          <DeleteForm
            rules={request.rules}
            names={names}
            onDone={() => {
              onDeleted();
              onClose();
            }}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}
