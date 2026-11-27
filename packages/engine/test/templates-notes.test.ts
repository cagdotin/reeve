// Ported from Actual's template-notes.test.ts and cleanup-template-notes.test.ts, plus the
// grammar's error reports (checked against peggy 5.1, which Actual builds its parser with).
import { describe, expect, it } from "vitest";
import { parseCleanup, parseTemplate } from "../src/templates/grammar.ts";
import { cleanupOfNote, templateErrors, templatesOfNote, unparse } from "../src/templates/notes.ts";
import type { Template } from "../src/templates/types.ts";

describe("templates of a note (storeNoteTemplates)", () => {
  const cases: Array<{ description: string; note: string; expected: Array<unknown> }> = [
    {
      description: "Stores templates for categories with valid template notes",
      note: "#template 10",
      expected: [{ type: "simple", monthly: 10, limit: null, priority: 0, directive: "template" }],
    },
    {
      description: "Stores negative templates for categories with valid template notes",
      note: "#template -103.23",
      expected: [
        { type: "simple", monthly: -103.23, limit: null, priority: 0, directive: "template" },
      ],
    },
    {
      description: "Stores template when prefix is used with valid template notes",
      note: "test: #template 12",
      expected: [{ type: "simple", monthly: 12, limit: null, priority: 0, directive: "template" }],
    },
    {
      description: "Stores templates for categories with valid goal directive template notes",
      note: "#goal 10",
      expected: [{ type: "goal", amount: 10, priority: null, directive: "goal" }],
    },
    { description: "Does not store empty template notes", note: "", expected: [] },
    { description: "Does not store non template notes", note: "Not a template note", expected: [] },
    {
      description: "Captures a description above a template",
      note: "Car insurance\n#template 10",
      expected: [
        {
          type: "simple",
          monthly: 10,
          limit: null,
          priority: 0,
          directive: "template",
          description: "Car insurance",
        },
      ],
    },
    {
      description: "Captures a multi-line description above a template",
      note: "Line one\nLine two\n#template 10",
      expected: [
        {
          type: "simple",
          monthly: 10,
          limit: null,
          priority: 0,
          directive: "template",
          description: "Line one\nLine two",
        },
      ],
    },
    {
      description: "Ignores prose separated from the template by a blank line",
      note: "Just a note\n\n#template 10",
      expected: [{ type: "simple", monthly: 10, limit: null, priority: 0, directive: "template" }],
    },
    {
      description: "Only attaches a description to the template directly below",
      note: "Groceries\n#template 10\n#template-2 20",
      expected: [
        {
          type: "simple",
          monthly: 10,
          limit: null,
          priority: 0,
          directive: "template",
          description: "Groceries",
        },
        { type: "simple", monthly: 20, limit: null, priority: 2, directive: "template" },
      ],
    },
  ];

  it.each(cases)("$description", ({ note, expected }) => {
    expect(JSON.parse(JSON.stringify(templatesOfNote(note)))).toEqual(expected);
  });
});

describe("checkTemplates", () => {
  const schedules = ["Mock Schedule 1", "Mock Schedule 2"];
  const check = (note: string) => templateErrors("Category 1", templatesOfNote(note), schedules);

  it("Returns success message when templates pass", () => {
    expect(check("#template 10\n#template schedule Mock Schedule 1")).toEqual([]);
  });

  it("Skips notes that are not templates", () => {
    expect(check("Not a template note")).toEqual([]);
  });

  it("Returns errors for templates with parsing errors", () => {
    expect(check("#template broken template")).toEqual(["Category 1: #template broken template"]);
  });

  it("Returns errors for non-existent schedules", () => {
    expect(check("#template schedule Non-existent Schedule")).toEqual([
      'Category 1: Schedule "Non-existent Schedule" does not exist',
    ]);
  });

  it("Returns errors for invalid increase schedule adjustments", () => {
    expect(check("#template schedule Mock Schedule 1 [increase 1001%]")).toEqual([
      "Category 1: #template schedule Mock Schedule 1 [increase 1001%]\nError: Invalid adjustment percentage (1001%). Must be between -100% and 1000%",
    ]);
  });

  it("Returns errors for invalid decrease schedule adjustments", () => {
    expect(check("#template schedule Mock Schedule 1 [decrease 101%]")).toEqual([
      "Category 1: #template schedule Mock Schedule 1 [decrease 101%]\nError: Invalid adjustment percentage (-101%). Must be between -100% and 1000%",
    ]);
  });
});

describe("unparse/parse round-trip", () => {
  const cases = [
    "#template 10",
    "#template up to 50",
    "#template up to 25 per day hold",
    "#template up to 100 per week starting 2025-01-01",
    "#template-2 123.45",
    "#template schedule Rent",
    "#template schedule full Mortgage",
    "#template schedule Netflix [increase 10%]",
    "#template schedule full Groceries [decrease 5%]",
    "#template 50% of Utilities",
    "#template 75% of previous Dining Out",
    "#template 200 repeat every 2 months starting 2025-06-01",
    "#template 300 repeat every week starting 2025-01-07",
    "#template 400 repeat every year starting 2025-01-01 up to 50",
    "#template 100 repeat every 1 months starting 2026-04-01",
    "#template 500 by 2025-12",
    "#template 600 by 2025-11 repeat every month",
    "#template 700 by 2025-10 repeat every 2 months",
    "#template 800 by 2025-09 repeat every year",
    "#template 900 by 2025-08 repeat every 3 years",
    "#template 1000 by 2025-07 spend from 2025-01 repeat every month",
    "#template 1100 by 2025-06 spend from 2025-02 repeat every 2 months",
    "#template remainder",
    "#template remainder 2",
    "#template remainder 3 up to 10",
    "#template average 6 months",
    "#template-5 average 12 months",
    "#template copy from 3 months ago",
    "#template copy from 6 months ago",
    "#goal 1234",
  ];

  it.each(cases)("round-trips: %s", (original) => {
    const parsed = parseTemplate(original);
    expect(parseTemplate(unparse([parsed]))).toEqual(parsed);
  });
});

describe("unparse limit templates", () => {
  it("serializes refill limits to notes syntax", () => {
    expect(
      unparse([
        {
          type: "limit",
          amount: 150,
          hold: false,
          period: "monthly",
          directive: "template",
          priority: null,
        },
        { type: "refill", directive: "template", priority: 2 },
      ]),
    ).toBe("#template-2 up to 150");
  });

  it("serializes non-refill limits with a zero base amount", () => {
    expect(
      unparse([
        {
          type: "limit",
          amount: 200,
          hold: false,
          period: "monthly",
          directive: "template",
          priority: null,
        },
      ]),
    ).toBe("#template 0 up to 200");
  });
});

describe("unparse descriptions", () => {
  it("writes a description above the template line", () => {
    expect(
      unparse([
        {
          type: "simple",
          monthly: 10,
          priority: 0,
          directive: "template",
          description: "Car insurance",
        },
      ]),
    ).toBe("Car insurance\n#template 10");
  });

  it("writes a multi-line description", () => {
    expect(
      unparse([
        {
          type: "goal",
          amount: 100,
          directive: "goal",
          description: "Rainy day fund\nfor emergencies",
        },
      ]),
    ).toBe("Rainy day fund\nfor emergencies\n#goal 100");
  });

  it("drops blank lines so the note stays re-parseable", () => {
    expect(
      unparse([
        {
          type: "simple",
          monthly: 10,
          priority: 0,
          directive: "template",
          description: "first\n\nsecond",
        },
      ]),
    ).toBe("first\nsecond\n#template 10");
  });
});

describe("periodic template intervals", () => {
  it.each(["days", "weeks", "months", "years"])(
    "rejects a zero-%s interval in legacy notes",
    (unit) => {
      expect(() =>
        parseTemplate(`#template 100 repeat every 0 ${unit} starting 2026-09-01`),
      ).toThrow('Expected "day", "week", "year", or [1-9] but "0" found.');
    },
  );
  it.each(["days", "weeks", "months", "years"])(
    "continues to parse positive %s intervals",
    (unit) => {
      expect(
        parseTemplate(`#template 100 repeat every 2 ${unit} starting 2026-09-01`),
      ).toMatchObject({ type: "periodic", period: { amount: 2 } });
    },
  );
  it.each(["002", "000"])("rejects an interval with leading zeroes (%s)", (n) => {
    expect(() => parseTemplate(`#template 100 repeat every ${n} days starting 2026-09-01`)).toThrow(
      'Expected "day", "week", "year", or [1-9] but "0" found.',
    );
  });
});

describe("grammar", () => {
  const parses: Array<[string, Template]> = [
    [
      "#template-2 $123.45 up to 50 hold",
      {
        type: "simple",
        monthly: 123.45,
        limit: { amount: 50, hold: true, period: "monthly", start: null },
        priority: 2,
        directive: "template",
      },
    ],
    [
      "#template 10 % of all income",
      {
        type: "percentage",
        percent: 10,
        previous: false,
        category: "all income",
        priority: 0,
        directive: "template",
      },
    ],
    [
      "#template 3 repeat every 2 weeks starting 2025-01-07 up to 4 per day hold",
      {
        type: "periodic",
        amount: 3,
        period: { period: "week", amount: 2 },
        starting: "2025-01-07",
        limit: { amount: 4, hold: true, period: "daily", start: null },
        priority: 0,
        directive: "template",
      },
    ],
    [
      "#template 1000 by 2025-07 spend from 2025-01 repeat every 2 months",
      {
        type: "spend",
        amount: 1000,
        month: "2025-07",
        annual: false,
        repeat: 2,
        from: "2025-01",
        priority: 0,
        directive: "template",
      },
    ],
    [
      "#template schedule My [weird] name [increase 10]",
      {
        type: "schedule",
        name: "My [weird] name",
        priority: 0,
        directive: "template",
        full: null,
        adjustment: 10,
        adjustmentType: "fixed",
      },
    ],
    [
      "#template average 6 months [decrease 12.5%]",
      {
        type: "average",
        numMonths: 6,
        priority: 0,
        directive: "template",
        adjustment: -12.5,
        adjustmentType: "percent",
      },
    ],
    ["#GOAL 5", { type: "goal", amount: 5, priority: null, directive: "goal" }],
  ];

  it.each(parses)("parses %s", (line, expected) => {
    expect(parseTemplate(line)).toEqual(expected);
  });

  const errors: Array<[string, string]> = [
    ["", 'Expected "#goal" or "#template" but end of input found.'],
    [
      "#template",
      'Expected "-", "average", "copy from", "remainder", "schedule", "up", amount, or percentage but end of input found.',
    ],
    ["#template 10 foo", 'Expected "by", "repeat", or "up" but "f" found.'],
    ["#template 10.5.5", 'Expected "by", "repeat", "up", or end of input but "." found.'],
    ["#template 10 by 2025-1", 'Expected month but "2" found.'],
    ["#template schedule full", "Expected [^ \\t\\r\\n] but end of input found."],
    ["#template 50%", 'Expected "of" but end of input found.'],
    [
      "#template 100 repeat every 0 days starting 2026-09-01",
      'Expected "day", "week", "year", or [1-9] but "0" found.',
    ],
    ["template 10", 'Expected "#goal" or "#template" but "t" found.'],
  ];

  it.each(errors)("reports %j as peggy does", (line, message) => {
    expect(() => parseTemplate(line)).toThrow(message);
  });

  it("keeps the error message on an unparseable note line", () => {
    expect(templatesOfNote("  #template 10 foo")).toEqual([
      {
        type: "error",
        directive: "error",
        line: "  #template 10 foo",
        error: 'Expected "by", "repeat", or "up" but "f" found.',
      },
    ]);
  });
});

describe("cleanup grammar", () => {
  it.each([
    ["#cleanup source", { group: null, type: "source" }],
    ["#cleanup sink", { type: "sink", weight: 1, group: null }],
    ["#cleanup sink 2", { type: "sink", weight: 2, group: null }],
    ["#cleanup Vacations source", { group: "Vacations", type: "source" }],
    ["#cleanup vacations sink 3", { type: "sink", weight: 3, group: "vacations" }],
    ["#cleanup Big Trips sink", { type: "sink", weight: 1, group: "Big Trips" }],
    ["#cleanup VACATIONS", { group: "VACATIONS", type: null }],
  ])("parses %s", (line, expected) => {
    expect(parseCleanup(line)).toEqual(expected);
  });

  it("rejects what is not a cleanup line", () => {
    expect(() => parseCleanup("#cleanup")).toThrow("Expected space but end of input found.");
    expect(() => parseCleanup("#cleanup sourcex")).toThrow('Expected end of input but "x" found.');
  });
});

describe("cleanup lines of a note (storeNoteCleanups)", () => {
  it("persists global source/sink lines with a null group", () => {
    expect(cleanupOfNote("#cleanup source")).toEqual([{ role: "source", groupId: null }]);
    expect(cleanupOfNote("#cleanup sink 2")).toEqual([{ role: "sink", groupId: null, weight: 2 }]);
  });

  it("resolves shared group names to a single group, case-insensitively", () => {
    const names = new Map<string, string>();
    const def1 = cleanupOfNote("#cleanup Vacations source", names);
    const def2 = cleanupOfNote("#cleanup vacations sink", names);
    const def3 = cleanupOfNote("#cleanup VACATIONS", names);
    expect(def1[0]?.groupId).toBe(def2[0]?.groupId);
    expect(def2[0]?.groupId).toBe(def3[0]?.groupId);
    expect(def3).toEqual([{ role: "overspend", groupId: "vacations" }]);
    // The name keeps the casing of whichever line was seen first.
    expect([...names.values()]).toEqual(["Vacations"]);
  });

  it("has no cleanup for notes that carry none", () => {
    expect(cleanupOfNote("totally unrelated note text")).toEqual([]);
    expect(cleanupOfNote(null)).toEqual([]);
  });

  it("skips lines that do not parse", () => {
    expect(cleanupOfNote("#cleanup sourcex\n#Cleanup source\n#cleanup sink")).toEqual([
      { role: "sink", groupId: null, weight: 1 },
    ]);
  });
});
