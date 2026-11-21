import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Answers } from "./answers.ts";
import { writeFiles } from "./writers.ts";

let out = "";
let printed = "";

beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), "storyshelf-init-writers-"));
  printed = "";
  vi.stubGlobal("__PKG_VERSION__", "0.3.2");
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
    printed += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  rmSync(out, { recursive: true, force: true });
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

describe("writeFiles", () => {
  it("writes the server, package.json and tsconfig for a plain local server", async () => {
    await writeFiles(out, answers());
    expect(existsSync(join(out, "src", "index.ts"))).toBe(true);
    expect(existsSync(join(out, "server.ts"))).toBe(false);
    expect(existsSync(join(out, "package.json"))).toBe(true);
    const tsconfig = JSON.parse(readFileSync(join(out, "tsconfig.json"), "utf8")) as {
      include: string[];
    };
    expect(tsconfig.include).toEqual(["src"]);
    expect(existsSync(join(out, "Dockerfile"))).toBe(false);
    expect(existsSync(join(out, "terraform"))).toBe(false);
    expect(printed).toBe(
      "Created src/index.ts\nCreated package.json, tsconfig.json, .env.example, README.md, .gitignore\n",
    );
  });

  it("writes .env.example and a README naming the required variables", async () => {
    await writeFiles(out, answers({ auth: "password" }));
    const example = readFileSync(join(out, ".env.example"), "utf8");
    for (const name of ["SHELF_SECRET", "SHELF_PUBLIC_BASE_URL", "SHELF_ADMIN_PASSWORD"]) {
      expect(example).toContain(`\n${name}=`);
    }
    expect(example).toContain("# PORT=3000");
    expect(readFileSync(join(out, ".gitignore"), "utf8")).toContain(".env\n");
    const readme = readFileSync(join(out, "README.md"), "utf8");
    expect(readme).toContain("Get your first build");
    expect(readme).toContain("`SHELF_SECRET`");
  });

  it("writes a Dockerfile and .dockerignore, and no compose file for one container", async () => {
    await writeFiles(out, answers({ deployTarget: "docker", docker: true }));
    const dockerfile = readFileSync(join(out, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("mcr.microsoft.com/playwright");
    expect(dockerfile).toContain("COPY src/ ./src/");
    expect(dockerfile).toContain('"src/index.ts"');
    expect(dockerfile).not.toContain("esbuild");
    expect(existsSync(join(out, ".dockerignore"))).toBe(true);
    expect(existsSync(join(out, "compose.yaml"))).toBe(false);
    expect(printed).toContain("Created Dockerfile, .dockerignore\n");
  });

  it("adds a postgres-only compose file when the stack has two services", async () => {
    await writeFiles(out, answers({ deployTarget: "docker", docker: true, database: "postgres" }));
    const compose = readFileSync(join(out, "compose.yaml"), "utf8");
    expect(compose).toContain("postgres:");
    expect(compose).not.toContain("worker:");
    expect(printed).toContain("Created Dockerfile, .dockerignore, compose.yaml\n");
  });

  it("writes no terraform for local and docker targets", async () => {
    await writeFiles(out, answers({ deployTarget: "docker", docker: true }));
    expect(existsSync(join(out, "terraform"))).toBe(false);
  });
});
