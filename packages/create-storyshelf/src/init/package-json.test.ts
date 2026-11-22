import { describe, expect, it, vi } from "vitest";
import { peerRange } from "../manifest.ts";
import type { Answers } from "./answers.ts";
import { generatePackageJson } from "./package-json.ts";

vi.mock("../manifest.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../manifest.ts")>()),
  // Pin the version so a release does not churn the snapshots; the peer ranges stay the manifest's.
  ownVersion: () => "0.3.2",
}));

interface Generated {
  name: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  engines: Record<string, string>;
}

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
      "@storyshelf/app",
      "@storyshelf/core",
      "@storyshelf/db",
      "@storyshelf/runner",
    ]);
  });

  it("pins the StoryShelf packages to the CLI version", () => {
    const { dependencies } = pkg({ notifications: true });
    expect(dependencies["@storyshelf/app"]).toBe("0.3.2");
    expect(dependencies["@storyshelf/core"]).toBe("0.3.2");
  });

  it("does not write @hono/node-server: storyshelf-server serves through @storyshelf/app", () => {
    expect(pkg().dependencies).not.toHaveProperty("@hono/node-server");
  });

  it("names the instance module for storyshelf-server", () => {
    expect((pkg() as unknown as { storyshelf: { server: string } }).storyshelf).toEqual({
      server: "src/index.ts",
    });
  });

  it("runs entries with plain node and requires Node 24+", () => {
    const { scripts, engines } = pkg({ database: "postgres", storage: "s3" });
    expect(scripts["start"]).toBe("storyshelf-server serve");
    expect(scripts["dev"]).toBe("storyshelf-server serve --watch");
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
      sqlite: ["@storyshelf/db"],
      turso: ["@storyshelf/db", "@libsql/client"],
      "better-sqlite3": ["@storyshelf/db", "better-sqlite3"],
      "bun-sqlite": ["@storyshelf/db"],
      d1: ["@storyshelf/db"],
      postgres: ["@storyshelf/db", "postgres"],
      pg: ["@storyshelf/db", "pg"],
      neon: ["@storyshelf/db", "@neondatabase/serverless"],
      "neon-http": ["@storyshelf/db", "@neondatabase/serverless"],
      vercel: ["@storyshelf/db", "@vercel/postgres"],
      pglite: ["@storyshelf/db", "@electric-sql/pglite"],
      mysql: ["@storyshelf/db", "mysql2"],
      planetscale: ["@storyshelf/db", "@planetscale/database"],
      tidb: ["@storyshelf/db", "@tidbcloud/serverless"],
    };
    for (const [database, [adapter, peer]] of Object.entries(adapters) as [
      Answers["database"],
      [string, string?],
    ][]) {
      const names = Object.keys(pkg({ database }).dependencies);
      expect(names).toContain(adapter);
      expect(names.filter((name) => !name.startsWith("@storyshelf/"))).toEqual(
        peer === undefined ? [] : [peer],
      );
    }
  });

  it("adds the storage package the scaffold imports; local comes from core", () => {
    const local = pkg({ storage: "local" }).dependencies;
    expect(local["@storyshelf/storage-local"]).toBeUndefined();
    expect(local["@storyshelf/core"]).toBeDefined();
    expect(pkg({ storage: "s3" }).dependencies["@storyshelf/storage"]).toBeDefined();
    expect(pkg({ storage: "s3" }).dependencies["@aws-sdk/client-s3"]).toBeDefined();
    expect(pkg({ storage: "azure" }).dependencies["@storyshelf/storage"]).toBeDefined();
    expect(pkg({ storage: "azure" }).dependencies["@azure/storage-blob"]).toBeDefined();
    expect(pkg({ storage: "gcs" }).dependencies["@storyshelf/storage"]).toBeDefined();
    expect(pkg({ storage: "gcs" }).dependencies["@google-cloud/storage"]).toBeDefined();
  });

  it("declares the auth package only when auth is on", () => {
    expect(pkg({ auth: "none" }).dependencies["@storyshelf/auth"]).toBeUndefined();
    expect(pkg({ auth: "password" }).dependencies["@storyshelf/auth"]).toBeDefined();
    expect(pkg({ auth: "oauth" }).dependencies["@storyshelf/auth"]).toBeDefined();
  });

  it("adds nodemailer only when SMTP is chosen", () => {
    expect(pkg({ notifications: true }).dependencies["nodemailer"]).toBeDefined();
    expect(pkg({ notifications: false, storage: "s3" }).dependencies["nodemailer"]).toBeUndefined();
  });

  it("always writes @storyshelf/core: it is a peer of every adapter, not pulled in transitively", () => {
    for (const storage of ["local", "s3"] as const) {
      expect(pkg({ storage, notifications: false }).dependencies["@storyshelf/core"]).toBe("0.3.2");
    }
  });

  it("writes every SDK at the range its owner declares in the version manifest", () => {
    const deps = pkg({ database: "turso", storage: "s3", notifications: true }).dependencies;
    expect(deps["@libsql/client"]).toBe(peerRange("@storyshelf/db", "@libsql/client"));
    expect(deps["@aws-sdk/lib-storage"]).toBe(
      peerRange("@storyshelf/storage", "@aws-sdk/lib-storage"),
    );
    expect(deps["nodemailer"]).toBe(peerRange("@storyshelf/core", "nodemailer"));
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

  it("forwards SHELF_SECRET, and SHELF_ADMIN_PASSWORD for password auth, from the shell to docker:run", () => {
    const open = pkg({ deployTarget: "docker", docker: true }).scripts["docker:run"];
    const password = pkg({ deployTarget: "docker", docker: true, auth: "password" }).scripts[
      "docker:run"
    ];
    expect(open).toMatch(/ -e SHELF_SECRET /u);
    expect(open).not.toContain("SHELF_ADMIN_PASSWORD");
    expect(password).toMatch(/ -e SHELF_SECRET -e SHELF_ADMIN_PASSWORD /u);
    expect(`${open} ${password}`).not.toMatch(/SHELF_SECRET=|change-me/u);
  });

  it("has compose scripts when the stack has more than one service", () => {
    const { scripts } = pkg({ deployTarget: "docker", docker: true, database: "postgres" });
    expect(scripts["docker:up"]).toBe("docker compose up --build");
    expect(scripts["docker:run"]).toBeUndefined();
  });

  it("has no docker scripts on a plain local server", () => {
    const keys = Object.keys(pkg().scripts).toSorted();
    expect(keys).toEqual(["dev", "start", "typecheck"]);
  });
});
