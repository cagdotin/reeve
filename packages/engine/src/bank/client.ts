/** Enable Banking's API, the only provider so far. Every call is signed with the person's key. */
import { BankError } from "@reeve/contract";
import type { BankAccountOffer, BankInfo } from "@reeve/contract/catalog";
import { Effect, Schema } from "effect";
import { createPrivateKey, sign } from "node:crypto";
import type { BankCredentials } from "./credentials.ts";

const DEFAULT_URL = "https://api.enablebanking.com";
const TIMEOUT_MS = 30_000;
const TOKEN_SECONDS = 3600;
const MAX_PAGES = 100;

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** The RS256 JWT each request carries; the provider allows a day at most, an hour is plenty. */
export const signToken = (credentials: BankCredentials, now: number = Date.now()): string => {
  const issued = Math.floor(now / 1000);
  const body = `${base64url({ typ: "JWT", alg: "RS256", kid: credentials.applicationId })}.${base64url(
    {
      iss: "enablebanking.com",
      aud: "api.enablebanking.com",
      iat: issued,
      exp: issued + TOKEN_SECONDS,
    },
  )}`;
  const signature = sign("RSA-SHA256", Buffer.from(body), createPrivateKey(credentials.key));
  return `${body}.${signature.toString("base64url")}`;
};

const Failure = Schema.Struct({
  error: Schema.optional(Schema.NullOr(Schema.String)),
  code: Schema.optional(Schema.Unknown),
  message: Schema.optional(Schema.NullOr(Schema.String)),
});

/** Only the code and a short message leave here: a raw body or request may carry a secret. */
const refusal = (status: number, body: unknown): BankError => {
  const parsed = Schema.decodeUnknownOption(Failure)(body);
  const fields = parsed._tag === "Some" ? parsed.value : {};
  const code = fields.error ?? String(status);
  const message = (fields.message ?? `The bank provider answered ${status}`).slice(0, 200);
  return new BankError({ message, code });
};

const Aspsp = Schema.Struct({
  name: Schema.String,
  country: Schema.String,
  maximum_consent_validity: Schema.optional(Schema.NullOr(Schema.Number)),
});

const SessionAccount = Schema.Struct({
  uid: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  currency: Schema.optional(Schema.NullOr(Schema.String)),
  identification_hash: Schema.optional(Schema.NullOr(Schema.String)),
  account_id: Schema.optional(
    Schema.NullOr(Schema.Struct({ iban: Schema.optional(Schema.NullOr(Schema.String)) })),
  ),
});

const Session = Schema.Struct({
  session_id: Schema.String,
  accounts: Schema.Array(SessionAccount),
  access: Schema.optional(
    Schema.NullOr(Schema.Struct({ valid_until: Schema.optional(Schema.NullOr(Schema.String)) })),
  ),
});

const Party = Schema.optional(
  Schema.NullOr(Schema.Struct({ name: Schema.optional(Schema.NullOr(Schema.String)) })),
);

/** A statement line as the provider sends it. */
export const ProviderTransaction = Schema.Struct({
  entry_reference: Schema.optional(Schema.NullOr(Schema.String)),
  transaction_amount: Schema.Struct({ amount: Schema.String, currency: Schema.String }),
  credit_debit_indicator: Schema.optional(Schema.NullOr(Schema.String)),
  creditor: Party,
  debtor: Party,
  status: Schema.optional(Schema.NullOr(Schema.String)),
  booking_date: Schema.optional(Schema.NullOr(Schema.String)),
  value_date: Schema.optional(Schema.NullOr(Schema.String)),
  transaction_date: Schema.optional(Schema.NullOr(Schema.String)),
  remittance_information: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
});
export type ProviderTransaction = typeof ProviderTransaction.Type;

const RawLine = Schema.Record(Schema.String, Schema.Unknown);

/** A line as reeve reads it, beside every field the provider sent, which decoding drops. */
export interface FetchedLine {
  readonly decoded: ProviderTransaction;
  readonly raw: typeof RawLine.Type;
}

const TransactionPage = Schema.Struct({
  transactions: Schema.Array(RawLine),
  continuation_key: Schema.optional(Schema.NullOr(Schema.String)),
});

const Balances = Schema.Struct({
  balances: Schema.Array(
    Schema.Struct({
      balance_amount: Schema.Struct({ amount: Schema.String, currency: Schema.String }),
      balance_type: Schema.String,
    }),
  ),
});

export type ProviderBalance = (typeof Balances.Type)["balances"][number];

export interface OpenedSession {
  readonly sessionId: string;
  readonly validUntil: number | null;
  readonly accounts: ReadonlyArray<BankAccountOffer>;
}

const decode = <A>(schema: Schema.Codec<A, unknown>, value: unknown): Effect.Effect<A, BankError> =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(
      () =>
        new BankError({
          message: "The bank provider sent an answer reeve cannot read",
          code: null,
        }),
    ),
  );

export const bankClient = (credentials: BankCredentials) => {
  const base = process.env["REEVE_ENABLE_BANKING_URL"] ?? DEFAULT_URL;

  const request = <A>(
    schema: Schema.Codec<A, unknown>,
    method: string,
    path: string,
    body?: unknown,
  ): Effect.Effect<A, BankError> =>
    Effect.gen(function* () {
      const answer = yield* Effect.tryPromise({
        try: async () => {
          const response = await fetch(`${base}${path}`, {
            method,
            headers: {
              Authorization: `Bearer ${signToken(credentials)}`,
              "Content-Type": "application/json",
            },
            signal: AbortSignal.timeout(TIMEOUT_MS),
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
          const text = await response.text();
          let parsed: unknown = null;
          try {
            parsed = text === "" ? null : JSON.parse(text);
          } catch {
            // A body that is not JSON says nothing the status does not.
          }
          return { status: response.status, ok: response.ok, body: parsed };
        },
        catch: (error) =>
          new BankError({
            message:
              error instanceof Error && error.name === "TimeoutError"
                ? "The bank provider did not answer in time"
                : "Could not reach the bank provider",
            code: null,
          }),
      });
      if (!answer.ok) return yield* Effect.fail(refusal(answer.status, answer.body));
      return yield* decode(schema, answer.body);
    });

  return {
    /** Fails when the provider does not accept the key. */
    check: request(Schema.Unknown, "GET", "/application"),

    banks: (country: string): Effect.Effect<ReadonlyArray<BankInfo>, BankError> =>
      request(
        Schema.Struct({ aspsps: Schema.Array(Aspsp) }),
        "GET",
        `/aspsps?country=${encodeURIComponent(country.toUpperCase())}&service=AIS`,
      ).pipe(
        Effect.map(({ aspsps }) =>
          aspsps.map((aspsp) => ({
            name: aspsp.name,
            country: aspsp.country,
            maximumConsentDays:
              aspsp.maximum_consent_validity == null
                ? null
                : Math.floor(aspsp.maximum_consent_validity / 86_400),
          })),
        ),
      ),

    begin: (input: {
      readonly bank: string;
      readonly country: string;
      readonly state: string;
      readonly validUntil: Date;
    }) =>
      request(Schema.Struct({ url: Schema.String }), "POST", "/auth", {
        access: { valid_until: input.validUntil.toISOString() },
        aspsp: { name: input.bank, country: input.country },
        state: input.state,
        redirect_url: credentials.redirectUrl,
        psu_type: "personal",
      }),

    openSession: (code: string): Effect.Effect<OpenedSession, BankError> =>
      request(Session, "POST", "/sessions", { code }).pipe(
        Effect.map((session) => ({
          sessionId: session.session_id,
          validUntil: session.access?.valid_until ? Date.parse(session.access.valid_until) : null,
          accounts: session.accounts.map((account) => ({
            id: account.uid,
            name: account.name ?? null,
            iban: account.account_id?.iban ?? null,
            currency: account.currency ?? null,
            identificationHash: account.identification_hash ?? null,
          })),
        })),
      ),

    closeSession: (id: string) =>
      request(Schema.Unknown, "DELETE", `/sessions/${encodeURIComponent(id)}`),

    /** Every booked line from a day on, across the provider's pages. */
    transactions: (input: {
      readonly account: string;
      readonly from: string;
      readonly to: string;
      readonly longest: boolean;
    }): Effect.Effect<ReadonlyArray<FetchedLine>, BankError> =>
      Effect.gen(function* () {
        const lines: Array<FetchedLine> = [];
        let key: string | null = null;
        for (let page = 0; page < MAX_PAGES; page++) {
          const query = new URLSearchParams({
            date_from: input.from,
            date_to: input.to,
            transaction_status: "BOOK",
            ...(input.longest ? { strategy: "longest" } : {}),
            ...(key === null ? {} : { continuation_key: key }),
          });
          const answer: typeof TransactionPage.Type = yield* request(
            TransactionPage,
            "GET",
            `/accounts/${encodeURIComponent(input.account)}/transactions?${query}`,
          );
          for (const raw of answer.transactions)
            lines.push({ decoded: yield* decode(ProviderTransaction, raw), raw });
          const next: string | null = answer.continuation_key ?? null;
          if (next === null || next === key) break;
          key = next;
        }
        return lines;
      }),

    balances: (account: string): Effect.Effect<ReadonlyArray<ProviderBalance>, BankError> =>
      request(Balances, "GET", `/accounts/${encodeURIComponent(account)}/balances`).pipe(
        Effect.map(({ balances }) => balances),
      ),
  };
};
