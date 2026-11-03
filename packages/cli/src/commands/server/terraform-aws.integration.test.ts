import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { generateAwsTerraformFiles, type AwsTerraformOptions } from "./terraform-aws.ts";
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

/** Every fixture directory created so far, so teardown removes them even if a later one failed. */
const created: string[] = [];

function materialize(options: AwsTerraformOptions): string {
  const dir = mkdtempSync(join(scratchRoot(), "terraform-aws-check-"));
  created.push(dir);
  // The generator writes `terraform/*.tf`; the GCP and Azure tests create this folder too.
  mkdirSync(join(dir, "terraform"), { recursive: true });
  for (const [rel, contents] of Object.entries(generateAwsTerraformFiles(options))) {
    writeFileSync(join(dir, rel), contents);
  }
  return dir;
}

describe.skipIf(!hasTerraform)("generated AWS terraform (gated on RUN_TERRAFORM=1)", () => {
  let dir: string;

  beforeAll(() => {
    // The generated HCL is driven by variables (`domain_name`, `vpc_id`), not by generator options,
    // so every option set produces the same files. `terraform validate` type-checks both arms of
    // each conditional (`count`, `dynamic`), but it does not evaluate them with values.
    dir = materialize({
      project: "acme-shelf",
      region: "us-east-1",
      domainName: "shelf.example.com",
      samlMetadataUrl: "https://idp.example.com/metadata/saml",
    });
  });

  afterAll(() => {
    // Remove whatever was created, including fixtures from a `beforeAll` that threw part-way.
    for (const fixture of created.splice(0)) {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("passes terraform fmt -check", () => {
    expect(() =>
      execFileSync("terraform", ["fmt", "-check", "-recursive", "."], { cwd: dir }),
    ).not.toThrow();
  });

  it("initializes and validates the generated terraform directory", () => {
    const cwd = join(dir, "terraform");
    expect(() =>
      execFileSync("terraform", ["init", "-backend=false", "-input=false", "-no-color"], {
        cwd,
        stdio: "ignore",
      }),
    ).not.toThrow();
    expect(() =>
      execFileSync("terraform", ["validate", "-no-color"], { cwd, stdio: "ignore" }),
    ).not.toThrow();
  }, 300_000);
});
