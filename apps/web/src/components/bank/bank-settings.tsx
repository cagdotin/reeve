import type { BankConnection, BankLink } from "@reeve/contract/catalog";
import { formatAmount } from "@reeve/contract/rules";
import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Badge } from "@reeve/ui/components/badge";
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
import { Field, FieldLabel } from "@reeve/ui/components/field";
import { Input } from "@reeve/ui/components/input";
import { Switch } from "@reeve/ui/components/switch";
import {
  bankDifference,
  bankProblem,
  lastFetched,
  useBankStatus,
  useFetchFromBank,
} from "@/lib/bank";
import { LinkBankDialog, type LinkStep } from "@/components/bank/link-bank-dialog";
import { Group, Row, useBookSettings } from "@/components/settings/sections";
import { bookQuery, useAppMutation, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";

const CONTROL_PANEL = "https://enablebanking.com/cp/applications";
const DEFAULT_REDIRECT = "https://localhost/reeve";
const RENEW_WITHIN_DAYS = 14;
const DAY_MS = 86_400_000;

const consentLabel = (connection: BankConnection, now: number) => {
  if (connection.status === "pending") return "Waiting for your approval";
  if (connection.status === "expired") return "Consent ended";
  if (connection.validUntil === null) return "Consent active";
  const until = new Date(connection.validUntil);
  const days = Math.ceil((until.getTime() - now) / DAY_MS);
  return `Consent ends ${until.toLocaleDateString()} (${days} days)`;
};

/** Everything about the banks of this book: the key, the consents and what they feed. */
export function BankSettings() {
  const status = useBankStatus().data;
  const [step, setStep] = useState<LinkStep | null>(null);
  if (status === undefined) return null;
  return (
    <>
      <KeySetup
        key={status.applicationId ?? "none"}
        applicationId={status.applicationId}
        redirectUrl={status.redirectUrl}
      />
      {status.configured && (
        <>
          <Group label="Consents">
            {status.connections.map((connection) => (
              <ConnectionRow
                key={connection.id}
                connection={connection}
                linked={status.links.filter((link) => link.connection === connection.id).length}
                onLink={() => setStep({ kind: "accounts", connection })}
                onRenewing={setStep}
              />
            ))}
            <div className="py-4">
              <Button onClick={() => setStep({ kind: "choose" })}>Add a bank…</Button>
            </div>
          </Group>
          <Group label="Linked accounts">
            {status.links.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                No account is fed from a bank yet.
              </p>
            ) : (
              status.links.map((link) => <LinkRow key={link.account} link={link} />)
            )}
          </Group>
          <AutoFetch />
        </>
      )}
      <LinkBankDialog step={step} onStep={setStep} />
    </>
  );
}

function AutoFetch() {
  const { settings, set } = useBookSettings();
  return (
    <Group label="Fetching">
      <Row
        label="Fetch by itself"
        hint="While reeve runs, fetch each linked account about every 6 hours. A bank allows 4 fetches a day when nobody is there, so reeve stays below that."
      >
        <Switch
          aria-label="Fetch by itself"
          checked={settings.bankAutoSync}
          onCheckedChange={(bankAutoSync) => set({ bankAutoSync })}
        />
      </Row>
    </Group>
  );
}

function KeySetup({
  applicationId: current,
  redirectUrl: currentRedirect,
}: {
  applicationId: string | null;
  redirectUrl: string | null;
}) {
  const save = useAppMutation("set_bank_credentials");
  const forget = useAppMutation("remove_bank_credentials");
  const [editing, setEditing] = useState(current === null);
  const [applicationId, setApplicationId] = useState(current ?? "");
  const [redirectUrl, setRedirectUrl] = useState(currentRedirect ?? DEFAULT_REDIRECT);
  const [key, setKey] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (key === null) return;
    save.mutate(
      { applicationId: applicationId.trim(), key, redirectUrl: redirectUrl.trim() },
      {
        onSuccess: () => {
          setKey(null);
          setEditing(false);
        },
      },
    );
  };

  if (!editing)
    return (
      <Group label="Enable Banking">
        <Row label="Application" hint={current}>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              Replace key…
            </Button>
            <Button variant="ghost" onClick={() => forget.mutate({})}>
              Forget key
            </Button>
          </div>
        </Row>
      </Group>
    );

  return (
    <Group label="Enable Banking">
      <form onSubmit={submit} className="flex max-w-xl flex-col gap-4 py-4">
        <p className="text-sm text-muted-foreground">
          reeve reads your banks through an application you register yourself, free, at{" "}
          <a className="underline" href={CONTROL_PANEL} target="_blank" rel="noreferrer">
            Enable Banking
          </a>
          . Register it for production, link your own accounts to it there, and give reeve the key
          it downloads. The key stays in this computer's reeve folder and never leaves it.
        </p>
        <Field>
          <FieldLabel>Application ID</FieldLabel>
          <Input
            value={applicationId}
            onChange={(event) => setApplicationId(event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel>Private key (.pem file)</FieldLabel>
          <Input
            type="file"
            accept=".pem"
            required
            onChange={(event) =>
              void event.target.files?.[0]?.text().then(setKey, () => setKey(null))
            }
          />
        </Field>
        <Field>
          <FieldLabel>Redirect address</FieldLabel>
          <Input
            value={redirectUrl}
            onChange={(event) => setRedirectUrl(event.target.value)}
            required
          />
        </Field>
        <p className="text-xs text-muted-foreground">
          Register this same address for the application. It only has to start with https: nothing
          needs to answer there.
        </p>
        <div className="flex gap-2">
          <Button type="submit" disabled={key === null || save.isPending}>
            Save
          </Button>
          {current !== null && (
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </Group>
  );
}

function ConnectionRow({
  connection,
  linked,
  onLink,
  onRenewing,
}: {
  connection: BankConnection;
  linked: number;
  onLink: () => void;
  onRenewing: (step: LinkStep) => void;
}) {
  const { id: book } = useBook();
  const begin = useBookMutation(book, "begin_bank_link");
  const remove = useBookMutation(book, "remove_bank_connection");
  const [now] = useState(() => Date.now());
  const endsSoon =
    connection.validUntil !== null &&
    new Date(connection.validUntil).getTime() - now < RENEW_WITHIN_DAYS * DAY_MS;
  const renew = () =>
    begin.mutate(
      { bank: connection.bank, country: connection.country },
      {
        onSuccess: ({ url }) => onRenewing({ kind: "approve", bank: connection.bank, url }),
      },
    );
  const canLink = connection.status === "active" && linked < connection.accounts.length;
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="truncate">{connection.bank}</span>
          {connection.status === "expired" && <Badge variant="warning">Ended</Badge>}
        </div>
        <div className="text-xs text-muted-foreground">{consentLabel(connection, now)}</div>
      </div>
      <div className="flex flex-wrap gap-2">
        {canLink && (
          <Button variant="outline" onClick={onLink}>
            Link accounts…
          </Button>
        )}
        {connection.status !== "pending" && (connection.status === "expired" || endsSoon) && (
          <Button variant="outline" disabled={begin.isPending} onClick={renew}>
            Renew…
          </Button>
        )}
        <Button
          variant="ghost"
          aria-label={`Remove ${connection.bank}`}
          disabled={remove.isPending}
          onClick={() => remove.mutate({ id: connection.id })}
        >
          Remove
        </Button>
      </div>
    </div>
  );
}

function LinkRow({ link }: { link: BankLink }) {
  const { id: book } = useBook();
  const unlink = useBookMutation(book, "unlink_bank_account");
  const { fetchAccount, pending } = useFetchFromBank();
  const [leftOut, setLeftOut] = useState(false);
  const problem = bankProblem(link);
  const difference = bankDifference(link);
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {link.accountName} <span className="font-normal text-muted-foreground">{link.bank}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {lastFetched(link)}, from {link.historyStart}
        </div>
        {link.bankBalance !== null && (
          <div className="text-xs text-muted-foreground">
            Bank says {formatAmount(link.bankBalance)}, cleared here {formatAmount(link.cleared)}
            {difference !== null && difference !== 0 && (
              <span className="text-warning-foreground">
                {" "}
                ({formatAmount(difference)} off the bank)
              </span>
            )}
          </div>
        )}
        {(problem ?? (link.status === "rate_limited" ? link.statusMessage : null)) && (
          <div className="text-xs text-warning-foreground">{problem ?? link.statusMessage}</div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={pending}
          aria-label={`Fetch ${link.accountName}`}
          onClick={() => fetchAccount(link.account)}
        >
          Fetch
        </Button>
        <Button variant="ghost" onClick={() => setLeftOut(true)}>
          Left out…
        </Button>
        <Button
          variant="ghost"
          aria-label={`Unlink ${link.accountName}`}
          onClick={() => unlink.mutate({ account: link.account })}
        >
          Unlink
        </Button>
      </div>
      <Dialog open={leftOut} onOpenChange={setLeftOut}>
        <DialogPopup className="max-w-md">{leftOut && <LeftOut link={link} />}</DialogPopup>
      </Dialog>
    </div>
  );
}

/** The lines this account took and no longer holds, and the way to let them back. */
function LeftOut({ link }: { link: BankLink }) {
  const { id: book } = useBook();
  const lines = useQuery(bookQuery(book, "list_dismissed_imports", { account: link.account })).data;
  const restore = useBookMutation(book, "restore_dismissed_imports");
  return (
    <>
      <DialogHeader>
        <DialogTitle>Lines left out of {link.accountName}</DialogTitle>
        <DialogDescription>
          You deleted or undid these. Fetches skip them until you let them back.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        {lines?.length === 0 && <p className="text-sm text-muted-foreground">Nothing left out.</p>}
        {lines?.map((line) => (
          <div key={line.importedId} className="flex items-center gap-3 border-b py-2 text-sm">
            <span className="shrink-0 text-muted-foreground">{line.date}</span>
            <span className="min-w-0 flex-1 truncate">{line.payee ?? "No payee"}</span>
            <span className="shrink-0 tabular-nums">{formatAmount(line.amount)}</span>
            <Button
              variant="ghost"
              onClick={() =>
                restore.mutate({ account: link.account, importedIds: [line.importedId] })
              }
            >
              Let back
            </Button>
          </div>
        ))}
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Close</DialogClose>
      </DialogFooter>
    </>
  );
}
