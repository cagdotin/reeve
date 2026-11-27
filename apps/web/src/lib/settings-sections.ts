import {
  BotIcon,
  LandmarkIcon,
  LibraryIcon,
  PaletteIcon,
  SlidersHorizontalIcon,
} from "lucide-react";

/** Settings' sections, each a page of its own, in the order its sidebar lists them. */
export const SETTINGS_SECTIONS = [
  {
    id: "general",
    label: "General",
    icon: SlidersHorizontalIcon,
    keywords: "settings preferences",
  },
  { id: "books", label: "Books", icon: LibraryIcon, keywords: "settings" },
  { id: "banks", label: "Banks", icon: LandmarkIcon, keywords: "settings" },
  { id: "appearance", label: "Appearance", icon: PaletteIcon, keywords: "settings theme" },
  { id: "agents", label: "Agents", icon: BotIcon, keywords: "settings mcp" },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];
