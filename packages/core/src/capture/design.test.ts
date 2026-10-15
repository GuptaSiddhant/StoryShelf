import { describe, expect, it, vi } from "vitest";
import { extractDesignUrl as extract, logInvalidDesigns } from "./design.ts";

/** Accepts https://www.figma.com/design/… style links only. */
const parse = (raw: string): { url: string } | null =>
  /^https:\/\/www\.figma\.com\/design\/\w+/u.test(raw.trim()) ? { url: raw.trim() } : null;
const extractDesignUrl = (params?: Parameters<typeof extract>[0]): ReturnType<typeof extract> =>
  extract(params, parse);

const FILE = "https://www.figma.com/design/AbC123/Kit?node-id=1-2";

describe("extractDesignUrl", () => {
  it("returns nothing when no design is declared", () => {
    expect(extractDesignUrl()).toEqual({});
    expect(extractDesignUrl({})).toEqual({});
  });

  it("accepts every design addon shape, first URL winning", () => {
    expect(extractDesignUrl({ design: FILE }).url).toBe(FILE);
    expect(extractDesignUrl({ design: { url: FILE } }).url).toBe(FILE);
    expect(extractDesignUrl({ design: { type: "figma", url: FILE } }).url).toBe(FILE);
    const other = "https://www.figma.com/design/Other/X";
    expect(extractDesignUrl({ design: [{ type: "figma", url: FILE }, { url: other }] }).url).toBe(
      FILE,
    );
    expect(extractDesignUrl({ design: [{ nope: 1 }, { url: other }] }).url).toBe(other);
  });

  it("lets storyshelf.figma win over design", () => {
    const explicit = "https://www.figma.com/design/Win/X";
    expect(extractDesignUrl({ design: FILE, storyshelf: { figma: explicit } }).url).toBe(explicit);
  });

  it("reports non-Figma or malformed values as invalid", () => {
    expect(extractDesignUrl({ design: "https://example.com/x" })).toEqual({
      invalid: "https://example.com/x",
    });
    expect(extractDesignUrl({ storyshelf: { figma: "nope" } })).toEqual({ invalid: "nope" });
  });

  it("treats blank values as not declared", () => {
    expect(extractDesignUrl({ design: "  " })).toEqual({});
    expect(extractDesignUrl({ storyshelf: { figma: "" } })).toEqual({});
  });

  it("ignores non-string, non-url shapes", () => {
    expect(extractDesignUrl({ design: 5 })).toEqual({});
    expect(extractDesignUrl({ design: [] })).toEqual({});
    expect(extractDesignUrl({ storyshelf: { figma: 5 }, design: FILE }).url).toBe(FILE);
  });
});

describe("logInvalidDesigns", () => {
  it("warns once per story with an invalid value", () => {
    const warn = vi.fn();
    logInvalidDesigns({ warn }, [{ id: "a", designInvalid: "x" }, { id: "b" }]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toEqual({ storyId: "a", design: "x" });
    logInvalidDesigns(undefined, [{ id: "a", designInvalid: "x" }]);
  });
});
