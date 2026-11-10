import { describe, expect, it } from "vite-plus/test";
import * as config from "./config.ts";

describe("config.ts", () => {
  it("keeps the public surface: the functions the CLI imports from it", () => {
    expect(Object.keys(config).toSorted()).toEqual([
      "assertStorybookMain",
      "cliVersion",
      "detectGitDefaultBranch",
      "detectGitRepository",
      "detectPackageName",
      "detectPackagePath",
      "detectPackageRunner",
      "detectStorybookMeta",
      "findStorybookMain",
      "installCommand",
      "loadStorybookConfig",
      "schemaReference",
      "startCommand",
      "writeStorybookConfig",
    ]);
  });
});
