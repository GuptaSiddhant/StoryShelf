/**
 * Brand packs: curated light/dark theme pairs for `UIConfig`.
 *
 * Drop one into the server options (`ui: { ...brandPacks.ocean }`) instead
 * of hand-rolling every token. Packs carry full `BrandTheme` pairs so both
 * color schemes stay coherent; every pack validates against
 * {@link uiConfigSchema}.
 */
import type { BrandTheme } from "./config.ts";

/** One named light/dark theme pair. */
export interface BrandPack {
  light: BrandTheme;
  dark: BrandTheme;
}

/** Default StoryShelf look (matches the built-in UI themes). */
const storyshelf: BrandPack = {
  light: {
    accent: "#1d5fcf",
    accentContrast: "#ffffff",
    ring: "#1d5fcf",
    surface: { base: "#fafafa", card: "#ffffff", muted: "#f4f4f5", subtle: "#fafafa" },
    text: { primary: "#09090b", secondary: "#5b5b64", muted: "#6a6a73" },
    border: "#e4e4e7",
    borderSubtle: "#f4f4f5",
    status: { approved: "#16a34a", new: "#d97706", rejected: "#dc2626" },
    sidebarBg: "#ffffff",
    topbarBg: "#1d5fcf",
    radius: "0.5rem",
    radiusSm: "0.375rem",
    shadow: "0 1px 2px rgba(0,0,0,.04)",
  },
  dark: {
    accent: "#4f8fff",
    accentContrast: "#09090b",
    ring: "#4f8fff",
    surface: { base: "#09090b", card: "#111113", muted: "#27272a", subtle: "#18181b" },
    text: { primary: "#fafafa", secondary: "#a1a1aa", muted: "#8a8a94" },
    border: "#27272a",
    borderSubtle: "#1e1e22",
    status: { approved: "#22c55e", new: "#f59e0b", rejected: "#ef4444" },
    sidebarBg: "#111113",
    topbarBg: "#0f172a",
    radius: "0.5rem",
    radiusSm: "0.375rem",
    shadow: "0 1px 2px rgba(0,0,0,.3)",
  },
};

/** Deep teal on warm paper (light) / abyss (dark). */
const ocean: BrandPack = {
  light: {
    accent: "#0e7490",
    accentContrast: "#ffffff",
    ring: "#0e7490",
    surface: { base: "#faf7f0", card: "#ffffff", muted: "#f1ece1", subtle: "#faf7f0" },
    text: { primary: "#1c1917", secondary: "#78716c", muted: "#a8a29e" },
    border: "#e7e0d2",
    borderSubtle: "#f1ece1",
    status: { approved: "#16a34a", new: "#d97706", rejected: "#dc2626" },
    sidebarBg: "#ffffff",
    topbarBg: "#0e7490",
    radius: "0.5rem",
    radiusSm: "0.375rem",
    shadow: "0 1px 2px rgba(0,0,0,.04)",
  },
  dark: {
    accent: "#22d3ee",
    accentContrast: "#082f36",
    ring: "#22d3ee",
    surface: { base: "#081014", card: "#0e1a21", muted: "#1d303b", subtle: "#101e25" },
    text: { primary: "#f0f9fa", secondary: "#93a7b0", muted: "#5d747e" },
    border: "#1d303b",
    borderSubtle: "#14242c",
    status: { approved: "#22c55e", new: "#f59e0b", rejected: "#ef4444" },
    sidebarBg: "#0e1a21",
    topbarBg: "#082f36",
    radius: "0.5rem",
    radiusSm: "0.375rem",
    shadow: "0 1px 2px rgba(0,0,0,.3)",
  },
};

/** Curated brand packs keyed by name (`storyshelf` is the default look). */
export const brandPacks: Record<string, BrandPack> = { storyshelf, ocean };

/** Look up a brand pack by name (undefined for unknown names). */
export function brandPack(name: string): BrandPack | undefined {
  return brandPacks[name];
}
