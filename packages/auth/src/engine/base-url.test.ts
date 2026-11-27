import { describe, expect, it } from "vitest";
import { assertBaseUrl, BASE_URL_MESSAGE } from "./base-url.ts";

describe("assertBaseUrl", () => {
  it.each([
    "localhost:3000/",
    "localhost:3000",
    "127.0.0.1:3000",
    "ftp://example.com",
    "",
    "http//x",
  ])("refuses %j with one line naming SHELF_PUBLIC_BASE_URL and an example", (value) => {
    expect(() => {
      assertBaseUrl(value);
    }).toThrow(BASE_URL_MESSAGE);
  });

  it.each([undefined, null, 42])("refuses a missing base URL (%s)", (value) => {
    expect(() => {
      assertBaseUrl(value);
    }).toThrow(/SHELF_PUBLIC_BASE_URL .*http:\/\/localhost:3000/u);
  });

  it("names the variable on one line without echoing the value", () => {
    expect(BASE_URL_MESSAGE).not.toContain("\n");
    expect(() => {
      assertBaseUrl("storyshelf.internal:8443/");
    }).toThrow(expect.objectContaining({ message: expect.not.stringContaining("internal") }));
  });

  it.each(["http://localhost:3000", "https://shelf.example.com/", "http://127.0.0.1:3000/base"])(
    "accepts %j",
    (value) => {
      expect(() => {
        assertBaseUrl(value);
      }).not.toThrow();
    },
  );
});
