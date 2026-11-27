/**
 * How banks write the other party into a line's text when they send no name for it, as data held to
 * its sample lines by a test (docs/rules/bank.md).
 */
export interface PayeeProfile {
  readonly name: string;
  /** ISO 3166 alpha-2 codes of the banks' countries. */
  readonly countries: ReadonlyArray<string>;
  /** Narrows the profile to the banks whose name matches; all of the countries' banks without it. */
  readonly banks?: RegExp;
  readonly lines: ReadonlyArray<LinePattern>;
  readonly samples: ReadonlyArray<readonly [line: string, payee: string]>;
}

export interface LinePattern {
  readonly pattern: RegExp;
  /** The payee for every line the pattern matches, for lines that name none. */
  readonly payee?: string;
}

/** A card's marker (`K2`, `D5`, `K001`), the day and the minute, as Austria's card payments write them. */
const CARD_AT = String.raw`[A-Z]\d{1,3}\s+\d{2}\.\d{2}\.\s+\d{2}:\d{2}`;

export const PAYEE_PROFILES: ReadonlyArray<PayeeProfile> = [
  {
    name: "Austrian card payments",
    countries: ["AT"],
    lines: [
      {
        pattern: new RegExp(
          String.raw`^(?:POS|E-COMM)\s+[\d.,]+\s+[A-Z]{2,3}\s+${CARD_AT}\s*(?<descriptor>.*)$`,
        ),
      },
      { pattern: new RegExp(String.raw`^(?<payee>.{1,12}?)\s*\d{4}\s+${CARD_AT}$`) },
      { pattern: /^(?:SB-Auszahlung|AUTOMAT)\b/, payee: "Cash withdrawal" },
      { pattern: /^\*+\s*Abschlussbuchung\b/, payee: "Abschlussbuchung" },
    ],
    samples: [
      ["TABAK TRAFIK 3219  K2   01.11. 22:26", "TABAK TRAFIK"],
      ["GOTAXMIRA.   2362  K2   22.10. 15:34", "GOTAXMIRA"],
      ["BAECKEREI902 2360  K2   25.08. 12:53", "BAECKEREI902"],
      ["COMPANY ABCD 2610  D5   01.01. 13:37", "COMPANY ABCD"],
      [
        "POS          70,90 AT  K2   28.10. 14:44 BILLA DANKT 1598 HAUPTSTRASSE 1010 040",
        "BILLA DANKT",
      ],
      ["POS          27,02 AT  K2   27.10. 21:53 LEBERKAS-PEPI WIEN 1100 040", "LEBERKAS-PEPI"],
      [
        "E-COMM      200,00 US  K2   05.11. 06:48 SP* NORTHWIND SEATTLE 98101 840 SPESEN: 2,59",
        "SP* NORTHWIND",
      ],
      [
        "POS        7007,00 TRY K2   24.08. 17:13 KARMA MARKA KAYSERI 38020 792 SPESEN: 2,03  KURS: 56,09518  VOM:21.08.2026",
        "KARMA MARKA",
      ],
      [
        "E-COMM       12,87 USD K2   15.10. 03:31 PORKBUN.COM SHERWOOD 97140 840 SPESEN: 1,18  KURS: 1,112827  VOM:14.10.2026",
        "PORKBUN.COM",
      ],
      [
        "POS         289,00 SEK K2   15.08. 15:49 ICA SUPERMARKET GLOBEN STOCKHOLM GLO 12126 752 SPESEN: 0,00  KURS: 10,98120  VOM:14.08.2026 ECB:+0,",
        "ICA SUPERMARKET GLOBEN",
      ],
      ["POS           1,11 AT  D4   01.01. 13:37 COMPANY NAME CITY 1010", "COMPANY NAME"],
      ["SB-Auszahlung    K2   S30159 02.09/20:56", "Cash withdrawal"],
      ["AUTOMAT   00029353 K2   01.09. 14:27", "Cash withdrawal"],
      [
        "*** Abschlussbuchung per 30.09.2026 **** Reklamationen bitte binnen 2 Monaten",
        "Abschlussbuchung",
      ],
    ],
  },
];
