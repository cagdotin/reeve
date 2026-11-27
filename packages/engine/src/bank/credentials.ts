import { InvalidRequest } from "@reeve/contract";
import { Schema } from "effect";
import { createPrivateKey } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/** The application registered at the provider, with the private key that signs every call. */
export interface BankCredentials {
  readonly applicationId: string;
  readonly redirectUrl: string;
  readonly key: string;
}

const Stored = Schema.Struct({ applicationId: Schema.String, redirectUrl: Schema.String });

const folder = (home: string) => join(home, "bank");
const keyFile = (home: string) => join(folder(home), "enable-banking.pem");
const appFile = (home: string) => join(folder(home), "enable-banking.json");

const writePrivate = (file: string, content: string) => {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temp, content, { mode: 0o600 });
  renameSync(temp, file);
};

/** The credentials in a reeve home, or null. A broken file reads as none, so setup can replace it. */
export const readCredentials = (home: string): BankCredentials | null => {
  if (!existsSync(keyFile(home)) || !existsSync(appFile(home))) return null;
  try {
    const app = Schema.decodeUnknownSync(Schema.fromJsonString(Stored))(
      readFileSync(appFile(home), "utf8"),
    );
    return { ...app, key: readFileSync(keyFile(home), "utf8") };
  } catch {
    return null;
  }
};

/** Refuses anything but an RSA private key, without saying what it was given. */
export const checkKey = (key: string): void => {
  try {
    if (createPrivateKey(key).asymmetricKeyType === "rsa") return;
  } catch {
    // Reported below: the parser's message can quote the input.
  }
  throw new InvalidRequest({ message: "That is not an RSA private key in PEM form" });
};

/** Writes the key and application into the home, readable only by this user. */
export const saveCredentials = (home: string, credentials: BankCredentials): void => {
  mkdirSync(folder(home), { recursive: true, mode: 0o700 });
  chmodSync(folder(home), 0o700);
  writePrivate(keyFile(home), credentials.key);
  const { applicationId, redirectUrl } = credentials;
  writePrivate(appFile(home), `${JSON.stringify({ applicationId, redirectUrl }, null, 2)}\n`);
};

export const removeCredentials = (home: string): boolean => {
  const had = existsSync(keyFile(home)) || existsSync(appFile(home));
  rmSync(keyFile(home), { force: true });
  rmSync(appFile(home), { force: true });
  return had;
};
