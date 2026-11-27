import { describe, expect, it } from "vitest";
import { contrast, hslOf, rgbOf, wcagLevel } from "./contrast.ts";

describe("contrast", () => {
  it("is 21 for black on white, whichever way round", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21);
    expect(contrast("#FFFFFF", "#000000")).toBeCloseTo(21);
  });

  it("is 1 for a color on itself", () => {
    expect(contrast("#16634A", "#16634A")).toBe(1);
  });

  it("names WCAG's levels at their thresholds", () => {
    expect(wcagLevel(7)).toBe("AAA");
    expect(wcagLevel(6.99)).toBe("AA");
    expect(wcagLevel(4.5)).toBe("AA");
    expect(wcagLevel(4.49)).toBe("Large text");
    expect(wcagLevel(3)).toBe("Large text");
    expect(wcagLevel(2.99)).toBe("Shapes only");
  });
});

describe("color values", () => {
  it("reads RGB channels", () => {
    expect(rgbOf("#0B3A2E")).toBe("11 58 46");
  });

  it("converts to HSL", () => {
    expect(hslOf("#FF0000")).toBe("0 100% 50%");
    expect(hslOf("#00FF00")).toBe("120 100% 50%");
    expect(hslOf("#0000FF")).toBe("240 100% 50%");
    expect(hslOf("#808080")).toBe("0 0% 50%");
  });
});
