import { describe, expect, it } from "vite-plus/test";
import { createUrlBuilder, hasDotSegment, safeImageUrl } from "./urls.ts";

describe("safeImageUrl", () => {
  it("allows https and app-relative paths", () => {
    expect(safeImageUrl("https://idp.example.com/avatar.png")).toBe(
      "https://idp.example.com/avatar.png",
    );
    expect(safeImageUrl("/avatars/me.png")).toBe("/avatars/me.png");
  });

  it("rejects javascript, data, http, and malformed URLs", () => {
    expect(safeImageUrl("javascript:alert(1)")).toBeNull();
    expect(safeImageUrl("data:text/html,<h1>x</h1>")).toBeNull();
    expect(safeImageUrl("http://idp.example.com/avatar.png")).toBeNull();
    expect(safeImageUrl("//evil.example.com/x.png")).toBeNull();
    expect(safeImageUrl("not a url")).toBeNull();
    expect(safeImageUrl("")).toBeNull();
  });
});

describe("component url", () => {
  it("selects a tab only when asked", () => {
    const urls = createUrlBuilder("https://shelf.example.com");
    expect(urls.component("app", "./src/Button.stories.tsx", { tab: "design" })).toBe(
      "https://shelf.example.com/projects/app/components/src/Button.stories.tsx?tab=design",
    );
    expect(urls.component("app", "src/Button.stories.tsx")).not.toContain("?");
  });

  it("keys by import path without a leading ./ and keeps slashes", () => {
    const urls = createUrlBuilder("https://shelf.example.com/");
    expect(urls.component("app", "./src/ui/Button.stories.tsx")).toBe(
      "https://shelf.example.com/projects/app/components/src/ui/Button.stories.tsx",
    );
    expect(urls.component("app", "src/My Card.stories.tsx")).toBe(
      "https://shelf.example.com/projects/app/components/src/My%20Card.stories.tsx",
    );
  });

  it("selects one build with ?build=, encoded, and adds nothing without one", () => {
    const urls = createUrlBuilder("https://shelf.example.com/");
    expect(urls.component("app", "src/Button.stories.tsx", { build: "01B/1" })).toBe(
      "https://shelf.example.com/projects/app/components/src/Button.stories.tsx?build=01B%2F1",
    );
    expect(urls.component("app", "src/Button.stories.tsx", {})).toBe(
      "https://shelf.example.com/projects/app/components/src/Button.stories.tsx",
    );
    expect(urls.component("app", "src/Button.stories.tsx", { build: undefined })).toBe(
      "https://shelf.example.com/projects/app/components/src/Button.stories.tsx",
    );
  });
});

describe("component url with a build and a tab", () => {
  it("carries both, build first", () => {
    const urls = createUrlBuilder("https://shelf.example.com");
    expect(urls.component("app", "src/Button.stories.tsx", { build: "01B", tab: "design" })).toBe(
      "https://shelf.example.com/projects/app/components/src/Button.stories.tsx?build=01B&tab=design",
    );
  });
});

describe("snapshot url", () => {
  const urls = createUrlBuilder("https://shelf.example.com/");

  it("opens the build's diff page with the snapshot selected", () => {
    expect(urls.snapshot("app", "B1", "S1")).toBe(
      "https://shelf.example.com/projects/app/builds/B1/diff?snapshot=S1",
    );
  });

  it("round-trips an id that needs escaping", () => {
    const url = new URL(urls.snapshot("app", "B1", "a b&c=d#e"));
    expect(url.pathname).toBe("/projects/app/builds/B1/diff");
    expect(url.searchParams.get("snapshot")).toBe("a b&c=d#e");
    expect(url.hash).toBe("");
  });
});

describe("label and branch encoding", () => {
  const urls = createUrlBuilder("https://shelf.example.com");
  const values = [
    "feat/new thing",
    "release/1.0#rc?x",
    "100%",
    "plain",
    "ünï/日本",
    "a%2Fb",
    "a&b=c;d",
    "quote\"s/and'apos",
  ];

  it.each(values)("round-trips the label value %s through the path", (value) => {
    for (const url of [
      urls.label("app", "branch", value),
      urls.storybookLabel("app", "branch", value),
    ]) {
      const parsed = new URL(url);
      expect(parsed.search).toBe("");
      expect(parsed.hash).toBe("");
      const tail = parsed.pathname.split("/branch/")[1] ?? "";
      expect(
        tail
          .split("/")
          .map((part) => decodeURIComponent(part))
          .join("/"),
      ).toBe(value);
    }
  });
});

describe("component, label key and snapshot encoding", () => {
  const urls = createUrlBuilder("https://shelf.example.com/shelf/");
  const paths = ["src/Button copy.stories.tsx", "src/100%/a#b?.tsx", "src/ünï/日本.tsx", "a%2Fb/c"];

  it.each(paths)("round-trips the import path %s through the component page", (importPath) => {
    const parsed = new URL(urls.component("app", importPath));
    expect(parsed.search).toBe("");
    expect(parsed.hash).toBe("");
    const tail = parsed.pathname.split("/components/")[1] ?? "";
    expect(tail.split("/").map((part) => decodeURIComponent(part))).toEqual(importPath.split("/"));
  });

  it("drops only a leading ./ from an import path, and keeps the path prefix of the origin", () => {
    expect(urls.component("app", "./src/A.tsx")).toBe(
      "https://shelf.example.com/shelf/projects/app/components/src/A.tsx",
    );
    expect(urls.component("app", "src/A.tsx")).toBe(urls.component("app", "./././src/A.tsx"));
  });

  it("encodes a label key as one segment, so a slash in it cannot add one", () => {
    const parsed = new URL(urls.label("app", "team/area", "x"));
    expect(parsed.pathname).toBe("/shelf/projects/app/labels/team%2Farea/x");
    expect(new URL(urls.storybookLabel("app", "a#b", "x")).hash).toBe("");
  });

  it("encodes a double encoding once: %2F stays %252F, never a path separator", () => {
    expect(urls.label("app", "k", "a%2Fb")).toBe(
      "https://shelf.example.com/shelf/projects/app/labels/k/a%252Fb",
    );
  });

  it.each(["a b&c=d#e", "100%", "ünï/日本", "x?y=1"])("reads snapshot id %s back", (id) => {
    const parsed = new URL(urls.snapshot("app", "B1", id));
    expect(parsed.searchParams.get("snapshot")).toBe(id);
    expect([...parsed.searchParams.keys()]).toEqual(["snapshot"]);
  });
});

describe("design coverage url", () => {
  it("sits under the project's design path, with the base and a trailing slash trimmed", () => {
    expect(createUrlBuilder("https://shelf.example.com/").designCoverage("app")).toBe(
      "https://shelf.example.com/projects/app/design/coverage",
    );
    expect(createUrlBuilder("").designCoverage("app")).toBe("/projects/app/design/coverage");
  });
});

describe("dot segments", () => {
  const urls = createUrlBuilder("https://shelf.example.com");

  it("keeps the path form for every value without a dot segment", () => {
    expect(urls.component("app", "src/a.b/Button.stories.tsx")).toBe(
      "https://shelf.example.com/projects/app/components/src/a.b/Button.stories.tsx",
    );
    expect(urls.component("app", "./Button.stories.tsx")).toBe(
      "https://shelf.example.com/projects/app/components/Button.stories.tsx",
    );
    expect(urls.label("app", "release", "v1.0")).toBe(
      "https://shelf.example.com/projects/app/labels/release/v1.0",
    );
    expect(urls.label("app", "branch", "feat/..x")).toBe(
      "https://shelf.example.com/projects/app/labels/branch/feat/..x",
    );
  });

  it.each([
    ["../ui/Button.stories.tsx"],
    ["src/../ui/Button.stories.tsx"],
    ["src/./Button.stories.tsx"],
  ])("moves a component path with a dot segment (%s) to the query form", (path) => {
    const url = new URL(urls.component("app", path, { tab: "design" }));
    expect(url.pathname).toBe("/projects/app/components/");
    expect(url.searchParams.get("path")).toBe(path);
    expect(url.searchParams.get("tab")).toBe("design");
  });

  it.each([[".."], ["."], ["a/../b"], ["a/./b"]])(
    "moves the label value %s to the query form",
    (value) => {
      const url = new URL(urls.label("app", "branch", value));
      expect(url.pathname).toBe("/projects/app/labels/branch/");
      expect(url.searchParams.get("value")).toBe(value);
    },
  );

  it("treats a literal %2E%2E as an ordinary value that keeps its path form", () => {
    const url = new URL(urls.label("app", "x", "%2E%2E"));
    expect(url.search).toBe("");
    expect(decodeURIComponent(url.pathname.split("/x/")[1] ?? "")).toBe("%2E%2E");
  });

  it("names the rule", () => {
    expect(hasDotSegment("..")).toBe(true);
    expect(hasDotSegment("a/./b")).toBe(true);
    expect(hasDotSegment("a/b.")).toBe(false);
    expect(hasDotSegment("...")).toBe(false);
  });
});
