import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("prompts", () => ({ default: vi.fn() }));
vi.mock("../version.ts", () => ({ packageVersion: (): string => "0.12.0" }));

import prompts from "prompts";
import { generateMainTf, generateTfvars, isCloud, runCloudInit } from "./cloud.ts";
import { STATE_WARNING } from "./state-files.ts";

let root = "";
let printed = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "storyshelf-cloud-"));
  printed = "";
  vi.mocked(prompts).mockReset();
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
    printed += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
    printed += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("isCloud", () => {
  it("accepts the three clouds only", () => {
    expect(["aws", "gcp", "azure"].every((cloud) => isCloud(cloud))).toBe(true);
    expect(isCloud("fly")).toBe(false);
  });
});

/** The variables a module under `deploy/terraform/` declares. */
function declaredInputs(cloud: string): string[] {
  const file = join(import.meta.dirname, "../../../../deploy/terraform", cloud, "variables.tf");
  return [...readFileSync(file, "utf8").matchAll(/^variable "(?<name>\w+)"/gmu)].map(
    (match) => match.groups?.["name"] ?? "",
  );
}

describe("generateMainTf", () => {
  it.each(["aws", "gcp", "azure"] as const)("pins the %s module at the CLI version", (cloud) => {
    const tf = generateMainTf(cloud, "0.12.0");
    expect(tf).toContain(
      `git::https://github.com/GuptaSiddhant/StoryShelf.git//deploy/terraform/${cloud}?ref=v0.12.0`,
    );
    expect(tf).toContain('image_version = "0.12.0"');
    expect(tf.includes("project_id")).toBe(cloud === "gcp");
  });

  it("passes only inputs that the module declares", () => {
    for (const cloud of ["aws", "gcp", "azure"] as const) {
      const passed = [
        ...generateMainTf(cloud, "0.12.0").matchAll(/^ {2}(?<name>\w+)\s+= var\./gmu),
      ];
      expect(declaredInputs(cloud)).toEqual(
        expect.arrayContaining(passed.map((match) => match.groups?.["name"] ?? "")),
      );
    }
  });
});

describe("generateTfvars", () => {
  it("writes the answers, and the project only for GCP", () => {
    const answers = { dir: ".", name: "shelf", location: "eu-west-1", projectId: "p" };
    expect(generateTfvars("aws", answers)).toBe(
      'name = "shelf"\nregion = "eu-west-1"\ndomain_name = ""\nallowed_cidr_blocks = []\n',
    );
    expect(
      generateTfvars("aws", { ...answers, allowedCidrBlocks: "10.0.0.0/8, 1.2.3.0/24" }),
    ).toContain('allowed_cidr_blocks = ["10.0.0.0/8","1.2.3.0/24"]');
    expect(generateTfvars("gcp", answers)).toContain('project_id = "p"');
    expect(generateTfvars("gcp", answers)).toContain('public_base_url = ""');
    expect(generateTfvars("gcp", answers)).not.toContain("domain_name");
    expect(generateTfvars("azure", answers)).toContain('location = "eu-west-1"');
    expect(generateTfvars("azure", answers)).toContain("allowed_cidr_blocks = []");
    expect(generateTfvars("azure", answers)).not.toContain("domain_name");
  });
});

describe("runCloudInit", () => {
  it("writes main.tf and terraform.tfvars", async () => {
    vi.mocked(prompts).mockResolvedValueOnce({
      name: "shelf",
      location: "us-east-1",
      allowedCidrBlocks: "10.0.0.0/8, 192.168.0.0/16",
    });
    const dir = join(root, "infra");
    await runCloudInit("aws", dir);
    expect(readFileSync(join(dir, "main.tf"), "utf8")).toContain("?ref=v0.12.0");
    expect(readFileSync(join(dir, "terraform.tfvars"), "utf8")).toContain('name = "shelf"');
    expect(printed).toContain("terraform init");
  });

  it("ignores the state and plan, and says the state holds secrets", async () => {
    vi.mocked(prompts).mockResolvedValueOnce({
      name: "shelf",
      location: "us-central1",
      projectId: "p",
    });
    const dir = join(root, "gcp-infra");
    await runCloudInit("gcp", dir);
    const ignored = readFileSync(join(dir, ".gitignore"), "utf8").split("\n");
    expect(ignored).toEqual(expect.arrayContaining(["*.tfstate*", ".terraform/", "tfplan"]));
    expect(printed).toContain(STATE_WARNING);
    expect(STATE_WARNING).toMatch(/encrypted remote backend/u);
  });

  it("cancels without a name, or without a GCP project", async () => {
    vi.mocked(prompts).mockResolvedValueOnce({});
    await runCloudInit("aws", join(root, "a"));
    vi.mocked(prompts).mockResolvedValueOnce({ name: "shelf", location: "us-central1" });
    await runCloudInit("gcp", join(root, "b"));
    vi.mocked(prompts).mockResolvedValueOnce({ name: "shelf", location: "eastus" });
    await runCloudInit("azure", join(root, "d"));
    expect(existsSync(join(root, "d"))).toBe(false);
    vi.mocked(prompts).mockResolvedValueOnce({ name: "shelf", location: "us-east-1" });
    await runCloudInit("aws", join(root, "c"));
    expect(existsSync(join(root, "c"))).toBe(false);
    expect(existsSync(join(root, "a"))).toBe(false);
    expect(existsSync(join(root, "b"))).toBe(false);
  });

  it("does not overwrite an existing main.tf", async () => {
    vi.mocked(prompts).mockResolvedValue({
      name: "shelf",
      location: "us-east-1",
      allowedCidrBlocks: "10.0.0.0/8, 192.168.0.0/16",
    });
    const dir = join(root, "infra");
    await runCloudInit("aws", dir);
    await runCloudInit("aws", dir);
    expect(printed).toContain("already exists");
  });
});
