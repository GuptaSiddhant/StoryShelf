import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";

type App = ReturnType<typeof createShelfApp>;

async function setup(): Promise<App> {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const now = new Date().toISOString();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "Docs",
    slug: "docs",
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: now,
    updatedAt: now,
  });
  return createShelfApp({ database: db, storage, logger: pino({ level: "silent" }) });
}

async function post(app: App, path: string, body: Record<string, string> = {}): Promise<Response> {
  return await app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-csrf-token": getCsrfToken(),
      "hx-request": "true",
    },
    body: new URLSearchParams(body).toString(),
  });
}

function flashOf(response: Response): { message: string; tone: string } | null {
  const raw = /storyshelf_flash=([^;]+)/u.exec(response.headers.get("set-cookie") ?? "")?.[1];
  return raw ? (JSON.parse(decodeURIComponent(raw)) as { message: string; tone: string }) : null;
}

describe("form success toasts", () => {
  it("flashes after saving general settings", async () => {
    const app = await setup();
    const response = await post(app, "/projects/docs/settings", { name: "Docs" });
    expect(flashOf(response)?.message).toBe("Project settings saved");
  });

  it("flashes after creating a project", async () => {
    const app = await setup();
    const response = await post(app, "/projects/new", { name: "Fresh" });
    expect(flashOf(response)?.message).toBe("Created Fresh");
  });

  it("flashes after creating a label type", async () => {
    const app = await setup();
    const response = await post(app, "/projects/docs/settings/labels", {
      key: "ticket",
      labelName: "Ticket",
    });
    expect(flashOf(response)?.message).toBe("Label type added");
  });

  it("tells the user a created token is shown only once", async () => {
    const app = await setup();
    const response = await post(app, "/projects/docs/settings/tokens", { tokenName: "ci" });
    expect(flashOf(response)?.message).toContain("shown once");
  });

  it("does NOT flash when validation fails", async () => {
    const app = await setup();
    const tokens = await post(app, "/projects/docs/settings/tokens", {});
    const labels = await post(app, "/projects/docs/settings/labels", {});
    expect(tokens.status).toBe(400);
    expect(labels.status).toBe(400);
    expect(flashOf(tokens)).toBeNull();
    expect(flashOf(labels)).toBeNull();
  });

  it("returns the validation page (not an empty error) so it can be swapped in", async () => {
    const app = await setup();
    const response = await post(app, "/projects/docs/settings/tokens", {});
    expect(await response.text()).toContain("Name is required");
  });
});
