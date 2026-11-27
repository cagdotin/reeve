const channels = (hex: string) =>
  [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));

const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** The WCAG contrast ratio of two `#rrggbb` colors, from 1 to 21. */
export const contrast = (a: string, b: string) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
};

/** What a contrast ratio allows, by WCAG's levels for text. */
export const wcagLevel = (ratio: number) => {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  return ratio >= 3 ? "Large text" : "Shapes only";
};

export const rgbOf = (hex: string) => channels(hex).join(" ");

export const hslOf = (hex: string) => {
  const [r, g, b] = channels(hex).map((value) => value / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  const sextant = () => {
    if (delta === 0) return 0;
    if (max === r) return ((g - b) / delta + 6) % 6;
    return max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  };
  return `${Math.round(sextant() * 60)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`;
};
