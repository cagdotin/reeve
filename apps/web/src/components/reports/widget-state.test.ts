import { describe, expect, it } from "vitest";
import { widgetState } from "./widget-state";

const failure = new Error("Server unavailable");
const noRows = (rows: ReadonlyArray<number>) => rows.length === 0;

describe("widgetState", () => {
  it("waits while nothing has loaded", () => {
    expect(widgetState({ data: undefined, error: null })).toEqual({ state: "loading" });
  });

  it("reports a failed first load", () => {
    expect(widgetState({ data: undefined, error: failure })).toEqual({
      state: "failed",
      error: failure,
    });
  });

  it("keeps earlier data beside a failed refresh", () => {
    expect(widgetState({ data: [1], error: failure }, noRows)).toEqual({
      state: "ready",
      data: [1],
      refreshError: failure,
    });
  });

  it("tells an empty result from a loaded one", () => {
    expect(widgetState({ data: [], error: null }, noRows)).toEqual({
      state: "empty",
      data: [],
      refreshError: null,
    });
    expect(widgetState({ data: [], error: failure }, noRows)).toMatchObject({
      state: "empty",
      refreshError: failure,
    });
  });

  it("treats data as never empty without a rule", () => {
    expect(widgetState({ data: 0, error: null })).toMatchObject({ state: "ready", data: 0 });
  });
});
