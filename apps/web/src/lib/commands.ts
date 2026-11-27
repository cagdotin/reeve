import { createContext, useContext } from "react";

/** Opens or closes the window's command palette. */
export const CommandsContext = createContext<(open: boolean) => void>(() => {});

export const useCommands = () => useContext(CommandsContext);

/** Opens the cheat sheet of shortcuts. */
export const ShortcutsContext = createContext<() => void>(() => {});

export const useShowShortcuts = () => useContext(ShortcutsContext);
