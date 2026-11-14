import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MASK_MARKER,
  inPageDocumentRecorder,
  inPageFontsReady,
  inPageSwitch,
  inPageTidy,
  installDocumentRecorder,
} from "./switch-page.ts";

/** Rebuild a function from its source in a scope with no module bindings, as `page.evaluate` does. */
function asSerialized<T extends (...args: never[]) => unknown>(fn: T): T {
  // oxlint-disable-next-line typescript/no-implied-eval, eslint/no-new-func -- the point is to rebuild the function from source
  return new Function(`return (${fn.toString()})`)() as T;
}

/** Just enough of a DOM element for the in-page functions. */
class FakeElement {
  readonly tagName: string;
  id = "";
  textContent = "";
  readonly children: FakeElement[] = [];
  parent: FakeElement | undefined;
  private readonly attrs = new Map<string, string>();

  constructor(tagName: string, attrs: Record<string, string> = {}) {
    this.tagName = tagName.toUpperCase();
    for (const [name, value] of Object.entries(attrs)) this.setAttribute(name, value);
  }

  get attributes(): { name: string; value: string }[] {
    return [...this.attrs].map(([name, value]) => ({ name, value }));
  }

  get classList(): string[] {
    return (this.attrs.get("class") ?? "").split(/\s+/u).filter((name) => name !== "");
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
    if (name === "id") this.id = value;
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }

  append(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    const siblings = this.parent?.children ?? [];
    siblings.splice(siblings.indexOf(this), 1);
  }
}

const scope = globalThis as unknown as Record<string, unknown>;

/** A served Storybook iframe: a static style, the root, a script; then DOMContentLoaded. */
function servedDocument() {
  const listeners: (() => void)[] = [];
  const html = new FakeElement("html", { lang: "en" });
  const head = html.append(new FakeElement("head"));
  const body = html.append(new FakeElement("body", { class: "sb-show-main" }));
  head.append(new FakeElement("style")).textContent = ".sb-show-main{}";
  body.append(new FakeElement("div", { id: "storybook-root" }));
  body.append(new FakeElement("div", { class: "sb-preparing-story" }));
  body.append(new FakeElement("script"));
  const fonts = { size: 0 };
  const doc = {
    documentElement: html,
    head,
    body,
    fonts,
    activeElement: { blur: vi.fn() },
    addEventListener: (event: string, listener: () => void) => {
      if (event === "DOMContentLoaded") listeners.push(listener);
    },
    querySelectorAll: (selector: string) =>
      selector === "style"
        ? [...head.children, ...body.children].filter((element) => element.tagName === "STYLE")
        : [],
  };
  scope["document"] = doc;
  scope["scrollTo"] = vi.fn();
  scope["getSelection"] = () => ({ removeAllRanges: vi.fn() });
  return {
    doc,
    html,
    head,
    body,
    fonts,
    loaded: () => {
      for (const listener of listeners) listener();
    },
  };
}

afterEach(() => {
  for (const key of [
    "__STORYSHELF_DOCUMENT__",
    "__STORYSHELF_SETTLE__",
    "__STORYBOOK_ADDONS_CHANNEL__",
    "__STORYBOOK_PREVIEW__",
    "document",
    "scrollTo",
    "getSelection",
  ]) {
    Reflect.deleteProperty(scope, key);
  }
});

describe("the document recorder and the tidy (as serialized into the page)", () => {
  const record = asSerialized(inPageDocumentRecorder);
  const tidy = asSerialized(inPageTidy);

  it("finds nothing to report on a document a story left as served", () => {
    const page = servedDocument();
    record();
    page.loaded();
    // Storybook's own classes and the runner's mask style do not count.
    page.body.setAttribute("class", "sb-show-main sb-main-centered");
    page.head.append(new FakeElement("style")).textContent = `${MASK_MARKER}\n[x]{}`;
    expect(tidy()).toBeNull();
    expect(page.head.children.some((element) => element.textContent.startsWith(MASK_MARKER))).toBe(
      false,
    );
    expect(page.body.getAttribute("class")).toBe("sb-show-main sb-main-centered");
    expect(page.doc.activeElement.blur).toHaveBeenCalled();
  });

  it("is unrecorded until DOMContentLoaded, and records once per document", () => {
    servedDocument();
    record();
    expect(tidy()).toBe("unrecorded");
    const first = scope["__STORYSHELF_DOCUMENT__"];
    record();
    expect(scope["__STORYSHELF_DOCUMENT__"]).toBe(first);
  });

  it("puts html and body attributes back as served: a decorator sets its own again", () => {
    const page = servedDocument();
    record();
    page.loaded();
    page.body.setAttribute("class", "sb-show-main leak-tint");
    page.body.setAttribute("style", "font-family: LeakLate");
    page.html.setAttribute("dir", "rtl");
    page.html.removeAttribute("lang");
    expect(tidy()).toBeNull();
    expect(page.body.getAttribute("class")).toBe("sb-show-main");
    expect(page.body.getAttribute("style")).toBeNull();
    expect(page.html.attributes).toEqual([{ name: "lang", value: "en" }]);
  });

  it("reports a node left in body, a style sheet left in head, and a font left loaded", () => {
    const page = servedDocument();
    record();
    page.loaded();
    const portal = page.body.append(new FakeElement("div", { id: "leak-portal" }));
    expect(tidy()).toBe("body");
    portal.remove();
    // Preload hints fetch and do not style, so a lazily imported story file is no drift.
    page.head.append(new FakeElement("link", { rel: "modulepreload" }));
    expect(tidy()).toBeNull();
    const style = page.head.append(new FakeElement("style", { id: "leak-style" }));
    expect(tidy()).toBe("head");
    style.remove();
    page.fonts.size = 1;
    expect(tidy()).toBe("fonts");
  });
});

describe("inPageSwitch (as serialized into the page)", () => {
  const switchTo = asSerialized(inPageSwitch);

  it("points the settle recorder at the story and asks Storybook to render it", () => {
    const emit = vi.fn();
    scope["__STORYBOOK_ADDONS_CHANNEL__"] = { emit };
    const state = {
      settled: true,
      finished: true,
      phase: "completed",
      unhandled: ["x"],
      expect: null,
      renderError: "old",
      playError: "old",
    };
    scope["__STORYSHELF_SETTLE__"] = state;
    expect(switchTo("a--b")).toBe(true);
    expect(state).toEqual({
      settled: false,
      finished: false,
      phase: null,
      unhandled: [],
      expect: "a--b",
    });
    expect(emit).toHaveBeenCalledWith("setCurrentStory", { storyId: "a--b", viewMode: "story" });
  });

  it("refuses without a recorder or a channel", () => {
    expect(switchTo("a--b")).toBe(false);
    scope["__STORYSHELF_SETTLE__"] = { unhandled: [] };
    scope["__STORYBOOK_PREVIEW__"] = { channel: {} };
    expect(switchTo("a--b")).toBe(false);
  });
});

describe("inPageFontsReady", () => {
  it("resolves when the fonts are ready, or when the bound passes", async () => {
    scope["document"] = { fonts: { ready: Promise.resolve() } };
    await expect(asSerialized(inPageFontsReady)(1000)).resolves.toBeUndefined();
    scope["document"] = { fonts: { ready: new Promise(() => {}) } };
    await expect(asSerialized(inPageFontsReady)(5)).resolves.toBeUndefined();
  });
});

describe("installDocumentRecorder", () => {
  it("registers the recorder to run before the page's scripts", async () => {
    const hook = vi.fn(async () => {});
    await installDocumentRecorder({
      addInitScript: hook,
      evaluateOnNewDocument: hook,
    } as never);
    expect(hook).toHaveBeenCalledWith(inPageDocumentRecorder);
  });
});
