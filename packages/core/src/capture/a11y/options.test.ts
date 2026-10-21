import { describe, expect, it } from "vitest";
import { A11Y_ROOT_SELECTOR, resolveA11yRun } from "./options.ts";

describe("resolveA11yRun", () => {
  it("defaults to the story root with WCAG tags", () => {
    const plan = resolveA11yRun(null);
    expect(plan.skip).toBeUndefined();
    expect(plan.context).toBe(A11Y_ROOT_SELECTOR);
    expect(plan.config).toEqual({});
    expect(plan.options["runOnly"]).toMatchObject({ type: "tag" });
  });

  it("skips disabled stories and test: off", () => {
    expect(resolveA11yRun({ disable: true }).skip).toContain("disable");
    expect(resolveA11yRun({ test: "off" }).skip).toContain("off");
  });

  it.each(["todo", "error"])("keeps running for test: %s (annotation only)", (test) => {
    expect(resolveA11yRun({ test }).skip).toBeUndefined();
  });

  it("applies config, options, and element/context", () => {
    const plan = resolveA11yRun({
      config: { rules: [{ id: "image-alt", enabled: false }] },
      options: { runOnly: ["image-alt"], rules: { "color-contrast": { enabled: false } } },
      element: "#other",
    });
    expect(plan.config).toEqual({ rules: [{ id: "image-alt", enabled: false }] });
    expect(plan.options["runOnly"]).toEqual(["image-alt"]);
    expect(plan.options["rules"]).toEqual({
      "image-alt": { enabled: false },
      "color-contrast": { enabled: false },
    });
    expect(plan.context).toBe("#other");
    expect(resolveA11yRun({ context: { include: ["main"] } }).context).toEqual({
      include: ["main"],
    });
  });

  it("ignores malformed values", () => {
    const plan = resolveA11yRun({ config: [], options: "x", disable: "yes" });
    expect(plan.skip).toBeUndefined();
    expect(plan.config).toEqual({});
    expect(resolveA11yRun("junk").context).toBe(A11Y_ROOT_SELECTOR);
  });
});
