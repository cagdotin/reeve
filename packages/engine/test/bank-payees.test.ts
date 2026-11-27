import { describe, expect, it } from "vitest";
import { PAYEE_PROFILES } from "../src/imports/payee-profiles.ts";
import { payeeFromText, profilePayee, withoutNoise } from "../src/imports/payee-text.ts";

describe("payee profiles", () => {
  for (const profile of PAYEE_PROFILES)
    for (const [line, payee] of profile.samples)
      it(`${profile.name}: ${line}`, () => {
        expect(withoutNoise(profilePayee(line, [profile]) ?? line)).toBe(payee);
      });

  it("reads a country's lines only for that country's banks", () => {
    const line = "TABAK TRAFIK 3219  K2   01.11. 22:26";
    expect(payeeFromText(line, { name: "Erste Bank", country: "AT" })).toBe("TABAK TRAFIK");
    expect(payeeFromText(line, { name: "Some Bank", country: "FR" })).toBe("TABAK TRAFIK K2");
  });
});

describe("what changes between purchases", () => {
  it.each([
    ["CARTE 12/10/26 MONOPRIX PARIS", "CARTE MONOPRIX PARIS"],
    ["Kartenzahlung REWE Markt 0815 2026-10-12 18:44:02", "Kartenzahlung REWE Markt"],
    ["Netflix.com 1234567890", "Netflix.com"],
    ["UBER *TRIP XXXX1234", "UBER *TRIP"],
    ["Rent", "Rent"],
  ])("%s gives %s", (text, payee) => {
    expect(withoutNoise(text)).toBe(payee);
  });

  it("keeps the text when nothing but noise would be left", () => {
    expect(withoutNoise("12.10. 14:22 4711")).toBe("12.10. 14:22 4711");
  });

  it("gives every purchase at one shop the same payee", () => {
    const bank = { name: "Erste Bank", country: "AT" };
    const payees = new Set(
      [
        "TABAK TRAFIK 2362  K2   03.11. 09:45",
        "TABAK TRAFIK 2362  K2   29.10. 09:42",
        "TABAK TRAFIK 2362  K2   05.10. 11:26",
      ].map((line) => payeeFromText(line, bank)),
    );
    expect([...payees]).toEqual(["TABAK TRAFIK"]);
  });
});
