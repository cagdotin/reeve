/**
 * A payee from a line's text that stays the same for every purchase at one shop, so a rename rule
 * holds for its later lines (docs/rules/bank.md).
 */
import { PAYEE_PROFILES, type PayeeProfile } from "./payee-profiles.ts";

export interface BankOfLine {
  readonly name: string;
  readonly country: string;
}

/** A card payment abroad ends in the fee and the rate. */
const FEE_TAIL = /\s+(?:SPESEN|KURS|GEB(?:Ü|UE)HR|FEE|EXCHANGE RATE)\b.*$/i;

const NOISE: ReadonlyArray<RegExp> = [
  FEE_TAIL,
  /\b\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?\b/g,
  /\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\.?(?:[ /]\d{1,2}:\d{2}(?::\d{2})?)?/g,
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
  /\b\d+[.,]\d{2}\s+[A-Z]{3}\b/g,
  /(?:X{2,}|\*{2,})\d{2,4}\b|\bCB\*\d+/g,
  /\b\d{4,}\b/g,
  /\*{2,}/g,
];

const HAS_LETTER = /\p{L}/u;

/** The text without what differs between two purchases at one shop; the text when nothing is left. */
export const withoutNoise = (text: string): string => {
  const cleaned = NOISE.reduce((rest, pattern) => rest.replace(pattern, " "), text)
    .replace(/\s+/g, " ")
    .replace(/^[\s.,:;/*-]+|[\s.,:;/-]+$/g, "");
  return HAS_LETTER.test(cleaned) ? cleaned : text.trim();
};

/** A card network's name field holds 22 characters; city, postcode and country follow it. */
const NAME_LENGTH = 22;

/** The merchant's name from a card network's merchant field: name, city, postcode, country code. */
export const descriptorName = (descriptor: string): string => {
  const words = descriptor
    .replace(FEE_TAIL, "")
    .replace(/\s+\d{3}$/, "")
    .replace(/\s+\d[\d -]*$/, "")
    .split(/\s+/)
    .filter((word) => word !== "");
  const named = words.length > 1 ? words.slice(0, -1) : words;
  const kept: Array<string> = [];
  for (const word of named) {
    const next = [...kept, word].join(" ");
    if (kept.length > 0 && next.length > NAME_LENGTH) break;
    kept.push(word);
  }
  return kept.join(" ");
};

const appliesTo = (profile: PayeeProfile, bank: BankOfLine) =>
  profile.countries.includes(bank.country.toUpperCase()) &&
  (profile.banks === undefined || profile.banks.test(bank.name));

/** What a profile reads out of the line, before the noise goes; null when no pattern matches. */
export const profilePayee = (
  text: string,
  profiles: ReadonlyArray<PayeeProfile>,
): string | null => {
  for (const profile of profiles)
    for (const line of profile.lines) {
      const match = line.pattern.exec(text);
      if (match === null) continue;
      if (line.payee !== undefined) return line.payee;
      const { payee, descriptor } = match.groups ?? {};
      if (descriptor !== undefined && descriptor.trim() !== "") return descriptorName(descriptor);
      if (payee !== undefined && payee.trim() !== "") return payee.trim();
    }
  return null;
};

/** With no bank, as for a file, every profile is tried, since each reads only its own format. */
export const payeeFromText = (text: string, bank: BankOfLine | null): string => {
  const profiles =
    bank === null ? PAYEE_PROFILES : PAYEE_PROFILES.filter((profile) => appliesTo(profile, bank));
  return withoutNoise(profilePayee(text, profiles) ?? text);
};
