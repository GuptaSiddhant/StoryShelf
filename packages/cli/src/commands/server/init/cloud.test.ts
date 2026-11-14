import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("prompts", () => ({ default: vi.fn() }));
vi.mock("../../../config.ts", () => ({ cliVersion: (): string => "0.12.0" }));

import prompts from "prompts";
import { generateMainTf, generateTfvars, isCloud, runCloudInit } from "./cloud.ts";

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

describe("generateMainTf", () => {
  it.each(["aws", "gcp", "azure"] as const)("pins the %s module at the CLI version", (cloud) => {
    const tf = generateMainTf(cloud, "0.12.0");
    expect(tf).toContain(
      `git::https://github.com/GuptaSiddhant/StoryShelf.git//deploy/terraform/${cloud}?ref=v0.12.0`,
    );
    expect(tf).toContain('image_version = "0.12.0"');
    expect(tf.includes("project_id")).toBe(cloud === "gcp");
  });
});

describe("generateTfvars", () => {
  it("writes the answers, and the project only for GCP", () => {
    const answers = { dir: ".", name: "shelf", location: "eu-west-1", projectId: "p" };
    expect(generateTfvars("aws", answers)).toBe(
      'name = "shelf"\nregion = "eu-west-1"\ndomain_name = ""\n',
    );
    expect(generateTfvars("gcp", answers)).toContain('project_id = "p"');
    expect(generateTfvars("azure", answers)).toContain('location = "eu-west-1"');
  });
});

describe("runCloudInit", () => {
  it("writes main.tf and terraform.tfvars", async () => {
    vi.mocked(prompts).mockResolvedValueOnce({ name: "shelf", location: "us-east-1" });
    const dir = join(root, "infra");
    await runCloudInit("aws", dir);
    expect(readFileSync(join(dir, "main.tf"), "utf8")).toContain("?ref=v0.12.0");
    expect(readFileSync(join(dir, "terraform.tfvars"), "utf8")).toContain('name = "shelf"');
    expect(printed).toContain("terraform init");
  });

  it("cancels without a name, or without a GCP project", async () => {
    vi.mocked(prompts).mockResolvedValueOnce({});
    await runCloudInit("aws", join(root, "a"));
    vi.mocked(prompts).mockResolvedValueOnce({ name: "shelf", location: "us-central1" });
    await runCloudInit("gcp", join(root, "b"));
    expect(existsSync(join(root, "a"))).toBe(false);
    expect(existsSync(join(root, "b"))).toBe(false);
  });

  it("does not overwrite an existing main.tf", async () => {
    vi.mocked(prompts).mockResolvedValue({ name: "shelf", location: "us-east-1" });
    const dir = join(root, "infra");
    await runCloudInit("aws", dir);
    await runCloudInit("aws", dir);
    expect(printed).toContain("already exists");
  });
});
