import { RENAMED_SETTINGS } from "@storyshelf/core/config";
import { describe, expect, it } from "vitest";
import {
  CLI_RENAMED_SETTINGS,
  readSetting,
  refuseRenamedCliSettings,
  renamedCliSettingsIn,
} from "./settings.ts";

const TOKEN_VALUE = "t".repeat(40);

describe("CLI settings", () => {
  it("keeps the same rows as core's renamed table", () => {
    for (const [name, olds] of Object.entries(CLI_RENAMED_SETTINGS)) {
      expect(RENAMED_SETTINGS[name as keyof typeof RENAMED_SETTINGS]).toEqual(olds);
    }
  });

  it("reads the new name and never an old one", () => {
    expect(readSetting({ SHELF_TOKEN: TOKEN_VALUE }, "SHELF_TOKEN")).toBe(TOKEN_VALUE);
    expect(readSetting({ STORYSHELF_TOKEN: TOKEN_VALUE }, "SHELF_TOKEN")).toBeUndefined();
  });
});

describe("refuseRenamedCliSettings", () => {
  it("passes the new names", () => {
    expect(() =>
      refuseRenamedCliSettings({ SHELF_URL: "u", SHELF_TOKEN: TOKEN_VALUE }),
    ).not.toThrow();
  });

  it("lists every old name with its new name, never a value", () => {
    const env = { STORYSHELF_TOKEN: TOKEN_VALUE, STORYSHELF_HOST: "h", SHELF_TOKEN: TOKEN_VALUE };
    expect(renamedCliSettingsIn(env)).toEqual([
      "STORYSHELF_HOST -> SHELF_URL",
      "STORYSHELF_TOKEN -> SHELF_TOKEN",
    ]);
    expect(() => refuseRenamedCliSettings(env)).toThrow(
      "StoryShelf's environment variables were renamed and the old names are no longer read. Rename these, then run again:\n  STORYSHELF_HOST -> SHELF_URL\n  STORYSHELF_TOKEN -> SHELF_TOKEN",
    );
    let message = "";
    try {
      refuseRenamedCliSettings(env);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain(TOKEN_VALUE);
  });

  it("ignores an empty old name", () => {
    expect(renamedCliSettingsIn({ STORYSHELF_TOKEN: "" })).toEqual([]);
  });
});
