export interface BrandTheme {
  accent: string;
  surface: { base: string; card: string };
  text: { primary: string; secondary: string };
  border: string;
  status: { approved: string; new: string; rejected: string };
}

export const LIGHT_THEME: BrandTheme = {
  accent: "#2b7fff",
  surface: { base: "#f6f6f7", card: "#ffffff" },
  text: { primary: "#09090b", secondary: "#71717b" },
  border: "#e4e4e7",
  status: { approved: "#16a34a", new: "#d97706", rejected: "#dc2626" },
};

export const DARK_THEME: BrandTheme = {
  accent: "#4f8fff",
  surface: { base: "#09090b", card: "#18181b" },
  text: { primary: "#fafafa", secondary: "#9f9fa9" },
  border: "#ffffff1a",
  status: { approved: "#22c55e", new: "#f59e0b", rejected: "#ef4444" },
};
