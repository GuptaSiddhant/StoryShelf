import { describe, expect, it } from "vitest";
import { baseStyle } from "../styles.ts";
import { DARK_THEME, LIGHT_THEME } from "../theme.ts";

describe("baseStyle", () => {
  it("contains tokens, components, shell, and review sections", () => {
    const css = baseStyle(LIGHT_THEME, DARK_THEME);
    for (const token of [
      "--accent",
      "--ring",
      "--surface-card",
      "--text-primary",
      '[data-theme="dark"]',
    ]) {
      expect(css).toContain(token);
    }
  });

  it("no longer carries component styles (owned by hono/css)", () => {
    const css = baseStyle(LIGHT_THEME, DARK_THEME);
    expect(css).not.toContain(".btn--primary");
    expect(css).not.toContain(".tabs__link");
    expect(css).not.toContain(".badge--success");
    expect(css).not.toContain(".alert--danger");
    expect(css).not.toContain(".empty__title");
    expect(css).not.toContain(".stat__value");
    expect(css).not.toContain(".field__input");
    expect(css).not.toContain(".field__label");
    expect(css).not.toContain(".card--padded");
    expect(css).not.toContain(".page-header__title");
    expect(css).not.toContain(".breadcrumbs ol");
    expect(css).not.toContain(".sidebar__link--active");
    expect(css).not.toContain(".topbar__inner");
    expect(css).not.toContain(".diff-grid");
    expect(css).not.toContain(".review-bar");
    expect(css).not.toContain(".segmented");
    expect(css).not.toContain(".snapshot-card");
    expect(css).not.toContain(".comment__head");
  });

  it("honors custom brand accent overrides", () => {
    const css = baseStyle(
      { ...LIGHT_THEME, accent: "#ff0000" },
      { ...DARK_THEME, accent: "#00ff00" },
    );
    expect(css).toContain("--accent: #ff0000");
    expect(css).toContain("--accent: #00ff00");
  });

  it("falls back for old configs without new optional tokens", () => {
    const css = baseStyle(
      {
        accent: "#111111",
        surface: { base: "#fff", card: "#fff" },
        text: { primary: "#000", secondary: "#333" },
        border: "#eee",
        status: { approved: "green", new: "orange", rejected: "red" },
      },
      {
        accent: "#222222",
        surface: { base: "#000", card: "#111" },
        text: { primary: "#fff", secondary: "#ccc" },
        border: "#333",
        status: { approved: "green", new: "orange", rejected: "red" },
      },
    );
    expect(css).toContain("--surface-muted");
    expect(css).toContain("--ring");
    expect(css).toContain("--radius");
  });

  it("emits theme-independent scales once", () => {
    const css = baseStyle(LIGHT_THEME, DARK_THEME);
    for (const token of ["--text-sm", "--space-4", "--radius-pill", "--font-sans"]) {
      expect(css.split(`${token}:`).length - 1).toBe(1);
    }
  });

  it("derives accent and status tints from the brand colors", () => {
    const css = baseStyle(
      { ...LIGHT_THEME, accent: "#ff0000" },
      { ...DARK_THEME, accent: "#00ff00" },
    );
    for (const token of [
      "--accent-subtle",
      "--accent-wash",
      "--accent-border",
      "--accent-fg",
      "--status-approved-bg",
      "--status-rejected-border",
      "--status-info-bg",
    ]) {
      expect(css).toContain(`${token}: color-mix(`);
    }
    expect(css).not.toContain("#ff0000 8%");
  });

  it("keeps the system dark block in sync with the explicit dark block", () => {
    const css = baseStyle(LIGHT_THEME, DARK_THEME);
    const system = css.slice(css.indexOf('[data-theme="system"]'));
    for (const token of ["--radius:", "--shadow:", "--shadow-2:", "--accent-subtle:"]) {
      expect(system).toContain(token);
    }
  });

  it("keeps default accent text readable (WCAG AA) on cards in both themes", () => {
    for (const theme of [LIGHT_THEME, DARK_THEME]) {
      const fg = mix(theme.accent, 0.88, theme.text.primary);
      expect(contrast(fg, theme.surface.card)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

function channels(hex: string): [number, number, number] {
  const [red, green, blue] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return [red ?? 0, green ?? 0, blue ?? 0];
}

function mix(a: string, share: number, b: string): string {
  const [ca, cb] = [channels(a), channels(b)];
  const out = ca.map((v, i) => Math.round(v * share + (cb[i] ?? 0) * (1 - share)));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function luminance(hex: string): number {
  const [red, green, blue] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((first, second) => second - first) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}
