import { SETTING_ALIASES } from "@storyshelf/core/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLI_SETTING_ALIASES,
  overrideSetting,
  readSetting,
  resetSettingWarnings,
} from "./settings.ts";

let stderr: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetSettingWarnings();
  stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
});

afterEach(() => {
  stderr.mockRestore();
});

function printed(): string {
  return stderr.mock.calls.map((call: unknown[]) => String(call[0])).join("");
}

describe("CLI readSetting", () => {
  it("keeps the same rows as core's alias table", () => {
    for (const [name, olds] of Object.entries(CLI_SETTING_ALIASES)) {
      expect(SETTING_ALIASES[name as keyof typeof SETTING_ALIASES]).toEqual(olds);
    }
  });

  it("reads the new name alone, silently", () => {
    expect(readSetting({ SHELF_TOKEN: "t" }, "SHELF_TOKEN")).toBe("t");
    expect(printed()).toBe("");
  });

  it("reads an old name alone and warns once per name, never printing the value", () => {
    const env = { STORYSHELF_TOKEN: "secret-token-value" };
    expect(readSetting(env, "SHELF_TOKEN")).toBe("secret-token-value");
    expect(readSetting(env, "SHELF_TOKEN")).toBe("secret-token-value");
    expect(printed()).toBe(
      "storyshelf: STORYSHELF_TOKEN is renamed SHELF_TOKEN; the old name still works, set the new one\n",
    );
    expect(printed()).not.toContain("secret-token-value");
  });

  it("accepts the old and new names with one value", () => {
    expect(readSetting({ SHELF_URL: "u", STORYSHELF_URL: "u" }, "SHELF_URL")).toBe("u");
  });

  it("refuses the old and new names with different values, naming both", () => {
    expect(() =>
      readSetting({ SHELF_ADMIN_TOKEN: "a", ADMIN_TOKEN: "b" }, "SHELF_ADMIN_TOKEN"),
    ).toThrow(
      "SHELF_ADMIN_TOKEN and ADMIN_TOKEN are both set, to different values: set only SHELF_ADMIN_TOKEN and unset ADMIN_TOKEN",
    );
  });

  it("treats an empty value as unset", () => {
    expect(readSetting({ SHELF_SLUG: "", STORYSHELF_SLUG: "s" }, "SHELF_SLUG")).toBe("s");
    expect(readSetting({}, "SHELF_SLUG")).toBeUndefined();
  });
});

describe("overrideSetting", () => {
  it("sets the new name and drops the old ones, so a child never sees two values", () => {
    const env: Record<string, string | undefined> = { STORYSHELF_URL: "old", HOME: "/h" };
    overrideSetting(env, "SHELF_URL", "new");
    expect(env).toEqual({ SHELF_URL: "new", HOME: "/h" });
    expect(readSetting(env, "SHELF_URL")).toBe("new");
  });
});
