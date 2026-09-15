/** Brand theme tokens (accent, surfaces, text, borders, statuses). */
export interface BrandTheme {
  accent: string;
  surface: { base: string; card: string; muted?: string };
  text: { primary: string; secondary: string };
  border: string;
  status: { approved: string; new: string; rejected: string };
  sidebarBg?: string;
  topbarBg?: string;
}

/** Default light brand theme. */
export const LIGHT_THEME: BrandTheme = {
  accent: "#1d5fcf",
  surface: { base: "#f6f6f7", card: "#ffffff", muted: "#f4f4f5" },
  text: { primary: "#09090b", secondary: "#5a5a6b" },
  border: "#e4e4e7",
  status: { approved: "#16a34a", new: "#d97706", rejected: "#dc2626" },
  sidebarBg: "#ffffff",
  topbarBg: "#1d5fcf",
};

/** Default dark brand theme. */
export const DARK_THEME: BrandTheme = {
  accent: "#4f8fff",
  surface: { base: "#09090b", card: "#18181b", muted: "#1e1e22" },
  text: { primary: "#fafafa", secondary: "#9f9fa9" },
  border: "#ffffff1a",
  status: { approved: "#22c55e", new: "#f59e0b", rejected: "#ef4444" },
  sidebarBg: "#111113",
  topbarBg: "#0f172a",
};
