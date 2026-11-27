// Small per-browser preferences. Storage can throw (private mode, blocked site data), so every
// access is guarded and the app works without it.
const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string | null) => {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Ignore.
  }
};

const pref = (key: string) => ({
  get: () => read(key),
  set: (value: string | null) => write(key, value),
});

export const lastBook = pref("reeve:book");
export const theme = pref("reeve:theme");
export const budgetMonths = pref("reeve:budget-months");
export const collapsedGroups = pref("reeve:collapsed-groups");
export const collapsedCategories = pref("reeve:collapsed-categories");
export const sidebarCollapsed = pref("reeve:sidebar-collapsed");
export const launcherRecent = pref("reeve:launcher-recent");
export const splitPanelWidth = pref("reeve:split-panel-width");
