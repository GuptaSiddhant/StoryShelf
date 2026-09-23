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
      ".field__input",
      ".card",
      ".sidebar__link--active",
      ".diff-grid",
      ".review-bar",
      ".segmented",
      '[data-theme="dark"]',
    ]) {
      expect(css).toContain(token);
    }
  });

  it("no longer carries button or feedback styles (owned by hono/css)", () => {
    const css = baseStyle(LIGHT_THEME, DARK_THEME);
    expect(css).not.toContain(".btn--primary");
    expect(css).not.toContain(".tabs__link");
    expect(css).not.toContain(".badge--success");
    expect(css).not.toContain(".alert--danger");
    expect(css).not.toContain(".empty__title");
    expect(css).not.toContain(".stat__value");
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
});
