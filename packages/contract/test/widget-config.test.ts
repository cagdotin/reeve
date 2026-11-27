import { Schema } from "effect";
import { describe, expect, test } from "vitest";
import { WidgetConfig } from "../src/catalog/reports.ts";

const placement = { version: 1, title: null, presentation: {} } as const;
const inherit = { accounts: { mode: "inherit" } } as const;

describe("WidgetConfig", () => {
  test.each([
    ["a report placement", { ...placement, scope: inherit }],
    ["a local widget's settings", { ...placement, scope: inherit, settings: { daysAhead: 90 } }],
    ["a text widget", { ...placement, settings: { content: "# Hi" } }],
  ])("keeps %s through decoding and encoding", (_, config) => {
    expect(Schema.decodeUnknownSync(WidgetConfig)(config)).toEqual(config);
    expect(Schema.encodeSync(WidgetConfig)(config as WidgetConfig)).toEqual(config);
  });
});
