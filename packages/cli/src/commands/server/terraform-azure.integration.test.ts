import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { generateAzureTerraformFiles, type AzureTerraformOptions } from "./terraform-azure.ts";

function terraformAvailable(): boolean {
  const res = spawnSync("terraform", ["version"], { stdio: "ignore" });
  return res.status === 0;
}

const hasTerraform = terraformAvailable();

/** Repo-local scratch root (`.tmp` is gitignored and absent on a fresh checkout, e.g. CI). */
function scratchRoot(): string {
  mkdirSync(".tmp", { recursive: true });
  return ".tmp";
}

function materialize(options: AzureTerraformOptions): string {
  const dir = mkdtempSync(join(scratchRoot(), "terraform-azure-check-"));
  mkdirSync(join(dir, "terraform"), { recursive: true });
  for (const [rel, contents] of Object.entries(generateAzureTerraformFiles(options))) {
    writeFileSync(join(dir, rel), contents);
  }
  return dir;
}

describe.skipIf(!hasTerraform)("generated Azure terraform (gated on terraform binary)", () => {
  let fullDir: string;
  let minimalDir: string;

  beforeAll(() => {
    fullDir = materialize({
      project: "acme-shelf",
      location: "eastus",
      domainName: "shelf.example.com",
      entraTenantId: "00000000-0000-0000-0000-000000000000",
    });
    minimalDir = materialize({
      project: "acme-shelf",
      location: "eastus",
    });
  });

  afterAll(() => {
    rmSync(fullDir, { recursive: true, force: true });
    rmSync(minimalDir, { recursive: true, force: true });
  });

  it("passes terraform fmt -check for the full and the minimal stack", () => {
    for (const dir of [fullDir, minimalDir]) {
      expect(() =>
        execFileSync("terraform", ["fmt", "-check", "-recursive", "."], { cwd: dir }),
      ).not.toThrow();
    }
  });

  it("initializes and validates the full and the minimal stack", () => {
    for (const dir of [fullDir, minimalDir]) {
      expect(() =>
        execFileSync("terraform", ["init", "-backend=false", "-input=false", "-no-color"], {
          cwd: dir,
          stdio: "ignore",
        }),
      ).not.toThrow();
      expect(() =>
        execFileSync("terraform", ["validate", "-no-color"], {
          cwd: dir,
          stdio: "ignore",
        }),
      ).not.toThrow();
    }
  }, 240_000);
});
