import { describe, expect, it } from "vitest";
import { normalizeBaseUrl } from "./client.ts";

describe("normalizeBaseUrl", () => {
  it("strips trailing slashes", () => {
    expect(normalizeBaseUrl("https://shelf.example.com")).toBe("https://shelf.example.com");
    expect(normalizeBaseUrl("https://shelf.example.com/")).toBe("https://shelf.example.com");
    expect(normalizeBaseUrl("https://shelf.example.com///")).toBe("https://shelf.example.com");
  });
});
