import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { bootScript } from "./boot-script.ts";
import { clientScript } from "./client-script.ts";

function compiles(source: string): boolean {
  // Syntax check only: compiling a vm.Script parses the source without running it.
  return new Script(source) instanceof Script;
}

describe("shell scripts", () => {
  it("are syntactically valid JavaScript", () => {
    expect(compiles(bootScript())).toBe(true);
    expect(compiles(clientScript())).toBe(true);
  });

  it("boot script restores theme and sidebar state before paint", () => {
    const source = bootScript();
    expect(source).toContain("storyshelf_theme");
    expect(source).toContain("storyshelf_sidebar");
    expect(source).toContain("data-sidebar");
  });

  it("client script wires every shell behavior", () => {
    const source = clientScript();
    for (const hook of [
      "data-theme-set",
      "data-sidebar-collapse",
      "data-sidebar-toggle",
      "details[data-dropdown]",
      "data-toast-region",
      "showToast",
      "x-csrf-token",
    ]) {
      expect(source).toContain(hook);
    }
  });

  it("builds toasts with textContent, never innerHTML", () => {
    expect(clientScript()).not.toContain("innerHTML");
  });
});
