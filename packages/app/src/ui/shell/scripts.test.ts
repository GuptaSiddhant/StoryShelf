import { JSDOM } from "jsdom";
import { Script } from "node:vm";
import { describe, expect, it, vi } from "vitest";
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

  it("drags the wipe handle with pointer capture and zooms with +/- up to 400%", () => {
    const source = clientScript();
    for (const hook of [
      "data-compare-knob",
      "setPointerCapture",
      "pointermove",
      "pointercancel",
      "'fit','100','200','400'",
      "key==='+'||key==='='",
      "key==='-'||key==='_'",
    ]) {
      expect(source).toContain(hook);
    }
  });

  it("builds toasts with textContent, never innerHTML", () => {
    expect(clientScript()).not.toContain("innerHTML");
  });
});

const ok = (base: string) => Promise.resolve({ ok: true, json: () => Promise.resolve({ base }) });
const tick = async () => await new Promise((resolve) => setTimeout(resolve, 0));

describe("signed preview frame", () => {
  const PAGE = `<div data-preview-embed data-preview-path="/iframe.html?id=a" data-preview-refresh-url="/tok" data-preview-refresh-seconds="2400">
    <button data-preview-load>Load</button><div data-preview-idle></div>
    <template data-preview-template><iframe src="/_s/old/iframe.html?id=a"></iframe></template></div>`;
  type Timer = { fn: () => void; ms: number; kind: "interval" | "timeout"; cleared: boolean };

  function boot(fetchImpl: (url: string) => Promise<unknown>) {
    const dom = new JSDOM(`<body>${PAGE}</body>`, { runScripts: "outside-only" });
    const { window } = dom;
    const timers: Timer[] = [];
    const add = (kind: Timer["kind"]) => (fn: () => void, ms: number) => {
      timers.push({ fn, ms, kind, cleared: false });
      return timers.length;
    };
    Object.assign(window, {
      fetch: vi.fn(fetchImpl),
      setInterval: add("interval"),
      setTimeout: add("timeout"),
      clearInterval: (id: number) => {
        const timer = timers[id - 1];
        if (timer) timer.cleared = true;
      },
    });
    Object.assign(window, {
      __storyshelfShell: {
        readCookie: () => null,
        writeCookie: () => {},
        applyTheme: () => {},
        applySidebar: () => {},
      },
    });
    window.eval(clientScript());
    const host = window.document.querySelector("[data-preview-embed]") as HTMLElement;
    const frame = () => host.querySelector("iframe");
    const click = () => window.document.querySelector<HTMLElement>("[data-preview-load]")?.click();
    return { window, host, frame, click, timers };
  }

  it("mounts the frame under a freshly fetched root, not the one rendered with the page", async () => {
    const { frame, click } = boot(() => ok("/_s/new"));
    click();
    await tick();
    expect(frame()?.getAttribute("src")).toBe("/_s/new/iframe.html?id=a");
  });

  it("keeps the rendered root when the fresh one cannot be fetched", async () => {
    const { frame, click } = boot(() => Promise.reject(new Error("offline")));
    click();
    await tick();
    expect(frame()?.getAttribute("src")).toBe("/_s/old/iframe.html?id=a");
  });

  it("stops renewing once its host left the document", async () => {
    const { host, click, timers } = boot(() => ok("/_s/new"));
    click();
    await tick();
    const interval = timers.find((timer) => timer.kind === "interval");
    expect(interval?.ms).toBe(2_400_000);
    host.remove();
    interval?.fn();
    expect(interval?.cleared).toBe(true);
  });

  it("retries a failed renewal a minute later, a bounded number of times", async () => {
    let calls = 0;
    const { click, timers } = boot(() => {
      calls += 1;
      return calls === 1 ? ok("/_s/new") : Promise.reject(new Error("down"));
    });
    click();
    await tick();
    timers.find((timer) => timer.kind === "interval")?.fn();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      // oxlint-disable-next-line no-await-in-loop -- each retry is scheduled by the previous failure
      await tick();
      timers.findLast((timer) => timer.kind === "timeout")?.fn();
    }
    await tick();
    const retries = timers.filter((timer) => timer.kind === "timeout");
    expect(retries.every((timer) => timer.ms === 60_000)).toBe(true);
    expect(retries.length).toBeGreaterThan(0);
    expect(retries.length).toBeLessThanOrEqual(3);
  });
});
