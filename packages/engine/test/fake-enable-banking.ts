/**
 * A stand-in for Enable Banking's API on a local port, so tests run the real adapter: signing,
 * paging and error mapping included. Set `REEVE_ENABLE_BANKING_URL` to its `url`.
 */
import { generateKeyPairSync, verify, type KeyObject } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

export const TEST_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
export const TEST_APP = "11111111-2222-3333-4444-555555555555";

export interface FakeLine {
  readonly entry_reference?: string | null;
  readonly transaction_amount: { readonly amount: string; readonly currency: string };
  readonly credit_debit_indicator?: "CRDT" | "DBIT";
  readonly creditor?: { readonly name: string } | null;
  readonly debtor?: { readonly name: string } | null;
  readonly status?: string;
  readonly booking_date?: string;
  readonly transaction_date?: string;
  readonly remittance_information?: ReadonlyArray<string>;
  readonly [field: string]: unknown;
}

export interface FakeAccount {
  readonly uid: string;
  readonly name?: string;
  readonly currency?: string;
  readonly identification_hash?: string;
  readonly iban?: string;
  lines: Array<FakeLine>;
  balances?: ReadonlyArray<{ readonly type: string; readonly amount: string }>;
}

export interface FakeBank {
  readonly url: string;
  readonly requests: Array<{ readonly method: string; readonly path: string }>;
  readonly accounts: Map<string, FakeAccount>;
  /** The accounts the next session covers. */
  sessionAccounts: Array<FakeAccount>;
  validUntil: string;
  pageSize: number;
  /** Answers every call this way until cleared. */
  failure: { readonly status: number; readonly body: unknown } | null;
  auths: Array<Record<string, unknown>>;
  readonly close: () => Promise<void>;
}

const checkToken = (request: IncomingMessage, key: KeyObject): boolean => {
  const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1];
  if (token === undefined) return false;
  const [head, body, signature] = token.split(".");
  if (head === undefined || body === undefined || signature === undefined) return false;
  const header = JSON.parse(Buffer.from(head, "base64url").toString()) as Record<string, unknown>;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, number>;
  return (
    header["alg"] === "RS256" &&
    header["kid"] === TEST_APP &&
    payload["iss"] === ("enablebanking.com" as never) &&
    payload["aud"] === ("api.enablebanking.com" as never) &&
    payload["exp"]! - payload["iat"]! <= 86_400 &&
    verify("RSA-SHA256", Buffer.from(`${head}.${body}`), key, Buffer.from(signature, "base64url"))
  );
};

const readBody = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Array<Buffer> = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return chunks.length === 0
    ? {}
    : (JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>);
};

export const startFakeBank = async (): Promise<FakeBank> => {
  const key = publicKey;
  const bank: Omit<FakeBank, "url" | "close"> = {
    requests: [],
    accounts: new Map(),
    sessionAccounts: [],
    validUntil: new Date(Date.now() + 180 * 86_400_000).toISOString(),
    pageSize: 50,
    failure: null,
    auths: [],
  };
  const answer = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  const server: Server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://fake");
      bank.requests.push({ method: request.method ?? "", path: `${url.pathname}${url.search}` });
      if (!checkToken(request, key))
        return answer(response, 401, { error: "UNAUTHORIZED", message: "Bad token" });
      if (bank.failure !== null) return answer(response, bank.failure.status, bank.failure.body);
      const body = await readBody(request);
      if (url.pathname === "/application") return answer(response, 200, { name: "test" });
      if (url.pathname === "/aspsps")
        return answer(response, 200, {
          aspsps: [
            { name: "Erste Bank", country: "AT", maximum_consent_validity: 15_552_000 },
            { name: "Revolut", country: "AT", maximum_consent_validity: 7_776_000 },
          ].filter((each) => each.country === url.searchParams.get("country")),
        });
      if (url.pathname === "/auth" && request.method === "POST") {
        bank.auths.push(body);
        return answer(response, 200, {
          url: `https://bank.example/approve?state=${String(body["state"])}`,
          authorization_id: "auth-1",
        });
      }
      if (url.pathname === "/sessions" && request.method === "POST") {
        if (body["code"] !== "good-code")
          return answer(response, 422, { error: "EXPIRED_AUTHORIZATION_CODE", message: "Used" });
        for (const account of bank.sessionAccounts) bank.accounts.set(account.uid, account);
        return answer(response, 200, {
          session_id: "session-1",
          access: { valid_until: bank.validUntil },
          accounts: bank.sessionAccounts.map((account) => ({
            uid: account.uid,
            name: account.name ?? null,
            currency: account.currency ?? "EUR",
            identification_hash: account.identification_hash ?? null,
            account_id: { iban: account.iban ?? null },
          })),
        });
      }
      if (url.pathname.startsWith("/sessions/") && request.method === "DELETE")
        return answer(response, 200, { message: "OK" });
      const match = /^\/accounts\/([^/]+)\/(transactions|balances)$/.exec(url.pathname);
      const account = match === null ? undefined : bank.accounts.get(match[1]!);
      if (match !== null && account === undefined)
        return answer(response, 404, { error: "ACCOUNT_DOES_NOT_EXIST", message: "No account" });
      if (account !== undefined && match?.[2] === "balances")
        return answer(response, 200, {
          balances: (account.balances ?? []).map((each) => ({
            balance_amount: { amount: each.amount, currency: account.currency ?? "EUR" },
            balance_type: each.type,
          })),
        });
      if (account !== undefined && match?.[2] === "transactions") {
        const start = Number(url.searchParams.get("continuation_key") ?? "0");
        const page = account.lines.slice(start, start + bank.pageSize);
        const next = start + bank.pageSize;
        return answer(response, 200, {
          transactions: page,
          continuation_key: next < account.lines.length ? String(next) : null,
        });
      }
      return answer(response, 404, { error: "NOT_FOUND", message: url.pathname });
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return Object.assign(bank, {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  });
};

/** A booked line, in the provider's words: positive amounts with a direction. */
export const line = (
  id: string | null,
  date: string,
  cents: number,
  party: string,
  extra: Partial<FakeLine> = {},
): FakeLine => ({
  entry_reference: id,
  transaction_amount: {
    amount: (Math.abs(cents) / 100).toFixed(2),
    currency: "EUR",
  },
  credit_debit_indicator: cents < 0 ? "DBIT" : "CRDT",
  ...(cents < 0 ? { creditor: { name: party } } : { debtor: { name: party } }),
  status: "BOOK",
  booking_date: date,
  ...extra,
});
