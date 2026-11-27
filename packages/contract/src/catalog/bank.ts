/** Read-only bank sync through a provider the person registers with themselves (docs/rules/bank.md). */
import { Schema } from "effect";
import { BankError, Day, Id } from "../domain.ts";
import { BookField, cli, IdField, inBook, type Operation } from "../operation.ts";
import { Rule } from "./rules.ts";

const Named = Schema.Struct({ id: Id, name: Schema.String });

/**
 * A rule worth making on a counterparty's account number, read from the kept bank lines: a payee
 * every line from it lands on, or one of the person's own linked accounts it is a transfer to.
 */
export const AccountSuggestion = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("payee"),
    accountNumber: Schema.String,
    lines: Schema.Int,
    payee: Named,
  }),
  Schema.Struct({
    kind: Schema.Literal("transfer"),
    accountNumber: Schema.String,
    lines: Schema.Int.annotate({ description: "Lines from it that are not yet transfers" }),
    account: Named,
  }),
]);
export type AccountSuggestion = typeof AccountSuggestion.Type;

const AccountNumberField = Schema.String.annotate({
  description: "The counterparty's account number, as a suggestion gives it",
});

export const BankLinkStatus = Schema.Literals([
  "new",
  "ok",
  "reauth_required",
  "rate_limited",
  "attention",
  "failed",
]);
export type BankLinkStatus = typeof BankLinkStatus.Type;

/** A bank the provider reaches. */
export const BankInfo = Schema.Struct({
  name: Schema.String,
  country: Schema.String,
  /** The longest consent this bank gives, in days; null when it does not say. */
  maximumConsentDays: Schema.NullOr(Schema.Int),
});
export type BankInfo = typeof BankInfo.Type;

/** An account a consent covers, which a ledger account can be linked to. */
export const BankAccountOffer = Schema.Struct({
  id: Schema.String,
  name: Schema.NullOr(Schema.String),
  iban: Schema.NullOr(Schema.String),
  currency: Schema.NullOr(Schema.String),
  identificationHash: Schema.NullOr(Schema.String),
});
export type BankAccountOffer = typeof BankAccountOffer.Type;

export const BankConnection = Schema.Struct({
  id: Id,
  bank: Schema.String,
  country: Schema.String,
  status: Schema.Literals(["pending", "active", "expired"]),
  /** When the consent ends, as an ISO time. */
  validUntil: Schema.NullOr(Schema.String),
  accounts: Schema.Array(BankAccountOffer),
});
export type BankConnection = typeof BankConnection.Type;

export const BankLink = Schema.Struct({
  account: Id,
  accountName: Schema.String,
  connection: Id,
  bank: Schema.String,
  providerAccount: Schema.String,
  historyStart: Day,
  status: BankLinkStatus,
  statusMessage: Schema.NullOr(Schema.String),
  lastSyncedAt: Schema.NullOr(Schema.String),
  /** When a fetch is allowed again, after the bank refused one. */
  retryAfter: Schema.NullOr(Schema.String),
  fetchesToday: Schema.Int,
  /** What the bank last said the balance is, in cents. */
  bankBalance: Schema.NullOr(Schema.Int),
  bankBalanceType: Schema.NullOr(Schema.String),
  /** Whether that balance counts only booked money, so it should equal the cleared balance. */
  bankBalanceBooked: Schema.Boolean,
  cleared: Schema.Int,
});
export type BankLink = typeof BankLink.Type;

export const BankStatus = Schema.Struct({
  /** Whether a key is set up, which every provider call needs. */
  configured: Schema.Boolean,
  applicationId: Schema.NullOr(Schema.String),
  redirectUrl: Schema.NullOr(Schema.String),
  connections: Schema.Array(BankConnection),
  links: Schema.Array(BankLink),
});
export type BankStatus = typeof BankStatus.Type;

export const BankSyncResult = Schema.Struct({
  account: Id,
  status: BankLinkStatus,
  message: Schema.NullOr(Schema.String),
  added: Schema.Int,
  updated: Schema.Int,
  unchanged: Schema.Int,
  /** Lines left out because they were deleted or undone here. */
  dismissed: Schema.Int,
  /** Lines left out because the bank sent a known id with another amount or a wrong currency. */
  conflicts: Schema.Int,
  bankBalance: Schema.NullOr(Schema.Int),
});
export type BankSyncResult = typeof BankSyncResult.Type;

export const DismissedImport = Schema.Struct({
  importedId: Schema.String,
  date: Day,
  amount: Schema.Int,
  payee: Schema.NullOr(Schema.String),
});
export type DismissedImport = typeof DismissedImport.Type;

const bankErrors = inBook(BankError);

export const bank = {
  set_bank_credentials: {
    description:
      "Set up the Enable Banking application this computer uses. The key is checked against the provider and kept in the reeve home, readable only by this user, and no operation ever returns it. Give keyPath, the .pem file the provider's control panel downloaded; key is its content, for the web app. redirectUrl is the address registered for the application.",
    readonly: false,
    destructive: true,
    idempotent: true,
    input: Schema.Struct({
      applicationId: Schema.String,
      keyPath: Schema.optionalKey(Schema.String),
      key: Schema.optionalKey(Schema.String.annotate(cli({ omit: true }))),
      redirectUrl: Schema.String,
    }),
    success: Schema.Struct({ applicationId: Schema.String, redirectUrl: Schema.String }),
    error: bankErrors,
    http: { method: "POST", path: "/bank/credentials" },
    cli: {
      command: ["bank", "credentials"],
      description: "Set up the Enable Banking application and its key",
    },
  },
  remove_bank_credentials: {
    description:
      "Delete the Enable Banking key from the reeve home. Links stay, and cannot sync until a key is set up again.",
    readonly: false,
    destructive: true,
    idempotent: true,
    input: Schema.Struct({}),
    success: Schema.Struct({ removed: Schema.Boolean }),
    error: bankErrors,
    http: { method: "DELETE", path: "/bank/credentials" },
    cli: { command: ["bank", "forget-key"], description: "Delete the Enable Banking key" },
  },
  list_banks: {
    description: "The banks the provider reaches in a country (two letters, as AT).",
    readonly: true,
    input: Schema.Struct({ country: Schema.String }),
    success: Schema.Array(BankInfo),
    error: bankErrors,
    http: { method: "GET", path: "/bank/banks" },
    cli: { command: ["bank", "banks"], description: "List the banks of a country" },
  },
  bank_status: {
    description:
      "The bank setup of a book: whether a key is set up, each consent and when it ends, and each linked account with its last sync, status and the bank's balance beside the cleared balance.",
    readonly: true,
    input: Schema.Struct({ book: BookField }),
    success: BankStatus,
    error: inBook(),
    http: { method: "GET", path: "/books/:book/bank" },
    cli: { command: ["bank", "status"], description: "Show consents and linked accounts" },
  },
  begin_bank_link: {
    description:
      "Start a consent at a bank. A person opens the returned url, approves at the bank, and gives the address they land on to complete_bank_link. It asks for the longest consent the bank allows.",
    readonly: false,
    network: true,
    input: Schema.Struct({ book: BookField, bank: Schema.String, country: Schema.String }),
    success: Schema.Struct({ connection: Id, url: Schema.String }),
    error: bankErrors,
    http: { method: "POST", path: "/books/:book/bank/connections" },
    cli: { command: ["bank", "begin"], description: "Start a consent at a bank" },
  },
  complete_bank_link: {
    description:
      "Finish a consent with the address the bank's approval landed on. Gives the accounts it covers. Accounts linked under an earlier consent at the same bank carry over by themselves.",
    readonly: false,
    network: true,
    input: Schema.Struct({
      book: BookField,
      redirectUrl: Schema.String.annotate({ description: "The whole address, with its code" }),
    }),
    success: BankConnection,
    error: bankErrors,
    http: { method: "POST", path: "/books/:book/bank/connections/complete" },
    cli: { command: ["bank", "complete"], description: "Finish a consent" },
  },
  remove_bank_connection: {
    description:
      "End a consent at the provider and unlink its accounts. Their transactions stay in the book.",
    readonly: false,
    destructive: true,
    network: true,
    input: Schema.Struct({ book: BookField, id: IdField("Connection id") }),
    success: Schema.Struct({ removed: Schema.Boolean }),
    error: bankErrors,
    http: { method: "DELETE", path: "/books/:book/bank/connections/:id" },
    cli: { command: ["bank", "remove"], description: "End a consent and unlink its accounts" },
  },
  link_bank_account: {
    description:
      "Feed a ledger account from a bank account of a consent. Give account to link an existing one, or name (and onBudget) to create it, in which case its first sync sets the starting balance. historyStart is the first day to take; it defaults to the day after the account's latest transaction, or 90 days ago for an empty account, which keeps rows imported from files from being taken twice.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      connection: Schema.String,
      providerAccount: Schema.String.annotate({ description: "The id of the consent's account" }),
      account: Schema.optionalKey(Schema.String),
      name: Schema.optionalKey(Schema.String),
      onBudget: Schema.optionalKey(Schema.Boolean),
      historyStart: Schema.optionalKey(Day),
    }),
    success: BankLink,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/bank/links" },
    cli: { command: ["bank", "link"], description: "Feed an account from a bank account" },
  },
  unlink_bank_account: {
    description:
      "Stop feeding an account from its bank. Its transactions stay. It is not a step of undo: link the account again to go back.",
    readonly: false,
    destructive: true,
    input: Schema.Struct({ book: BookField, account: IdField("Account id") }),
    success: Schema.Struct({ removed: Schema.Boolean }),
    error: inBook(),
    http: { method: "DELETE", path: "/books/:book/bank/links/:account" },
    cli: { command: ["bank", "unlink"], description: "Stop feeding an account from its bank" },
  },
  sync_bank_accounts: {
    description:
      "Fetch booked transactions for one linked account, or all of them, and import them: rules run, existing transactions are matched and nothing already there is added twice. Each account's outcome is in its result, not an error. A bank allows about 4 fetches a day when no person is present, so a fifth is refused unless force is set. A fetch that adds something is one undo step, and undoing it leaves those lines out of later fetches until restore_dismissed_imports.",
    readonly: false,
    network: true,
    input: Schema.Struct({
      book: BookField,
      account: Schema.optionalKey(Schema.String),
      force: Schema.optionalKey(Schema.Boolean),
    }),
    success: Schema.Array(BankSyncResult),
    error: bankErrors,
    http: { method: "POST", path: "/books/:book/bank/sync" },
    cli: { command: ["bank", "sync"], description: "Fetch and import booked transactions" },
  },
  list_dismissed_imports: {
    description:
      "The lines an account has taken and no longer holds, deleted or undone. A linked account's fetches leave these out.",
    readonly: true,
    input: Schema.Struct({ book: BookField, account: Schema.String }),
    success: Schema.Array(DismissedImport),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/bank/dismissed" },
    cli: { command: ["bank", "dismissed"], description: "List lines left out of fetches" },
  },
  suggest_account_rules: {
    description:
      "Rules worth making on a counterparty's account number, from the bank lines reeve keeps: an account whose lines (two or more, under one imported payee) all land on one payee, or one of the person's own linked accounts. An account a rule already matches, or one dismissed, is left out; so is one seen under several payee texts, as a card clearing account or a payment processor.",
    readonly: true,
    input: Schema.Struct({ book: BookField }),
    success: Schema.Struct({ suggestions: Schema.Array(AccountSuggestion) }),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/bank/account-suggestions" },
    cli: {
      command: ["bank", "suggestions"],
      description: "List rules worth making on account numbers",
    },
  },
  accept_account_suggestion: {
    description:
      "Make the rule suggest_account_rules offers for an account number: a pre-stage rule that sets the payee, or one that makes its lines transfers to the person's own account, applied to the lines already in, each joined with the other bank's copy of the movement.",
    readonly: false,
    input: Schema.Struct({ book: BookField, accountNumber: AccountNumberField }),
    success: Schema.Struct({
      rule: Rule,
      transfers: Schema.Array(Id).annotate({
        description: "The transactions it made transfers",
      }),
    }),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/bank/account-suggestions/accept" },
  },
  dismiss_account_suggestion: {
    description: "Stop suggesting a rule for an account number.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({ book: BookField, accountNumber: AccountNumberField }),
    success: Schema.Struct({ dismissed: Schema.Boolean }),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/bank/account-suggestions/dismiss" },
  },
  restore_dismissed_imports: {
    description:
      "Bring dismissed lines back into the account from the line the bank sent, which reeve keeps; a line taken before reeve kept lines comes back on the account's next fetch that covers it. Undo takes the transactions back out and leaves the lines out again.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      account: Schema.String,
      importedIds: Schema.Array(Schema.String),
    }),
    success: Schema.Struct({ restored: Schema.Int }),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/bank/dismissed/restore" },
  },
} satisfies Record<string, Operation>;
