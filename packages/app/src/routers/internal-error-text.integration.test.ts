import { LabelModel, ProjectModel, SiteSettingsModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { UserFacingError } from "@storyshelf/core/utils";
import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { stubRunner } from "../test-runner.ts";

/** What a driver says when a write fails: internal text no client should ever read. */
const INTERNAL = "SQLITE_CONSTRAINT: UNIQUE constraint failed: projects.slug (/var/data/shelf.db)";

interface LogLine {
  msg: string;
  err?: { message?: string };
}

function boot() {
  const logged: LogLine[] = [];
  const logger = pino(
    { level: "info" },
    { write: (line: string) => logged.push(JSON.parse(line) as LogLine) },
  );
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const app = createShelfApp({
    database: db,
    storage,
    logger: logger as never,
    testing: { runner: stubRunner() },
    // No notifier: boot tasks would otherwise prime the public-origin cache and bypass the mocks.
    notifications: { notifiers: false },
  });
  const json = async (method: string, path: string, body?: unknown) =>
    await app.request(`/api/v1${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const form = async (path: string, fields: Record<string, string>) =>
    await app.request(path, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": getCsrfToken(),
      },
      body: new URLSearchParams(fields).toString(),
    });
  const createProject = async (name: string): Promise<string> =>
    ((await (await json("POST", "/projects", { name })).json()) as { slug: string }).slug;
  return { logged, json, form, createProject };
}

/** The original failure is in the log, as `err`, and nowhere in the response. */
function expectLogged(logged: LogLine[]): void {
  expect(logged.some((line) => line.err?.message?.includes("SQLITE_CONSTRAINT"))).toBe(true);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a failure inside a handler never sends its text to the client", () => {
  it("project settings: a database failure answers the generic text and logs the original", async () => {
    const { logged, form, createProject } = boot();
    const slug = await createProject("Settings");
    vi.spyOn(ProjectModel.prototype, "update").mockRejectedValue(new Error(INTERNAL));

    const response = await form(`/projects/${slug}/settings`, { name: "Renamed" });
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toContain("Failed to update");
    expect(body).not.toContain("SQLITE_CONSTRAINT");
    expect(body).not.toContain("shelf.db");
    expectLogged(logged);
  });

  it("test settings: a database failure answers the generic text and logs the original", async () => {
    const { logged, form, createProject } = boot();
    const slug = await createProject("Tests tab");
    vi.spyOn(ProjectModel.prototype, "update").mockRejectedValue(new Error(INTERNAL));

    const response = await form(`/projects/${slug}/settings/tests`, { playTimeoutMs: "10000" });
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toContain("Failed to update");
    expect(body).not.toContain("SQLITE_CONSTRAINT");
    expectLogged(logged);
  });

  it("creating a project from the form: a database failure answers the generic text", async () => {
    const { logged, form } = boot();
    vi.spyOn(ProjectModel.prototype, "create").mockRejectedValue(new Error(INTERNAL));

    const response = await form("/projects/new", { name: "Fresh" });
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toContain("Failed to create project");
    expect(body).not.toContain("SQLITE_CONSTRAINT");
    expectLogged(logged);
  });

  it("adding a label type: a database failure answers the generic text", async () => {
    const { logged, form, createProject } = boot();
    const slug = await createProject("Labels");
    vi.spyOn(LabelModel.prototype, "createType").mockRejectedValue(new Error(INTERNAL));

    const response = await form(`/projects/${slug}/settings/labels`, { key: "jira", name: "Jira" });
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toContain("Failed to create label");
    expect(body).not.toContain("SQLITE_CONSTRAINT");
    expectLogged(logged);
  });

  it("saving a label type: a database failure answers the generic text", async () => {
    const { logged, form, createProject } = boot();
    const slug = await createProject("Label edit");
    vi.spyOn(LabelModel.prototype, "updateType").mockRejectedValue(new Error(INTERNAL));

    const response = await form(`/projects/${slug}/settings/labels/jira`, { labelName: "Jira" });
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toContain("Failed to update label");
    expect(body).not.toContain("SQLITE_CONSTRAINT");
    expectLogged(logged);
  });

  it("the label API: a database failure answers a 400 with the generic text", async () => {
    const { logged, json, createProject } = boot();
    const slug = await createProject("Label api");
    vi.spyOn(LabelModel.prototype, "updateType").mockRejectedValue(new Error(INTERNAL));

    const response = await json("PATCH", `/projects/${slug}/label-types/jira`, { name: "Jira" });
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toContain("Cannot update label type");
    expect(body).not.toContain("SQLITE_CONSTRAINT");
    expectLogged(logged);
  });
});

describe("a failure reading the offered capture targets", () => {
  it("is still a 400, with generic text, and the original is logged", async () => {
    const { logged, json, createProject } = boot();
    const slug = await createProject("Targets");
    vi.spyOn(SiteSettingsModel.prototype, "get").mockRejectedValue(new Error(INTERNAL));

    const response = await json("PATCH", `/projects/${slug}`, { browser: "chromium" });
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toContain("Refused");
    expect(body).not.toContain("SQLITE_CONSTRAINT");
    expectLogged(logged);
  });
});

describe("a refusal the code meant to show still reaches the client", () => {
  it("adding a label type with a key the project has says so", async () => {
    const { form, createProject } = boot();
    const slug = await createProject("Duplicate");
    await form(`/projects/${slug}/settings/labels`, { key: "jira", name: "Jira" });

    const response = await form(`/projects/${slug}/settings/labels`, {
      key: "jira",
      name: "Again",
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("A label type with the key");
  });

  it("saving a reserved label type says it cannot be updated, in the form and the API", async () => {
    const { form, json, createProject } = boot();
    const slug = await createProject("Reserved");

    const page = await form(`/projects/${slug}/settings/labels/persistent`, { labelName: "X" });
    expect(page.status).toBe(400);
    expect(await page.text()).toContain("cannot be updated");

    const api = await json("PATCH", `/projects/${slug}/label-types/persistent`, { name: "X" });
    expect(api.status).toBe(400);
    expect(await api.text()).toContain("cannot be updated");
  });

  it("an HTTP refusal (an invalid capture target) is shown as it is", async () => {
    const { form, createProject } = boot();
    const slug = await createProject("Browser");

    const response = await form(`/projects/${slug}/settings`, {
      name: "Browser",
      browser: "netscape",
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Invalid capture target");
  });

  it("a UserFacingError thrown by the model is shown as it is", async () => {
    const { form, createProject } = boot();
    const slug = await createProject("Shown");
    vi.spyOn(ProjectModel.prototype, "update").mockRejectedValue(
      new UserFacingError("That name is taken"),
    );

    const response = await form(`/projects/${slug}/settings`, { name: "Taken" });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("That name is taken");
  });
});
