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

function materialize(options: AzureTerraformOptions): string {
  const dir = mkdtempSync(join(".tmp", "terraform-azure-check-"));
  mkdirSync(join(dir, "terraform"), { recursive: true });
  for (const [rel, contents] of Object.entries(generateAzureTerraformFiles(options))) {
    writeFileSync(join(dir, rel), contents);
  }
  return dir;
}

describe.skipIf(!hasTerraform)("generated Azure terraform (gated on terraform binary)", () => {
  let storageDir: string;
  let busDir: string;

  beforeAll(() => {
    storageDir = materialize({
      project: "acme-shelf",
      location: "eastus",
      queueBackend: "storage-queues",
      domainName: "shelf.example.com",
      entraTenantId: "00000000-0000-0000-0000-000000000000",
    });
    busDir = materialize({
      project: "acme-shelf",
      location: "eastus",
      queueBackend: "service-bus",
    });
  });

  afterAll(() => {
    rmSync(storageDir, { recursive: true, force: true });
    rmSync(busDir, { recursive: true, force: true });
  });

  it("passes terraform fmt -check for both backends", () => {
    for (const dir of [storageDir, busDir]) {
      expect(() =>
        execFileSync("terraform", ["fmt", "-check", "-recursive", "."], { cwd: dir }),
      ).not.toThrow();
    }
  });

  it("initializes and validates both backend modules", () => {
    for (const dir of [storageDir, busDir]) {
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
