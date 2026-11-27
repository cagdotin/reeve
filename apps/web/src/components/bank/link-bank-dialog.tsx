import type { BankAccountOffer, BankConnection } from "@reeve/contract/catalog";
import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button, buttonVariants } from "@reeve/ui/components/button";
import { Checkbox } from "@reeve/ui/components/checkbox";
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
import { Label } from "@reeve/ui/components/label";
import { useBankStatus } from "@/lib/bank";
import { ChoiceSelect } from "@/components/choice-select";
import { bookQuery, run, showError, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";

export type LinkStep =
  | { readonly kind: "choose" }
  | { readonly kind: "approve"; readonly bank: string; readonly url: string }
  | { readonly kind: "accounts"; readonly connection: BankConnection };

const COUNTRIES = [
  ["AT", "Austria"],
  ["BE", "Belgium"],
  ["BG", "Bulgaria"],
  ["HR", "Croatia"],
  ["CY", "Cyprus"],
  ["CZ", "Czechia"],
  ["DK", "Denmark"],
  ["EE", "Estonia"],
  ["FI", "Finland"],
  ["FR", "France"],
  ["DE", "Germany"],
  ["GR", "Greece"],
  ["HU", "Hungary"],
  ["IS", "Iceland"],
  ["IE", "Ireland"],
  ["IT", "Italy"],
  ["LV", "Latvia"],
  ["LI", "Liechtenstein"],
  ["LT", "Lithuania"],
  ["LU", "Luxembourg"],
  ["MT", "Malta"],
  ["NL", "Netherlands"],
  ["NO", "Norway"],
  ["PL", "Poland"],
  ["PT", "Portugal"],
  ["RO", "Romania"],
  ["SK", "Slovakia"],
  ["SI", "Slovenia"],
  ["ES", "Spain"],
  ["SE", "Sweden"],
  ["GB", "United Kingdom"],
].map(([value, label]) => ({ value: value!, label: label! }));

/** Linking walks forward: choose a bank, approve there, then say what each account feeds. */
export function LinkBankDialog({
  step,
  onStep,
}: {
  step: LinkStep | null;
  onStep: (step: LinkStep | null) => void;
}) {
  return (
    <Dialog open={step !== null} onOpenChange={(open) => !open && onStep(null)}>
      <DialogPopup className="max-w-lg">
        {step?.kind === "choose" && <ChooseBank onStep={onStep} />}
        {step?.kind === "approve" && <Approve step={step} onStep={onStep} />}
        {step?.kind === "accounts" && (
          <MapAccounts connection={step.connection} onDone={() => onStep(null)} />
        )}
      </DialogPopup>
    </Dialog>
  );
}

function ChooseBank({ onStep }: { onStep: (step: LinkStep) => void }) {
  const { id: book } = useBook();
  const [country, setCountry] = useState("AT");
  const [filter, setFilter] = useState("");
  const banks = useQuery({
    queryKey: ["list_banks", country],
    queryFn: () => run("list_banks", { country }),
    retry: false,
  });
  const begin = useBookMutation(book, "begin_bank_link");
  const shown = (banks.data ?? []).filter((bank) =>
    bank.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a bank</DialogTitle>
        <DialogDescription>
          The bank asks you to approve read-only access. reeve can never move money.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="flex flex-col gap-3">
        <ChoiceSelect label="Country" items={COUNTRIES} value={country} onChange={setCountry} />
        <Input
          aria-label="Find a bank"
          placeholder="Find a bank"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        {banks.isError && (
          <p className="text-sm text-destructive-foreground">{banks.error.message}</p>
        )}
        <ul className="flex flex-col">
          {shown.map((bank) => (
            <li key={bank.name}>
              <Button
                variant="ghost"
                className="w-full justify-start"
                disabled={begin.isPending}
                onClick={() =>
                  begin.mutate(
                    { bank: bank.name, country },
                    {
                      onSuccess: ({ url }) => onStep({ kind: "approve", bank: bank.name, url }),
                    },
                  )
                }
              >
                {bank.name}
              </Button>
            </li>
          ))}
        </ul>
      </DialogPanel>
    </>
  );
}

function Approve({
  step,
  onStep,
}: {
  step: Extract<LinkStep, { kind: "approve" }>;
  onStep: (step: LinkStep) => void;
}) {
  const { id: book } = useBook();
  const complete = useBookMutation(book, "complete_bank_link");
  const [address, setAddress] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    complete.mutate(
      { redirectUrl: address.trim() },
      { onSuccess: (connection) => onStep({ kind: "accounts", connection }) },
    );
  };
  return (
    <form onSubmit={submit} className="contents">
      <DialogHeader>
        <DialogTitle>Approve at {step.bank}</DialogTitle>
        <DialogDescription>
          Sign in and approve there. The bank then sends you to an address that may show an error
          page. That is fine: copy the whole address from the address bar and paste it here.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="flex flex-col gap-4">
        <a
          className={buttonVariants({ variant: "outline" })}
          href={step.url}
          target="_blank"
          rel="noreferrer"
        >
          Open {step.bank}
        </a>
        <Field>
          <FieldLabel>Address you landed on</FieldLabel>
          <Input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="https://localhost/reeve?code=…"
            required
          />
        </Field>
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button type="submit" disabled={address.trim() === "" || complete.isPending}>
          Continue
        </Button>
      </DialogFooter>
    </form>
  );
}

interface Choice {
  /** An account's id, or what else to do with this bank account. */
  readonly target: string;
  readonly name: string;
  readonly onBudget: boolean;
  readonly historyStart: string;
}

const LEAVE_OUT = "none";
const offerName = (offer: BankAccountOffer) => offer.name ?? offer.iban ?? offer.id;

function MapAccounts({ connection, onDone }: { connection: BankConnection; onDone: () => void }) {
  const { id: book } = useBook();
  const accounts = useQuery(bookQuery(book, "list_accounts", {})).data ?? [];
  const links = useBankStatus().data?.links ?? [];
  const link = useBookMutation(book, "link_bank_account");
  const sync = useBookMutation(book, "sync_bank_accounts");
  const taken = new Set(links.map((each) => each.account));
  const [choices, setChoices] = useState<Readonly<Record<string, Choice>>>({});
  const choiceOf = (offer: BankAccountOffer): Choice =>
    choices[offer.id] ?? {
      target: LEAVE_OUT,
      name: offerName(offer),
      onBudget: true,
      historyStart: "",
    };
  const change = (offer: BankAccountOffer, next: Partial<Choice>) =>
    setChoices((all) => ({ ...all, [offer.id]: { ...choiceOf(offer), ...next } }));
  const options = [
    { value: LEAVE_OUT, label: "Leave out" },
    { value: "new", label: "A new account" },
    ...accounts
      .filter((account) => !account.closed && !taken.has(account.id))
      .map((account) => ({ value: account.id, label: account.name })),
  ];
  const feedOf = (offer: BankAccountOffer) =>
    links.find((each) => each.providerAccount === offer.id);
  const chosen = connection.accounts.filter(
    (offer) => feedOf(offer) === undefined && choiceOf(offer).target !== LEAVE_OUT,
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await Promise.all(
        chosen.map(async (offer) => {
          const choice = choiceOf(offer);
          const made = await link.mutateAsync({
            connection: connection.id,
            providerAccount: offer.id,
            ...(choice.target === "new"
              ? { name: choice.name, onBudget: choice.onBudget }
              : { account: choice.target }),
            ...(choice.historyStart === "" ? {} : { historyStart: choice.historyStart }),
          });
          await sync.mutateAsync({ account: made.account });
        }),
      );
      onDone();
    } catch (error) {
      if (error instanceof Error) showError(error);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="contents">
      <DialogHeader>
        <DialogTitle>Link accounts at {connection.bank}</DialogTitle>
        <DialogDescription>
          Accounts linked before carry over by themselves. For an account that already has
          transactions, fetches start the day after its latest one unless you choose a day.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="flex flex-col gap-4">
        {connection.accounts.map((offer) => {
          const feeds = feedOf(offer);
          const choice = choiceOf(offer);
          const name = offerName(offer);
          return (
            <fieldset key={offer.id} className="flex flex-col gap-2 border-b pb-4 last:border-b-0">
              <legend className="text-sm font-medium">
                {name}
                {offer.currency !== null && (
                  <span className="font-normal text-muted-foreground"> {offer.currency}</span>
                )}
              </legend>
              {offer.iban !== null && (
                <div className="text-xs break-all text-muted-foreground">{offer.iban}</div>
              )}
              {feeds !== undefined ? (
                <div className="text-sm">Feeds {feeds.accountName}</div>
              ) : (
                <ChoiceSelect
                  label={`Feed from ${name}`}
                  items={options}
                  value={choice.target}
                  onChange={(target) => change(offer, { target })}
                />
              )}
              {choice.target === "new" && (
                <>
                  <Field>
                    <FieldLabel>Account name</FieldLabel>
                    <Input
                      value={choice.name}
                      onChange={(event) => change(offer, { name: event.target.value })}
                      required
                    />
                  </Field>
                  <Label className="flex items-center gap-2">
                    <Checkbox
                      checked={choice.onBudget}
                      onCheckedChange={(onBudget) => change(offer, { onBudget })}
                    />
                    On budget
                  </Label>
                </>
              )}
              {choice.target !== LEAVE_OUT && feeds === undefined && (
                <Field>
                  <FieldLabel>First day to take (optional)</FieldLabel>
                  <Input
                    type="date"
                    value={choice.historyStart}
                    onChange={(event) => change(offer, { historyStart: event.target.value })}
                  />
                </Field>
              )}
            </fieldset>
          );
        })}
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Done</DialogClose>
        <Button type="submit" disabled={chosen.length === 0 || link.isPending || sync.isPending}>
          Link and fetch
        </Button>
      </DialogFooter>
    </form>
  );
}
