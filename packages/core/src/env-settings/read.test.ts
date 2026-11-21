import { describe, expect, it, vi } from "vitest";
import { SETTING_ALIASES } from "./aliases.ts";
import {
  aliasesOf,
  readSetting,
  renamedSettingsIn,
  SettingConflictError,
  warnRenamedSettings,
} from "./read.ts";

const SECRET_VALUE = "s".repeat(40);
const OTHER_VALUE = "o".repeat(40);

function logger(): { warn: ReturnType<typeof vi.fn> } {
  return { warn: vi.fn() };
}

describe("readSetting", () => {
  it("reads the new name alone, with no warning", () => {
    const env = { SHELF_SECRET: SECRET_VALUE };
    const log = logger();
    expect(readSetting(env, "SHELF_SECRET")).toBe(SECRET_VALUE);
    expect(warnRenamedSettings(env, log)).toEqual([]);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("reads the old name alone, and boot warns once with { old, new } and no value", () => {
    const env = { SECRET: SECRET_VALUE };
    const log = logger();
    expect(readSetting(env, "SHELF_SECRET")).toBe(SECRET_VALUE);
    expect(warnRenamedSettings(env, log)).toEqual([{ old: "SECRET", new: "SHELF_SECRET" }]);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]?.[0]).toEqual({ old: "SECRET", new: "SHELF_SECRET" });
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain(SECRET_VALUE);
  });

  it("accepts both names with the same value, and still warns about the old one", () => {
    const env = { SHELF_SECRET: SECRET_VALUE, SECRET: SECRET_VALUE };
    const log = logger();
    expect(readSetting(env, "SHELF_SECRET")).toBe(SECRET_VALUE);
    expect(warnRenamedSettings(env, log)).toEqual([{ old: "SECRET", new: "SHELF_SECRET" }]);
  });

  it("refuses both names with different values, naming the variables and never the values", () => {
    const env = { SHELF_SECRET: SECRET_VALUE, SECRET: OTHER_VALUE };
    expect(() => readSetting(env, "SHELF_SECRET")).toThrow(SettingConflictError);
    let message = "";
    try {
      warnRenamedSettings(env, logger());
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe(
      "SHELF_SECRET and SECRET are both set, to different values: set only SHELF_SECRET and unset SECRET",
    );
    expect(message).not.toContain(SECRET_VALUE);
    expect(message).not.toContain(OTHER_VALUE);
  });

  it("refuses two old names of one setting that disagree", () => {
    const env = { ADMIN_TOKEN: "a", STORYSHELF_ADMIN_TOKEN: "b" };
    expect(() => readSetting(env, "SHELF_ADMIN_TOKEN")).toThrow(
      "ADMIN_TOKEN and STORYSHELF_ADMIN_TOKEN are both set, to different values: set only SHELF_ADMIN_TOKEN and unset ADMIN_TOKEN, STORYSHELF_ADMIN_TOKEN",
    );
  });

  it("names three variables in a three-way conflict", () => {
    const env = { SHELF_S3_BUCKET: "a", AWS_BUCKET: "a", BUCKET_NAME: "b" };
    expect(() => readSetting(env, "SHELF_S3_BUCKET")).toThrow(
      "SHELF_S3_BUCKET, AWS_BUCKET and BUCKET_NAME are all set",
    );
  });

  it("treats an empty value as unset, so an empty new name falls back to the old one", () => {
    expect(readSetting({ SHELF_DATA_DIR: "", DATA_DIR: "/data" }, "SHELF_DATA_DIR")).toBe("/data");
    expect(readSetting({ SHELF_DATA_DIR: "" }, "SHELF_DATA_DIR")).toBe("");
    expect(readSetting({}, "SHELF_DATA_DIR")).toBeUndefined();
  });

  it("reads a SHELF_ name that has no old names", () => {
    expect(aliasesOf("SHELF_AUTH")).toEqual([]);
    expect(readSetting({ SHELF_AUTH: "none" }, "SHELF_AUTH")).toBe("none");
  });
});

describe("renamedSettingsIn", () => {
  it("lists every old name in use, once each", () => {
    const env = { DATA_DIR: "/d", AWS_BUCKET: "b", S3_BUCKET: "b", SHELF_TOKEN: "t" };
    expect(renamedSettingsIn(env)).toEqual([
      { old: "DATA_DIR", new: "SHELF_DATA_DIR" },
      { old: "AWS_BUCKET", new: "SHELF_S3_BUCKET" },
      { old: "S3_BUCKET", new: "SHELF_S3_BUCKET" },
    ]);
  });
});

describe("SETTING_ALIASES", () => {
  it("gives each old name exactly one new name, and never aliases a SHELF_ name", () => {
    const olds = Object.values(SETTING_ALIASES).flat();
    expect(new Set(olds).size).toBe(olds.length);
    expect(olds.filter((name) => name.startsWith("SHELF_"))).toEqual([]);
  });
});
