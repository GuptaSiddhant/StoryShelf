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
