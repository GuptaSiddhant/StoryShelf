/** The runner's tunables: an option, then an environment variable, then the detected default. */

import { readSetting, type SettingName } from "@storyshelf/core/config";
import { recommendedNavigationTimeoutMs } from "@storyshelf/core/utils";

/** Option, then environment variable, then the detected default, for each tunable. */
export function resolveSettings(options: {
  concurrency?: number;
  navigationTimeoutMs?: number;
  recycleBrowserEvery?: number;
  reusePages?: boolean;
}): {
  concurrency: number | undefined;
  navigationTimeoutMs: number;
  recycleBrowserEvery: number | undefined;
  reusePages: boolean;
} {
  return {
    concurrency: options.concurrency ?? envPositiveInt("SHELF_CAPTURE_CONCURRENCY"),
    navigationTimeoutMs:
      options.navigationTimeoutMs ??
      envPositiveInt("SHELF_NAVIGATION_TIMEOUT_MS") ??
      recommendedNavigationTimeoutMs(),
    recycleBrowserEvery: options.recycleBrowserEvery ?? envInt("SHELF_BROWSER_RECYCLE_EVERY", 0),
    reusePages:
      options.reusePages ??
      !["0", "false"].includes(readSetting(process.env, "SHELF_REUSE_PAGES") ?? ""),
  };
}

function envPositiveInt(name: SettingName): number | undefined {
  return envInt(name, 1);
}

function envInt(name: SettingName, min: number): number | undefined {
  // Leading digits only, as parseInt reads them ("12abc" is 12, "" and "abc" are none).
  const digits = /^\s*\+?(?<digits>\d+)/u.exec(readSetting(process.env, name) ?? "")?.groups?.[
    "digits"
  ];
  const parsed = digits === undefined ? Number.NaN : Number(digits);
  return parsed >= min ? parsed : undefined;
}
