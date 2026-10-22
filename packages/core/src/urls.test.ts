import { describe, expect, it } from "vitest";
import { createUrlBuilder, safeImageUrl } from "./urls.ts";

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
  it("keys by import path without a leading ./ and keeps slashes", () => {
    const urls = createUrlBuilder("https://shelf.example.com/");
    expect(urls.component("app", "./src/ui/Button.stories.tsx")).toBe(
      "https://shelf.example.com/projects/app/components/src/ui/Button.stories.tsx",
    );
    expect(urls.component("app", "src/My Card.stories.tsx")).toBe(
      "https://shelf.example.com/projects/app/components/src/My%20Card.stories.tsx",
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
  const values = ["feat/new thing", "release/1.0#rc?x", "100%", "plain"];

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
