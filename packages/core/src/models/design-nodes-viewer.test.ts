import { describe, expect, it } from "vitest";
import { makeDatabase, makeStorage } from "../test-helpers/fake-adapters.ts";
import { fakeUrl, makeFakeDesign } from "../test-helpers/fake-design.ts";
import { makeFakeOAuth } from "../test-helpers/fake-oauth.ts";
import { ConnectionModel } from "./connections.ts";
import { DesignCredentialModel } from "./design-credentials.ts";
import { DesignNodeModel } from "./design-nodes.ts";

const NODE = fakeUrl("KEY", "1:2");
const SECRET = "secret-0000000000";

async function setup(options: { projectToken?: boolean } = {}) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const fake = makeFakeDesign();
  const oauth = makeFakeOAuth();
  const provider = { ...fake.provider, oauth: oauth.client };
  const credentials = new DesignCredentialModel(db, SECRET);
  const connections = new ConnectionModel(db, SECRET);
  if (options.projectToken) await credentials.set("p1", "fake", "project-tok");
  const nodes = new DesignNodeModel(db, credentials, [provider], { storage, connections });
  return { fake, oauth, nodes, connections };
}

describe("DesignNodeModel with member connections", () => {
  it("fetches with the viewer's own connection when the project has no credential", async () => {
    const { fake, nodes, connections } = await setup();
    await connections.connect("ada", "fake", { accessToken: "ada-at", expiresAt: null });
    const row = await nodes.refresh("p1", NODE, undefined, "ada");
    expect(fake.credentials).toEqual(["ada-at"]);
    expect(fake.authTypes).toEqual(["oauth"]);
    expect(row).toMatchObject({ viewerId: "ada", state: "ok" });
  });

  it("prefers the project credential over a member's connection", async () => {
    const { fake, nodes, connections } = await setup({ projectToken: true });
    await connections.connect("ada", "fake", { accessToken: "ada-at", expiresAt: null });
    const row = await nodes.refresh("p1", NODE, undefined, "ada");
    expect(fake.credentials).toEqual(["project-tok"]);
    expect(fake.authTypes).toEqual(["token"]);
    expect(row?.viewerId).toBe("");
  });

  it("never serves one member's entries to another member or an anonymous viewer", async () => {
    const { fake, nodes, connections } = await setup();
    await connections.connect("ada", "fake", { accessToken: "ada-at", expiresAt: null });
    await nodes.refresh("p1", NODE, undefined, "ada");
    expect((await nodes.cachedFor("p1", [NODE], "ada")).size).toBe(1);
    expect((await nodes.cachedFor("p1", [NODE], "bob")).size).toBe(0);
    expect((await nodes.cachedFor("p1", [NODE])).size).toBe(0);
    await nodes.refresh("p1", NODE, undefined, "bob");
    expect(fake.metaCalls).toHaveLength(1);
  });

  it("keeps separate rows per member and renders under the member's own storage path", async () => {
    const { nodes, connections } = await setup();
    await connections.connect("ada", "fake", { accessToken: "ada-at", expiresAt: null });
    await connections.connect("bob", "fake", { accessToken: "bob-at", expiresAt: null });
    const ada = await nodes.refresh("p1", NODE, undefined, "ada");
    const bob = await nodes.refresh("p1", NODE, undefined, "bob");
    expect(ada?.id).not.toBe(bob?.id);
    expect(ada?.renderPath).toContain("/user-ada/");
    expect(bob?.renderPath).toContain("/user-bob/");
  });

  it("fetches nothing for a viewer without a connection, and when the connection expired", async () => {
    const { fake, oauth, nodes, connections } = await setup();
    oauth.failRefresh = true;
    expect(await nodes.refresh("p1", NODE, undefined, "ada")).toBeNull();
    await connections.connect("bob", "fake", {
      accessToken: "bob-at",
      refreshToken: "rt",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(await nodes.refresh("p1", NODE, undefined, "bob")).toBeNull();
    expect(fake.metaCalls).toHaveLength(0);
  });
});
