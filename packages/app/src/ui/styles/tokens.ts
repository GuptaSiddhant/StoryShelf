import type { BrandTheme } from "../theme.ts";

/** CSS variable tokens derived from the light and dark brand themes. */
export function tokenCss(light: BrandTheme, dark: BrandTheme): string {
  return `${lightTokens(light)}\n${darkTokens(dark)}\n${systemTokens(dark)}`;
}

function lightTokens(light: BrandTheme): string {
  return `
    :root {
      --accent: ${light.accent};
      --accent-contrast: ${light.accentContrast ?? "#fff"};
      --ring: ${light.ring ?? light.accent};
      --surface-base: ${light.surface.base};
      --surface-card: ${light.surface.card};
      --surface-muted: ${light.surface.muted ?? "#f4f4f5"};
      --surface-subtle: ${light.surface.subtle ?? "#fafafa"};
      --text-primary: ${light.text.primary};
      --text-secondary: ${light.text.secondary};
      --text-muted: ${light.text.muted ?? light.text.secondary};
      --border: ${light.border};
      --border-subtle: ${light.borderSubtle ?? light.border};
      --radius: ${light.radius ?? "0.5rem"};
      --radius-sm: ${light.radiusSm ?? "0.375rem"};
      --shadow: ${light.shadow ?? "0 1px 2px rgba(0,0,0,.04)"};
      --status-approved: ${light.status.approved};
      --status-new: ${light.status.new};
      --status-rejected: ${light.status.rejected};
      --topbar-bg: ${light.topbarBg ?? light.accent};
      --sidebar-bg: ${light.sidebarBg ?? "#ffffff"};
      --sidebar-width: 220px;
    }`;
}

function darkTokens(dark: BrandTheme): string {
  return `
    [data-theme="dark"] {
      --accent: ${dark.accent};
      --accent-contrast: ${dark.accentContrast ?? "#09090b"};
      --ring: ${dark.ring ?? dark.accent};
      --surface-base: ${dark.surface.base};
      --surface-card: ${dark.surface.card};
      --surface-muted: ${dark.surface.muted ?? "#27272a"};
      --surface-subtle: ${dark.surface.subtle ?? "#18181b"};
      --text-primary: ${dark.text.primary};
      --text-secondary: ${dark.text.secondary};
      --text-muted: ${dark.text.muted ?? dark.text.secondary};
      --border: ${dark.border};
      --border-subtle: ${dark.borderSubtle ?? dark.border};
      --radius: ${dark.radius ?? "0.5rem"};
      --radius-sm: ${dark.radiusSm ?? "0.375rem"};
      --shadow: ${dark.shadow ?? "0 1px 2px rgba(0,0,0,.3)"};
      --status-approved: ${dark.status.approved};
      --status-new: ${dark.status.new};
      --status-rejected: ${dark.status.rejected};
      --topbar-bg: ${dark.topbarBg ?? "#0f172a"};
      --sidebar-bg: ${dark.sidebarBg ?? "#111113"};
    }`;
}

function systemTokens(dark: BrandTheme): string {
  return `
    @media (prefers-color-scheme: dark) {
      [data-theme="system"] {
        --accent: ${dark.accent};
        --accent-contrast: ${dark.accentContrast ?? "#09090b"};
        --ring: ${dark.ring ?? dark.accent};
        --surface-base: ${dark.surface.base};
        --surface-card: ${dark.surface.card};
        --surface-muted: ${dark.surface.muted ?? "#27272a"};
        --surface-subtle: ${dark.surface.subtle ?? "#18181b"};
        --text-primary: ${dark.text.primary};
        --text-secondary: ${dark.text.secondary};
        --text-muted: ${dark.text.muted ?? dark.text.secondary};
        --border: ${dark.border};
        --border-subtle: ${dark.borderSubtle ?? dark.border};
        --status-approved: ${dark.status.approved};
        --status-new: ${dark.status.new};
        --status-rejected: ${dark.status.rejected};
        --topbar-bg: ${dark.topbarBg ?? "#0f172a"};
        --sidebar-bg: ${dark.sidebarBg ?? "#111113"};
      }
    }`;
}
