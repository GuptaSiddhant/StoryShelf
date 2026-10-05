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
      "x-csrf-token",
    ]) {
      expect(source).toContain(hook);
    }
  });

  it("is idempotent: re-execution after a body swap only re-runs inits", () => {
    const source = clientScript();
    expect(source).toContain("if(window.__ssInit){ window.__ssInit(); return; }");
    // Document-level listeners must live in the once-only closure, not in inits.
    expect(source.match(/window\.__ssInit=/gu)?.length).toBe(1);
  });

  it("queues toasts across navigations and reports failed requests", () => {
    const source = clientScript();
    for (const hook of [
      "data-toast",
      "sessionStorage",
      "htmx:beforeRequest",
      "htmx:responseError",
    ]) {
      expect(source).toContain(hook);
    }
  });

  it("review shortcuts ignore modified keys and text inputs", () => {
    const source = clientScript();
    expect(source).toContain("e.metaKey||e.ctrlKey||e.altKey||typing(e.target)");
    for (const hook of [
      "[data-snap-next]",
      "[data-snap-prev]",
      "[data-approve]",
      "[data-reject]",
    ]) {
      expect(source).toContain(hook);
    }
  });

  it("adopts the response stylesheet on body swaps and swaps validation errors", () => {
    const source = clientScript();
    expect(source).toContain("storyshelf-css");
    // Escapes must survive the template literal: the emitted regex is /([\s\S]*?)<\/style>/.
    expect(source).toContain(String.raw`([\s\S]*?)<\/style>/`);
    expect(source).toContain("e.detail.shouldSwap=true");
    expect(source).toContain("status===400||status===409||status===422");
  });

  it("builds toasts with textContent, never innerHTML", () => {
    expect(clientScript()).not.toContain("innerHTML");
  });
});
