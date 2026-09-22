import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { generateGcpTerraformFiles, type GcpTerraformOptions } from "./terraform-gcp.ts";

function terraformAvailable(): boolean {
  const res = spawnSync("terraform", ["version"], { stdio: "ignore" });
  return res.status === 0;
}

const hasTerraform = terraformAvailable();

function materialize(options: GcpTerraformOptions): string {
  const dir = mkdtempSync(join(".tmp", "terraform-gcp-check-"));
  mkdirSync(join(dir, "terraform"), { recursive: true });
  for (const [rel, contents] of Object.entries(generateGcpTerraformFiles(options))) {
    writeFileSync(join(dir, rel), contents);
  }
  return dir;
}

describe.skipIf(!hasTerraform)("generated GCP terraform (gated on terraform binary)", () => {
  let fullDir: string;
  let minimalDir: string;

  beforeAll(() => {
    fullDir = materialize({
      project: "acme-shelf",
      gcpProjectId: "acme-gcp-project",
      location: "us-central1",
      domainName: "shelf.example.com",
      identityTenant: "shelf-tenant",
    });
    minimalDir = materialize({
      project: "acme-shelf",
      gcpProjectId: "acme-gcp-project",
      location: "us-central1",
    });
  });

  afterAll(() => {
    rmSync(fullDir, { recursive: true, force: true });
    rmSync(minimalDir, { recursive: true, force: true });
  });

  it("passes terraform fmt -check for both variants", () => {
    for (const dir of [fullDir, minimalDir]) {
      expect(() =>
        execFileSync("terraform", ["fmt", "-check", "-recursive", "."], { cwd: dir }),
      ).not.toThrow();
    }
  });

  it("initializes and validates both variants", () => {
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
