import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Answers } from "./answers.ts";
import { printNextSteps } from "./next-steps.ts";

let printed = "";

beforeEach(() => {
  printed = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
    printed += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function answers(overrides: Partial<Answers> = {}): Answers {
  return {
    name: "my-server",
    dir: "./my-server",
    database: "sqlite",
    storage: "local",
    auth: "none",
    git: "none",
    docker: false,
    ...overrides,
  };
}

describe("printNextSteps", () => {
  it("names the project, its absolute directory and how to enter it", () => {
    printNextSteps(answers(), "npm");
    expect(printed).toContain(`Scaffolded my-server in ${resolve("./my-server")}`);
    expect(printed).toContain("Next steps:\n  cd ./my-server\n");
  });

  it("installs and starts with the detected package runner on a local server", () => {
    printNextSteps(answers(), "pnpm");
    expect(printed).toContain("  pnpm install\n  pnpm start\n");
    expect(printed).not.toContain("terraform");
    expect(printed).not.toContain("docker");
  });

  it("points a single container at docker:build and docker:run", () => {
    printNextSteps(answers({ deployTarget: "docker", docker: true }), "npm");
    expect(printed).toContain("npm run docker:build");
    expect(printed).toContain("npm run docker:run");
    expect(printed).not.toContain("docker:up");
  });

  it("points a compose stack at docker:up, logs and down", () => {
    printNextSteps(answers({ deployTarget: "docker", docker: true, database: "postgres" }), "npm");
    expect(printed).toContain("npm run docker:up");
    expect(printed).toContain("npm run docker:logs");
    expect(printed).toContain("npm run docker:down");
    expect(printed).not.toContain("docker:run");
  });

  it.each([
    ["aws", "  S3_BUCKET / AWS_REGION", undefined],
    ["azure", "  AZURE_STORAGE_CONNECTION", "az login"],
    ["gcp", "  GCS_BUCKET + GOOGLE_CLOUD_PROJECT", "gcloud auth login"],
  ] as const)("walks the %s terraform steps", (deployTarget, outputs, login) => {
    printNextSteps(answers({ deployTarget }), "npm");
    expect(printed).toContain("terraform -chdir=terraform init");
    expect(printed).toContain("terraform -chdir=terraform apply tfplan");
    expect(printed).toContain(outputs.trim());
    if (login !== undefined) {
      expect(printed).toContain(login);
    }
    expect(printed.endsWith("  npm install\n  npm start\n")).toBe(true);
  });
});
