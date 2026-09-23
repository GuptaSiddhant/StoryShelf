/** Brand theme tokens (accent, surfaces, text, borders, statuses). */
export interface BrandTheme {
  accent: string;
  accentContrast?: string;
  ring?: string;
  surface: { base: string; card: string; muted?: string; subtle?: string };
  text: { primary: string; secondary: string; muted?: string };
  border: string;
  borderSubtle?: string;
  status: { approved: string; new: string; rejected: string };
  sidebarBg?: string;
  topbarBg?: string;
  radius?: string;
  radiusSm?: string;
  shadow?: string;
}

/** Default light brand theme (shadcn-like zinc, content-first). */
export const LIGHT_THEME: BrandTheme = {
  accent: "#1d5fcf",
  accentContrast: "#ffffff",
  ring: "#1d5fcf",
  surface: { base: "#fafafa", card: "#ffffff", muted: "#f4f4f5", subtle: "#fafafa" },
  text: { primary: "#09090b", secondary: "#71717a", muted: "#a1a1aa" },
  border: "#e4e4e7",
  borderSubtle: "#f4f4f5",
  status: { approved: "#16a34a", new: "#d97706", rejected: "#dc2626" },
  sidebarBg: "#ffffff",
  topbarBg: "#1d5fcf",
  radius: "0.5rem",
  radiusSm: "0.375rem",
  shadow: "0 1px 2px rgba(0,0,0,.04)",
};

/** Default dark brand theme (shadcn-like zinc). */
export const DARK_THEME: BrandTheme = {
  accent: "#4f8fff",
  accentContrast: "#09090b",
  ring: "#4f8fff",
  surface: { base: "#09090b", card: "#111113", muted: "#27272a", subtle: "#18181b" },
  text: { primary: "#fafafa", secondary: "#a1a1aa", muted: "#71717a" },
  border: "#27272a",
  borderSubtle: "#1e1e22",
  status: { approved: "#22c55e", new: "#f59e0b", rejected: "#ef4444" },
  sidebarBg: "#111113",
  topbarBg: "#0f172a",
  radius: "0.5rem",
  radiusSm: "0.375rem",
  shadow: "0 1px 2px rgba(0,0,0,.3)",
};
