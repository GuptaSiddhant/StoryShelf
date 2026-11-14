import { describe, expect, it } from "vitest";
import { buildLocationOf, isOpaqueOrigin, reviewUrlOf } from "./location.ts";

describe("buildLocationOf", () => {
  it.each(["/projects/gate/storybook/build/b1/", "/projects/gate/storybook/build/b1/index.html"])(
    "reads the project and build from %s",
    (path) => {
      expect(buildLocationOf(path)).toEqual({ slug: "gate", buildId: "b1" });
    },
  );

  it("reads a pathname with no trailing slash", () => {
    expect(buildLocationOf("/projects/gate/storybook/build/b1")).toEqual({
      slug: "gate",
      buildId: "b1",
    });
  });

  it.each([
    "/",
    "/iframe.html",
    "/projects/gate/storybook",
    "/projects/gate/storybook/main/",
    "/_/abc123/",
    "/_s/token/",
    "/projects/gate/storybook/build/",
    "/x/projects/gate/storybook/build/b1/",
    "/projects/a%2Fb/storybook/build/b1/",
  ])("stays inert on %s", (path) => {
    expect(buildLocationOf(path)).toBeNull();
  });
});

describe("isOpaqueOrigin", () => {
  it("is true only for the sandbox origin", () => {
    expect(isOpaqueOrigin("null")).toBe(true);
    expect(isOpaqueOrigin("https://shelf.example")).toBe(false);
  });
});

describe("reviewUrlOf", () => {
  const origin = "https://shelf.example";

  it("resolves a relative path against the page's origin", () => {
    expect(reviewUrlOf("/projects/gate/builds/b1/diff?x=1", origin)).toBe(
      "https://shelf.example/projects/gate/builds/b1/diff?x=1",
    );
  });

  it.each(["https://evil.example/x", "//evil.example/x", "projects/gate", "javascript:alert(1)"])(
    "refuses %s",
    (path) => {
      expect(reviewUrlOf(path, origin)).toBeNull();
    },
  );
});
