import { describe, expect, it } from "vitest";
import type { Answers } from "./answers.ts";
import { generateEnvExample, generateReadme } from "./env-files.ts";

function answers(overrides: Partial<Answers> = {}): Answers {
  return {
    name: "my-server",
    dir: "./my-server",
    database: "sqlite",
    storage: "local",
    auth: "password",
    docker: false,
    ...overrides,
  };
}

describe("generateEnvExample", () => {
  it("lists the three variables of local accounts, with PUBLIC_BASE_URL filled in", () => {
    const text = generateEnvExample(answers());
    expect(text).toContain("\nSECRET=\n");
    expect(text).toContain("\nPUBLIC_BASE_URL=http://localhost:3000\n");
    expect(text).toContain("\nAUTH_PASSWORD=\n");
    expect(text).not.toContain("DATABASE_URL");
  });

  it("adds DATABASE_URL for a server database and drops the required block without sign-in", () => {
    expect(generateEnvExample(answers({ database: "postgres" }))).toContain("\nDATABASE_URL=\n");
    const open = generateEnvExample(answers({ auth: "none" }));
    expect(open).not.toContain("# Required");
    expect(open).toContain("# PORT=3000");
  });
});

describe("generateReadme", () => {
  it("names the project, the variables, sign-in and the first-build card", () => {
    const text = generateReadme(answers());
    expect(text).toContain("# my-server");
    expect(text).toContain("`AUTH_PASSWORD`");
    expect(text).toContain("admin@example.com");
    expect(text).toContain("Get your first build");
  });

  it("skips the variables section when nothing is required", () => {
    expect(generateReadme(answers({ auth: "none" }))).not.toContain("Copy `.env.example`");
  });
});
