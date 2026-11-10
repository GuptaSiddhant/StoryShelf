import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vite-plus/test";
import { generateGcpTerraformFiles, type GcpTerraformOptions } from "./terraform-gcp.ts";
import { terraformGate } from "./test-helpers/terraform-gate.ts";

// `terraform init` downloads providers, so the suite runs only when RUN_TERRAFORM=1 (see
// test-helpers/terraform-gate.ts). With the gate set, a missing binary must fail rather than
// silently skip the suite below.
const { runTerraform, hasTerraform } = terraformGate();

it.runIf(runTerraform)("has a terraform binary (RUN_TERRAFORM=1 requires one)", () => {
  expect(hasTerraform).toBe(true);
});

/** Repo-local scratch root (`.tmp` is gitignored and absent on a fresh checkout, e.g. CI). */
function scratchRoot(): string {
  mkdirSync(".tmp", { recursive: true });
  return ".tmp";
}

function materialize(options: GcpTerraformOptions): string {
  const dir = mkdtempSync(join(scratchRoot(), "terraform-gcp-check-"));
  mkdirSync(join(dir, "terraform"), { recursive: true });
  for (const [rel, contents] of Object.entries(generateGcpTerraformFiles(options))) {
    writeFileSync(join(dir, rel), contents);
  }
  return dir;
}

describe.skipIf(!hasTerraform)("generated GCP terraform (gated on RUN_TERRAFORM=1)", () => {
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
          cwd: join(dir, "terraform"),
          stdio: "ignore",
        }),
      ).not.toThrow();
      expect(() =>
        execFileSync("terraform", ["validate", "-no-color"], {
          cwd: join(dir, "terraform"),
          stdio: "ignore",
        }),
      ).not.toThrow();
    }
  }, 240_000);
});
