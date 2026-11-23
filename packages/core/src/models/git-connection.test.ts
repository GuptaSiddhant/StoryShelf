import { describe, expect, it } from "vitest";
import { githubApp, gitlabGroup } from "../integrations/git/connections/define.ts";
import { TEST_PRIVATE_KEY } from "../integrations/git/test-key.ts";
import type { GitConnectionRow } from "../schema/git-connection.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { UndecryptableCredentialError } from "../utils/encrypt.ts";
import { probeCredentials } from "./credentials.ts";
import { GitConnectionModel } from "./git-connection.ts";
import { ManagedGitConnectionError } from "./managed-git-connection-error.ts";

const SECRET = "server-secret-for-tests-0123456789";
const KEY_BODY = TEST_PRIVATE_KEY.split("\n")[1] ?? "";

const INPUT = {
  provider: "github-app" as const,
  name: "Acme App",
  config: { appId: "42" },
  secret: TEST_PRIVATE_KEY,
  createdBy: "u1",
};

describe("GitConnectionModel", () => {
  it("stores a connection with its secret encrypted, and never returns it", async () => {
    const { db } = makeDatabase();
    const model = new GitConnectionModel(db, SECRET);
    const created = await model.create(INPUT);
    expect(created).toMatchObject({
      provider: "github-app",
      name: "Acme App",
      apiBase: null,
      config: { appId: "42" },
      state: "active",
      managed: false,
      ignored: false,
      createdBy: "u1",
    });
    expect(created).not.toHaveProperty("secretEncrypted");
    expect(JSON.stringify(await model.list())).not.toContain(KEY_BODY);
    const row = (await db.get(db.tables.gitConnections, created.id)) as unknown as GitConnectionRow;
    expect(row.secretEncrypted).not.toContain(KEY_BODY);
    expect(await model.secretOf(created.id)).toBe(TEST_PRIVATE_KEY);
    expect((await probeCredentials(db, { current: SECRET })).current).toBe(1);
  });

  it("reads one connection, and null for an unknown id", async () => {
    const { db } = makeDatabase();
    const model = new GitConnectionModel(db, SECRET);
    const created = await model.create({ ...INPUT, apiBase: "https://ghes.example.com/api/v3" });
    await expect(model.get(created.id)).resolves.toMatchObject({
      apiBase: "https://ghes.example.com/api/v3",
    });
    await expect(model.get("missing")).resolves.toBeNull();
    await expect(model.secretOf("missing")).resolves.toBeNull();
  });

  it("rotates a stored secret and merges new non-secret config", async () => {
    const { db } = makeDatabase();
    const model = new GitConnectionModel(db, SECRET);
    const created = await model.create({
      provider: "gitlab-token",
      name: "Lab",
      apiBase: "https://gitlab.com",
      config: { expiresOn: "2026-12-01", ceiling: "all" },
      secret: "glpat-old",
    });
    const rotated = await model.rotate(created.id, "glpat-new", { expiresOn: "2027-12-01" });
    expect(rotated?.config).toEqual({ expiresOn: "2027-12-01", ceiling: "all" });
    expect(await model.secretOf(created.id)).toBe("glpat-new");
    await expect(model.rotate("missing", "x")).resolves.toBeNull();
  });

  it("removes a stored connection", async () => {
    const { db } = makeDatabase();
    const model = new GitConnectionModel(db, SECRET);
    const created = await model.create(INPUT);
    await model.remove(created.id);
    await expect(model.get(created.id)).resolves.toBeNull();
  });

  it("shows configured connections as managed, and they win over a stored row with their id", async () => {
    const { db } = makeDatabase();
    const configured = [
      githubApp({ id: "acme", appId: 7, privateKey: TEST_PRIVATE_KEY }),
      gitlabGroup({
        id: "lab",
        host: "https://gitlab.com",
        token: "glpat-c",
        expiresOn: "2027-01-01",
      }),
    ];
    const now = new Date().toISOString();
    await db.insert(db.tables.gitConnections, {
      id: "acme",
      provider: "github-app",
      name: "Stored twin",
      apiBase: null,
      config: "{}",
      secretEncrypted: null,
      createdBy: null,
      state: "active",
      createdAt: now,
      updatedAt: now,
    });
    const model = new GitConnectionModel(db, SECRET, configured);
    const list = await model.list();
    expect(list.map((c) => [c.id, c.name, c.managed, c.ignored])).toEqual([
      ["acme", "GitHub App", true, false],
      ["lab", "GitLab", true, false],
      ["acme", "Stored twin", false, true],
    ]);
    await expect(model.get("acme")).resolves.toMatchObject({
      managed: true,
      config: { appId: "7" },
    });
    expect(await model.secretOf("acme")).toBe(TEST_PRIVATE_KEY.trim());
    expect(await model.secretOf("lab")).toBe("glpat-c");
    expect(JSON.stringify(list)).not.toContain("glpat-c");
  });

  it("refuses to rotate or remove a managed connection", async () => {
    const { db } = makeDatabase();
    const configured = [githubApp({ id: "acme", appId: 7, privateKey: TEST_PRIVATE_KEY })];
    const model = new GitConnectionModel(db, SECRET, configured);
    await expect(model.rotate("acme", "x")).rejects.toThrow(ManagedGitConnectionError);
    await expect(model.remove("acme")).rejects.toThrow(/managed by configuration/u);
  });

  it("fails with the credential error, never the ciphertext, under a wrong SECRET", async () => {
    const { db } = makeDatabase();
    const created = await new GitConnectionModel(db, SECRET).create(INPUT);
    const other = new GitConnectionModel(db, "another-secret-0123456789abcdef");
    await expect(other.secretOf(created.id)).rejects.toThrow(UndecryptableCredentialError);
  });
});
