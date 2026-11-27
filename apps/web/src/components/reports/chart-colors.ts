/**
 * The categorical slots in their fixed order, stepped separately for each theme (validated against
 * the app's surfaces). A series keeps its slot whatever else is shown.
 */
export const CHART_SERIES = {
  light: ["#262626", "#c9603f", "#4a5bc0", "#2a8d6a", "#b9791a", "#b8527f", "#6f7a1a", "#6a55b5"],
  dark: ["#f2f2f2", "#e8967b", "#7b84e0", "#6dbc98", "#e1b56b", "#d982a8", "#c3c77a", "#9a8ae0"],
} as const;

export const CHART_CHROME = {
  light: {
    grid: "#ebebeb",
    axis: "#e5e5e5",
    tick: "#686868",
    ink: "#262626",
    surface: "#ffffff",
    out: "#b8374d",
  },
  dark: {
    grid: "#1f2025",
    axis: "#2a2b30",
    tick: "#9c9ba0",
    ink: "#e6e6e6",
    surface: "#131419",
    out: "#c8586a",
  },
} as const;
