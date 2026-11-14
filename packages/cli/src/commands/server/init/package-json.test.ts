import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Answers } from "./answers.ts";
import { generatePackageJson } from "./package-json.ts";

interface Generated {
  name: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  engines: Record<string, string>;
}

beforeEach(() => {
  vi.stubGlobal("__PKG_VERSION__", "0.3.2");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function pkg(overrides: Partial<Answers> = {}): Generated {
  return JSON.parse(
    generatePackageJson({
      name: "my-server",
      dir: "./my-server",
      database: "sqlite",
      storage: "local",
      auth: "none",
      git: "none",
      docker: false,
      ...overrides,
    }),
  ) as Generated;
}

describe("generatePackageJson", () => {
  it("keeps the default dependencies lean", () => {
    expect(Object.keys(pkg().dependencies).toSorted()).toEqual([
      "@hono/node-server",
      "@storyshelf/app",
      "@storyshelf/db-sqlite",
      "@storyshelf/runner-playwright",
    ]);
  });

  it("pins the StoryShelf packages to the CLI version", () => {
    const { dependencies } = pkg({ notifications: true });
    expect(dependencies["@storyshelf/app"]).toBe("0.3.2");
    expect(dependencies["@storyshelf/core"]).toBe("0.3.2");
  });

  it("falls back to 0.0.0 when the build did not define the version", () => {
    vi.stubGlobal("__PKG_VERSION__", null);
    expect(pkg().dependencies["@storyshelf/app"]).toBe("0.0.0");
  });

  it("runs entries with plain node and requires Node 24+", () => {
    const { scripts, engines } = pkg({ database: "postgres", storage: "s3" });
    expect(scripts["start"]).toBe("node src/index.ts");
    expect(scripts["dev"]).toBe("node --watch src/index.ts");
    expect(scripts["typecheck"]).toBe("tsc");
    // Node 26 rejects --experimental-transform-types; Node 24+ strips types unflagged.
    expect(JSON.stringify(scripts)).not.toContain("experimental");
    expect(engines["node"]).toBe(">=24");
  });

  it("declares the typing dev dependencies", () => {
    const { devDependencies } = pkg();
    expect(devDependencies["@types/node"]).toBeDefined();
    expect(devDependencies["typescript"]).toBeDefined();
  });

  it("maps every database to its adapter package and its SDK peer", () => {
    const adapters: Record<Answers["database"], [string, string?]> = {
      sqlite: ["@storyshelf/db-sqlite"],
      turso: ["@storyshelf/db-sqlite", "@libsql/client"],
      "better-sqlite3": ["@storyshelf/db-sqlite", "better-sqlite3"],
      "bun-sqlite": ["@storyshelf/db-sqlite"],
      d1: ["@storyshelf/db-sqlite"],
      postgres: ["@storyshelf/db-postgres"],
      pg: ["@storyshelf/db-postgres", "pg"],
      neon: ["@storyshelf/db-postgres", "@neondatabase/serverless"],
      "neon-http": ["@storyshelf/db-postgres", "@neondatabase/serverless"],
      vercel: ["@storyshelf/db-postgres", "@vercel/postgres"],
      pglite: ["@storyshelf/db-postgres", "@electric-sql/pglite"],
      mysql: ["@storyshelf/db-mysql", "mysql2"],
      planetscale: ["@storyshelf/db-mysql", "@planetscale/database"],
      tidb: ["@storyshelf/db-mysql", "@tidbcloud/serverless"],
    };
    for (const [database, [adapter, peer]] of Object.entries(adapters) as [
      Answers["database"],
      [string, string?],
    ][]) {
      const names = Object.keys(pkg({ database }).dependencies);
      expect(names).toContain(adapter);
      expect(
        names.filter((name) => !name.startsWith("@storyshelf/") && name !== "@hono/node-server"),
      ).toEqual(peer === undefined ? [] : [peer]);
    }
  });

  it("adds the storage package only for a remote store", () => {
    expect(pkg({ storage: "local" }).dependencies["@storyshelf/storage-local"]).toBeUndefined();
    expect(pkg({ storage: "s3" }).dependencies["@storyshelf/storage-s3"]).toBeDefined();
    expect(pkg({ storage: "azure" }).dependencies["@storyshelf/storage-azure"]).toBeDefined();
    expect(pkg({ storage: "gcs" }).dependencies["@storyshelf/storage-gcs"]).toBeDefined();
  });

  it("declares the auth package only when auth is on", () => {
    expect(pkg({ auth: "none" }).dependencies["@storyshelf/auth"]).toBeUndefined();
    expect(pkg({ auth: "password" }).dependencies["@storyshelf/auth"]).toBeDefined();
    expect(pkg({ auth: "oauth" }).dependencies["@storyshelf/auth"]).toBeDefined();
  });

  it("adds nodemailer and core only when SMTP is chosen", () => {
    const { dependencies } = pkg({ notifications: true });
    expect(dependencies["nodemailer"]).toBeDefined();
    expect(dependencies["@storyshelf/core"]).toBeDefined();
    const off = pkg({ notifications: false }).dependencies;
    expect(off["nodemailer"]).toBeUndefined();
    expect(off["@storyshelf/core"]).toBeUndefined();
  });

  it("adds the observability packages only when asked", () => {
    const { dependencies } = pkg({ observability: true });
    expect(dependencies["@storyshelf/observability"]).toBeDefined();
    expect(dependencies["@storyshelf/core"]).toBeDefined();
    expect(pkg().dependencies["@storyshelf/observability"]).toBeUndefined();
  });

  it("installs no integration package: git, chat, email and Figma are built in", () => {
    const { dependencies } = pkg({ notifications: true, design: true, git: "git" });
    const stale = Object.keys(dependencies).filter((name) =>
      /@storyshelf\/(notify-|design-figma)/u.test(name),
    );
    expect(stale).toEqual([]);
  });

  it("has plain docker scripts for a single container", () => {
    const { scripts } = pkg({ deployTarget: "docker", docker: true });
    expect(scripts["docker:build"]).toBe("docker build -t my-server .");
    expect(scripts["docker:run"]).toContain("docker run");
    expect(scripts["docker:up"]).toBeUndefined();
    expect(scripts["infra:plan"]).toBeUndefined();
  });

  it("has compose scripts when the stack has more than one service", () => {
    const { scripts } = pkg({ deployTarget: "docker", docker: true, database: "postgres" });
    expect(scripts["docker:up"]).toBe("docker compose up --build");
    expect(scripts["docker:run"]).toBeUndefined();
  });

  it.each(["aws", "azure", "gcp"] as const)("has the terraform scripts for %s", (deployTarget) => {
    const { scripts } = pkg({ deployTarget, docker: true, database: "postgres" });
    expect(scripts["infra:init"]).toBe("terraform -chdir=terraform init");
    expect(scripts["infra:apply"]).toBe("terraform -chdir=terraform apply tfplan");
    expect(scripts["docker:up"]).toBeUndefined();
  });

  it("has neither docker nor infra scripts on a plain local server", () => {
    const keys = Object.keys(pkg().scripts).toSorted();
    expect(keys).toEqual(["dev", "start", "typecheck"]);
  });
});
