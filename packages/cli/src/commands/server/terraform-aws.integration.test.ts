import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { generateAwsTerraformFiles } from "./terraform-aws.ts";

function terraformAvailable(): boolean {
  const res = spawnSync("terraform", ["version"], { stdio: "ignore" });
  return res.status === 0;
}

const hasTerraform = terraformAvailable();

describe.skipIf(!hasTerraform)("generated AWS terraform (gated on terraform binary)", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(".tmp", "terraform-check-"));
    for (const [rel, contents] of Object.entries(
      generateAwsTerraformFiles({
        project: "acme-shelf",
        region: "us-east-1",
        dbEngine: "rds",
        domainName: "shelf.example.com",
        samlMetadataUrl: "https://idp.example.com/metadata/saml",
      }),
    )) {
      writeFileSync(join(dir, rel), contents);
    }
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("passes terraform fmt -check", () => {
    expect(() =>
      execFileSync("terraform", ["fmt", "-check", "-recursive", "."], { cwd: dir }),
    ).not.toThrow();
  });

  it("initializes and validates the module", () => {
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
  }, 180_000);
});
