import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    expect(printed).toContain("  pnpm install\n  pnpm exec playwright-core install chromium");
    expect(printed).toContain("  pnpm start\n");
    expect(printed).not.toContain("terraform");
    expect(printed).not.toContain("docker");
  });

  it("installs the project's own pinned browser, never a bare playwright, on a local server", () => {
    printNextSteps(answers(), "npm");
    expect(printed).toContain("  npx playwright-core install chromium");
    expect(printed).toContain("--with-deps");
    expect(printed).not.toMatch(/playwright install/u);
    expect(printed.indexOf("playwright-core install")).toBeLessThan(printed.indexOf("npm start"));
  });

  it("leaves the install step out once --install ran it", () => {
    printNextSteps(answers(), "pnpm", true);
    expect(printed).not.toContain("pnpm install");
    expect(printed).toContain("pnpm exec playwright-core install chromium");
    expect(printed).toContain("  pnpm start\n");
  });

  it("names the three variables before npm start with local accounts", () => {
    printNextSteps(answers({ auth: "password" }), "npm");
    expect(printed).toContain("export SHELF_SECRET=");
    expect(printed).toContain("export SHELF_PUBLIC_BASE_URL=http://localhost:3000");
    expect(printed).toContain("export SHELF_ADMIN_PASSWORD=");
    expect(printed.indexOf("export SHELF_ADMIN_PASSWORD=")).toBeLessThan(
      printed.indexOf("npm start"),
    );
  });

  it("points a single container at docker:build and docker:run", () => {
    printNextSteps(answers({ deployTarget: "docker", docker: true }), "npm");
    expect(printed).toContain("npm run docker:build");
    expect(printed).toContain("npm run docker:run");
    expect(printed).not.toContain("docker:up");
  });

  it("asks a single container for SHELF_SECRET and SHELF_ADMIN_PASSWORD before docker:run", () => {
    printNextSteps(answers({ deployTarget: "docker", docker: true, auth: "password" }), "npm");
    expect(printed.indexOf("export SHELF_SECRET=")).toBeGreaterThan(-1);
    expect(printed.indexOf("export SHELF_ADMIN_PASSWORD=")).toBeGreaterThan(-1);
    expect(printed.indexOf("export SHELF_ADMIN_PASSWORD=")).toBeLessThan(
      printed.indexOf("docker:run"),
    );
  });

  it("points a compose stack at docker:up, logs and down", () => {
    printNextSteps(answers({ deployTarget: "docker", docker: true, database: "postgres" }), "npm");
    expect(printed).toContain("npm run docker:up");
    expect(printed).toContain("npm run docker:logs");
    expect(printed).toContain("npm run docker:down");
    expect(printed).not.toContain("docker:run");
    expect(printed).toContain("export SHELF_SECRET=");
    expect(printed).not.toContain("export SHELF_ADMIN_PASSWORD=");
  });

  it("asks a password compose stack for SHELF_ADMIN_PASSWORD before docker:up", () => {
    printNextSteps(
      answers({ deployTarget: "docker", docker: true, database: "postgres", auth: "password" }),
      "npm",
    );
    expect(printed.indexOf("export SHELF_ADMIN_PASSWORD=")).toBeGreaterThan(-1);
    expect(printed.indexOf("export SHELF_ADMIN_PASSWORD=")).toBeLessThan(
      printed.indexOf("docker:up"),
    );
  });
});
