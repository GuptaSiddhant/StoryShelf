import { describe, expect, it } from "vitest";
import { fakeUrl, makeFakeDesign } from "../test-helpers/fake-design.ts";
import { InvalidDesignUrlError, parseDesignUrl } from "./design.ts";

describe("parseDesignUrl", () => {
  const first = makeFakeDesign("first").provider;
  const second = makeFakeDesign("second");
  second.provider.parseUrl = (raw) =>
    raw.startsWith("https://other.test/") ? { fileKey: "O", nodeId: null, url: raw } : null;

  it("returns the first provider that accepts the link", () => {
    expect(parseDesignUrl([first, second.provider], fakeUrl("AAA", "1:2"))).toMatchObject({
      provider: { metadata: { kind: "first" } },
      ref: { fileKey: "AAA", nodeId: "1:2" },
    });
    expect(parseDesignUrl([first, second.provider], "https://other.test/x")).toMatchObject({
      provider: { metadata: { kind: "second" } },
    });
  });

  it("returns null when no provider accepts it, or none are configured", () => {
    expect(parseDesignUrl([first], "https://nope.example/x")).toBeNull();
    expect(parseDesignUrl([], fakeUrl("AAA"))).toBeNull();
  });
});

describe("InvalidDesignUrlError", () => {
  it("names the accepted link shape, or the missing provider", () => {
    expect(new InvalidDesignUrlError("x", "https://a.test/<file>").message).toContain(
      "https://a.test/<file>",
    );
    expect(new InvalidDesignUrlError("x").message).toContain("No design provider is configured");
    expect(new InvalidDesignUrlError("x").value).toBe("x");
  });
});
