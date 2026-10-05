import type { BrandTheme } from "../theme.ts";

/**
 * CSS variable tokens: brand-driven colors (per theme), theme-independent
 * scales (type, space, radius, motion), and tokens derived from the brand
 * accent/status colors so customer themes need no extra fields.
 */
export function tokenCss(light: BrandTheme, dark: BrandTheme): string {
  return [
    scaleTokens(),
    `:root {\n${colorVars(light, LIGHT_FALLBACK)}\n}`,
    `[data-theme="dark"] {\n${colorVars(dark, DARK_FALLBACK)}\n}`,
    `@media (prefers-color-scheme: dark) {\n[data-theme="system"] {\n${colorVars(dark, DARK_FALLBACK)}\n}\n}`,
  ].join("\n");
}

interface Fallbacks {
  accentContrast: string;
  muted: string;
  subtle: string;
  sidebar: string;
  shadow: string;
  shadow2: string;
  shadow3: string;
  /** Share of the status color mixed into tinted backgrounds. */
  tint: string;
}

const LIGHT_FALLBACK: Fallbacks = {
  accentContrast: "#fff",
  muted: "#f4f4f5",
  subtle: "#fafafa",
  sidebar: "#ffffff",
  shadow: "0 1px 2px rgba(0,0,0,.04)",
  shadow2: "0 4px 12px rgba(0,0,0,.08)",
  shadow3: "0 12px 32px rgba(0,0,0,.14)",
  tint: "10%",
};

const DARK_FALLBACK: Fallbacks = {
  accentContrast: "#09090b",
  muted: "#27272a",
  subtle: "#18181b",
  sidebar: "#111113",
  shadow: "0 1px 2px rgba(0,0,0,.3)",
  shadow2: "0 4px 12px rgba(0,0,0,.4)",
  shadow3: "0 12px 32px rgba(0,0,0,.55)",
  tint: "16%",
};

/** Theme-independent scales shared by every component. */
function scaleTokens(): string {
  return `
    :root {
      --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
      --text-xs: 0.75rem;
      --text-sm: 0.8125rem;
      --text-base: 0.875rem;
      --text-lg: 1rem;
      --text-xl: 1.25rem;
      --text-2xl: 1.5rem;
      --leading-tight: 1.25;
      --leading-normal: 1.5;
      --space-1: 0.25rem;
      --space-2: 0.5rem;
      --space-3: 0.75rem;
      --space-4: 1rem;
      --space-5: 1.25rem;
      --space-6: 1.5rem;
      --space-8: 2rem;
      --radius-pill: 999px;
      --ease: cubic-bezier(0.2, 0, 0, 1);
      --dur-fast: 120ms;
      --dur-base: 200ms;
      --sidebar-width: 220px;
      --topbar-height: 52px;
    }
    @media (prefers-reduced-motion: reduce) {
      :root { --dur-fast: 0ms; --dur-base: 0ms; }
    }`;
}

/** Brand colors plus the tokens derived from them, for one theme. */
function colorVars(theme: BrandTheme, fb: Fallbacks): string {
  return [brandVars(theme, fb), derivedVars(fb)].join("\n");
}

function brandVars(theme: BrandTheme, fb: Fallbacks): string {
  const radius = theme.radius ?? "0.5rem";
  const radiusSm = theme.radiusSm ?? "0.375rem";
  return `
      --accent: ${theme.accent};
      --accent-contrast: ${theme.accentContrast ?? fb.accentContrast};
      --ring: ${theme.ring ?? theme.accent};
      --surface-base: ${theme.surface.base};
      --surface-card: ${theme.surface.card};
      --surface-muted: ${theme.surface.muted ?? fb.muted};
      --surface-subtle: ${theme.surface.subtle ?? fb.subtle};
      --text-primary: ${theme.text.primary};
      --text-secondary: ${theme.text.secondary};
      --text-muted: ${theme.text.muted ?? theme.text.secondary};
      --border: ${theme.border};
      --border-subtle: ${theme.borderSubtle ?? theme.border};
      --radius: ${radius};
      --radius-sm: ${radiusSm};
      --radius-lg: calc(${radius} + 0.25rem);
      --shadow: ${theme.shadow ?? fb.shadow};
      --shadow-2: ${fb.shadow2};
      --shadow-3: ${fb.shadow3};
      --status-approved: ${theme.status.approved};
      --status-new: ${theme.status.new};
      --status-rejected: ${theme.status.rejected};
      --sidebar-bg: ${theme.sidebarBg ?? fb.sidebar};`;
}

function mix(color: string, pct: string, into: string): string {
  return `color-mix(in srgb, var(${color}) ${pct}, var(${into}))`;
}

/**
 * Tokens computed from the brand colors via `color-mix`. They resolve on
 * the same element as the brand vars, so a customer accent flows through
 * without extra config. The accent only ever tints; it never floods chrome.
 */
function derivedVars(fb: Fallbacks): string {
  return `
      --accent-subtle: ${mix("--accent", "8%", "--surface-card")};
      --accent-wash: ${mix("--accent", "4%", "--surface-base")};
      --accent-border: ${mix("--accent", "30%", "--border")};
      --accent-fg: ${mix("--accent", "88%", "--text-primary")};
      --status-info: var(--accent);
      --status-approved-fg: ${mix("--status-approved", "60%", "--text-primary")};
      --status-new-fg: ${mix("--status-new", "60%", "--text-primary")};
      --status-rejected-fg: ${mix("--status-rejected", "60%", "--text-primary")};
      --status-info-fg: var(--accent-fg);
      --status-approved-bg: ${mix("--status-approved", fb.tint, "--surface-card")};
      --status-new-bg: ${mix("--status-new", fb.tint, "--surface-card")};
      --status-rejected-bg: ${mix("--status-rejected", fb.tint, "--surface-card")};
      --status-info-bg: ${mix("--status-info", fb.tint, "--surface-card")};
      --status-approved-border: ${mix("--status-approved", "32%", "--border")};
      --status-new-border: ${mix("--status-new", "32%", "--border")};
      --status-rejected-border: ${mix("--status-rejected", "32%", "--border")};
      --status-info-border: ${mix("--status-info", "32%", "--border")};`;
}
