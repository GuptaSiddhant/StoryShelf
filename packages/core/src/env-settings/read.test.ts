import { describe, expect, it } from "vitest";
import {
  OLD_NAMES_ALLOWED_MESSAGE,
  oldNamesAllowedFields,
  readS3Bucket,
  readSetting,
  refuseRenamedSettings,
  RenamedSettingError,
  renamedSettingsIn,
} from "./read.ts";
import { RENAMED_SETTINGS } from "./renames.ts";

const SECRET_VALUE = "s".repeat(40);

function refusal(env: Record<string, string>): RenamedSettingError | undefined {
  try {
    refuseRenamedSettings(env);
  } catch (error) {
    return error as RenamedSettingError;
  }
  return undefined;
}

describe("readSetting", () => {
  it("reads the new name", () => {
    expect(readSetting({ SHELF_SECRET: SECRET_VALUE }, "SHELF_SECRET")).toBe(SECRET_VALUE);
  });

  it("never reads an old name", () => {
    expect(readSetting({ SECRET: SECRET_VALUE }, "SHELF_SECRET")).toBeUndefined();
    expect(readSetting({ STORYSHELF_URL: "u" }, "SHELF_URL")).toBeUndefined();
  });
});

describe("refuseRenamedSettings (the boot guard)", () => {
  it("lets the new names boot", () => {
    expect(refusal({ SHELF_SECRET: SECRET_VALUE, SHELF_ADMIN_TOKEN: "t" })).toBeUndefined();
  });

  it("refuses an old name alone, naming it with its new name and never the value", () => {
    const error = refusal({ SECRET: SECRET_VALUE });
    expect(error).toBeInstanceOf(RenamedSettingError);
    expect(error?.message).toBe(
      "StoryShelf's environment variables were renamed and the old names are no longer read. Rename these, then start again:\n  SECRET -> SHELF_SECRET\nIf another service sets one of these names for itself, set SHELF_ALLOW_OLD_NAMES=1: StoryShelf then starts and still ignores them.",
    );
    expect(error?.message).not.toContain(SECRET_VALUE);
  });

  it("refuses an old name even when the new one is also set, with the same or another value", () => {
    expect(refusal({ SHELF_SECRET: SECRET_VALUE, SECRET: SECRET_VALUE })).toBeInstanceOf(
      RenamedSettingError,
    );
    expect(refusal({ SHELF_SECRET: SECRET_VALUE, SECRET: "other" })).toBeInstanceOf(
      RenamedSettingError,
    );
  });

  it("lists every old name that is set, one line each", () => {
    const error = refusal({ DATA_DIR: "/d", AWS_BUCKET: "b", S3_BUCKET: "b", SHELF_TOKEN: "t" });
    expect(error?.renames).toEqual([
      { old: "DATA_DIR", new: "SHELF_DATA_DIR" },
      { old: "AWS_BUCKET", new: "SHELF_S3_BUCKET" },
      { old: "S3_BUCKET", new: "SHELF_S3_BUCKET" },
    ]);
    expect(error?.message.split("\n").slice(1, -1)).toEqual([
      "  DATA_DIR -> SHELF_DATA_DIR",
      "  AWS_BUCKET -> SHELF_S3_BUCKET",
      "  S3_BUCKET -> SHELF_S3_BUCKET",
    ]);
  });

  it("names the escape hatch in the refusal", () => {
    expect(refusal({ LOG_LEVEL: "debug" })?.message).toContain("set SHELF_ALLOW_OLD_NAMES=1");
  });

  it("with SHELF_ALLOW_OLD_NAMES=1, boots and returns the old names to warn about (names only)", () => {
    const env = { SECRET: SECRET_VALUE, LOG_LEVEL: "other-service", SHELF_ALLOW_OLD_NAMES: "1" };
    const ignored = refuseRenamedSettings(env);
    expect(ignored).toEqual([
      { old: "SECRET", new: "SHELF_SECRET" },
      { old: "LOG_LEVEL", new: "SHELF_LOG_LEVEL" },
    ]);
    expect(oldNamesAllowedFields(ignored)).toEqual({
      oldNames: ["SECRET -> SHELF_SECRET", "LOG_LEVEL -> SHELF_LOG_LEVEL"],
    });
    expect(JSON.stringify(oldNamesAllowedFields(ignored))).not.toContain(SECRET_VALUE);
    expect(OLD_NAMES_ALLOWED_MESSAGE).toContain("SHELF_ALLOW_OLD_NAMES=1");
    // Still never read.
    expect(readSetting(env, "SHELF_SECRET")).toBeUndefined();
  });

  it("refuses when the hatch holds anything but 1", () => {
    expect(refusal({ SECRET: SECRET_VALUE, SHELF_ALLOW_OLD_NAMES: "true" })).toBeInstanceOf(
      RenamedSettingError,
    );
  });

  it("returns nothing when no old name is set, hatch or not", () => {
    expect(refuseRenamedSettings({ SHELF_SECRET: SECRET_VALUE })).toEqual([]);
    expect(refuseRenamedSettings({ SHELF_ALLOW_OLD_NAMES: "1" })).toEqual([]);
  });

  it("ignores an empty old name", () => {
    expect(refusal({ SECRET: "" })).toBeUndefined();
  });

  it("checks only the given settings when narrowed", () => {
    const env = { SECRET: SECRET_VALUE, STORYSHELF_URL: "u" };
    expect(renamedSettingsIn(env, ["SHELF_URL", "SHELF_TOKEN", "SHELF_SLUG"])).toEqual([
      { old: "STORYSHELF_URL", new: "SHELF_URL" },
    ]);
  });
});

describe("readS3Bucket", () => {
  it("prefers SHELF_S3_BUCKET, else takes Fly's BUCKET_NAME, and treats empty as unset", () => {
    expect(readS3Bucket({ SHELF_S3_BUCKET: "own", BUCKET_NAME: "fly" })).toBe("own");
    expect(readS3Bucket({ BUCKET_NAME: "fly" })).toBe("fly");
    expect(readS3Bucket({ SHELF_S3_BUCKET: "", BUCKET_NAME: "fly" })).toBe("fly");
    expect(readS3Bucket({ BUCKET_NAME: "" })).toBeUndefined();
    expect(readS3Bucket({ AWS_BUCKET: "old", S3_BUCKET: "old" })).toBeUndefined();
  });

  it("is not an old name, so the guard lets it boot", () => {
    expect(refuseRenamedSettings({ BUCKET_NAME: "fly" })).toEqual([]);
  });
});

describe("RENAMED_SETTINGS", () => {
  it("gives each old name exactly one new name, and never lists a SHELF_ name as old", () => {
    const olds = Object.values(RENAMED_SETTINGS).flat();
    expect(new Set(olds).size).toBe(olds.length);
    expect(olds.filter((name) => name.startsWith("SHELF_"))).toEqual([]);
  });
});
