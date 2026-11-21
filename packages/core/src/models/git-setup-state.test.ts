import { describe, expect, it } from "vitest";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { GIT_SETUP_STATE_TTL_MS, GitSetupStateModel } from "./git-setup-state.ts";

const NOW = Date.parse("2026-11-20T12:00:00Z");

describe("GitSetupStateModel", () => {
  it("returns the payload once, to the session that started the flow", async () => {
    const { db } = makeDatabase();
    const model = new GitSetupStateModel(db);
    const state = await model.issue("session-a", { organization: "acme", comment: true }, NOW);
    expect(await model.peek(state, "session-a", NOW)).toEqual({
      organization: "acme",
      comment: true,
    });
    expect(await model.consume(state, "session-b", NOW)).toBeNull();
    expect(await model.consume(state, "session-a", NOW)).toEqual({
      organization: "acme",
      comment: true,
    });
    expect(await model.consume(state, "session-a", NOW)).toBeNull();
    expect(await model.peek(state, "session-a", NOW)).toBeNull();
  });

  it("stores neither the state nor the session in the clear", async () => {
    const { db } = makeDatabase();
    const state = await new GitSetupStateModel(db).issue("session-a", {}, NOW);
    const rows = await db.list(db.tables.siteSettings);
    expect(JSON.stringify(rows)).not.toContain(state);
    expect(JSON.stringify(rows)).not.toContain("session-a");
  });

  it("refuses a state after ten minutes, and a malformed or unknown one", async () => {
    const { db } = makeDatabase();
    const model = new GitSetupStateModel(db);
    const state = await model.issue("s", {}, NOW);
    expect(await model.peek(state, "s", NOW + GIT_SETUP_STATE_TTL_MS)).toBeNull();
    expect(await model.consume(state, "s", NOW + GIT_SETUP_STATE_TTL_MS)).toBeNull();
    expect(await model.consume("not a state", "s", NOW)).toBeNull();
    expect(await model.consume(`gss_${"x".repeat(32)}`, "s", NOW)).toBeNull();
  });

  it("lets only one of two racing posts spend a state", async () => {
    const { db } = makeDatabase();
    const model = new GitSetupStateModel(db);
    const state = await model.issue("s", { a: "1" }, NOW);
    const results = await Promise.all([
      model.consume(state, "s", NOW),
      model.consume(state, "s", NOW),
    ]);
    expect(results.filter((result) => result !== null)).toHaveLength(1);
  });

  it("prunes abandoned states when a new flow starts, and leaves other settings alone", async () => {
    const { db } = makeDatabase();
    const model = new GitSetupStateModel(db);
    await model.issue("s", {}, NOW);
    await db.insert(db.tables.siteSettings, {
      id: "public_origin",
      value: "https://shelf.example.com",
      updatedBy: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    });
    const fresh = await model.issue("s", {}, NOW + GIT_SETUP_STATE_TTL_MS + 1);
    const ids = (await db.list(db.tables.siteSettings)).map((row) => row.id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain("public_origin");
    expect(await model.peek(fresh, "s", NOW + GIT_SETUP_STATE_TTL_MS + 1)).toEqual({});
  });
});
