import { Hono } from "hono";
import { JSDOM, type DOMWindow } from "jsdom";
import { describe, expect, it } from "vitest";
import type { DesignSource } from "../../pages/build-diff-model.ts";
import { ComparisonSources } from "../../pages/build-diff-reference.tsx";
import { CompareStage } from "../components.tsx";
import { clientScript } from "./client-script.ts";

/**
 * The comparison-source switch and the Design stage, driven by the real shell script on the real
 * rendered markup (`ComparisonSources`), so the markup and the script cannot drift apart.
 */
const figma: DesignSource = {
  value: "design",
  label: "Design",
  src: "/design.png",
  name: "Button",
  providerName: "Figma",
};

async function renderPage(): Promise<string> {
  const app = new Hono().get("/", (c): Response | Promise<Response> =>
    c.html(
      <ComparisonSources
        baseline={
          <CompareStage
            baselineSrc="/b.png"
            currentSrc="/c.png"
            diffSrc="/d.png"
            subject="Button / Primary"
          />
        }
        sources={[figma]}
        currentSrc="/c.png"
        subject="Button / Primary"
      />,
    ),
  );
  return await (await app.request("/")).text();
}

/** The page in a browser-like document, with the shell script running on it. */
async function pageWindow(preset: Record<string, string>): Promise<DOMWindow> {
  const html = await renderPage();
  const { window } = new JSDOM(`<body>${html}</body>`, {
    runScripts: "outside-only",
    url: "http://localhost/",
  });
  for (const [key, value] of Object.entries(preset)) window.localStorage.setItem(key, value);
  Object.assign(window, {
    __storyshelfShell: {
      readCookie: () => null,
      writeCookie: () => {},
      applyTheme: () => {},
      applySidebar: () => {},
    },
  });
  window.eval(clientScript());
  return window;
}

/** What a reviewer does on the page, and what they see. */
interface Reviewer {
  /** The mode a source's stage is in. */
  view: (source: string) => string | undefined;
  /** The zoom a source's stage is at. */
  zoom: (source: string) => string | undefined;
  hidden: (source: string) => boolean;
  pressed: (value: string) => string | null | undefined;
  /** Click a button inside the source switch, or inside one source's stage. */
  chooseSource: (value: string) => void;
  chooseMode: (source: string, value: string) => void;
  key: (value: string) => void;
}

function reviewer(window: DOMWindow): Reviewer {
  const doc = window.document;
  const pane = (source: string): HTMLElement | null =>
    doc.querySelector<HTMLElement>(`[data-compare-source="${source}"]`);
  const stage = (source: string): HTMLElement | null | undefined =>
    pane(source)?.querySelector<HTMLElement>("[data-compare]");
  const click = (selector: string): void => {
    doc.querySelector<HTMLElement>(selector)?.click();
  };
  return {
    view: (source) => stage(source)?.dataset["view"],
    zoom: (source) => stage(source)?.dataset["zoom"],
    hidden: (source) => pane(source)?.hasAttribute("hidden") ?? false,
    pressed: (value) =>
      doc
        .querySelector(`[data-compare-source-switch] [data-view-value="${value}"]`)
        ?.getAttribute("aria-pressed"),
    chooseSource: (value) => {
      click(`[data-compare-source-switch] [data-view-value="${value}"]`);
    },
    chooseMode: (source, value) => {
      click(`[data-compare-source="${source}"] [data-compare-mode] [data-view-value="${value}"]`);
    },
    key: (value) => {
      doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: value, bubbles: true }));
    },
  };
}

async function boot(preset: Record<string, string> = {}): Promise<Reviewer> {
  return reviewer(await pageWindow(preset));
}

describe("comparison sources in a browser", () => {
  it("shows the baseline first and swaps to the Design stage and back", async () => {
    const page = await boot();
    expect([page.hidden("baseline"), page.hidden("design")]).toEqual([false, true]);
    page.chooseSource("design");
    expect([page.hidden("baseline"), page.hidden("design")]).toEqual([true, false]);
    expect([page.pressed("design"), page.pressed("baseline")]).toEqual(["true", "false"]);
    page.chooseSource("baseline");
    expect([page.hidden("baseline"), page.hidden("design")]).toEqual([false, true]);
  });

  it("changes the Design stage's mode with the same tools", async () => {
    const page = await boot();
    page.chooseSource("design");
    page.chooseMode("design", "onion");
    expect([page.view("design"), page.view("baseline")]).toEqual(["onion", "split"]);
  });

  it("sends keyboard shortcuts to the visible stage", async () => {
    const page = await boot();
    page.key("3");
    expect([page.view("baseline"), page.view("design")]).toEqual(["onion", "split"]);
    page.chooseSource("design");
    page.key("2");
    expect([page.view("baseline"), page.view("design")]).toEqual(["onion", "swipe"]);
  });

  it("ignores shortcut modes the Design stage does not offer", async () => {
    const page = await boot();
    page.chooseSource("design");
    page.key("2");
    for (const key of ["4", "5", "t"]) page.key(key);
    expect(page.view("design")).toBe("swipe");
  });

  it("keeps the render fitted: a remembered 200% zoom does not apply to it", async () => {
    const page = await boot({ ss_compare_zoom: "200" });
    expect([page.zoom("baseline"), page.zoom("design")]).toEqual(["200", "fit"]);
    page.chooseSource("design");
    page.key("+");
    expect(page.zoom("design")).toBe("fit");
  });

  it("ignores a remembered diff mode on the Design stage", async () => {
    const page = await boot({ ss_compare_mode: "diff" });
    expect([page.view("baseline"), page.view("design")]).toEqual(["diff", "split"]);
  });
});
