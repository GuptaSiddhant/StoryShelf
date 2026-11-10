import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createShelfApp } from "../index.tsx";
import { stubRunner } from "../test-runner.ts";

/** One sample refusal per router; `status` is what each answered before the envelope, unchanged. */
interface Sample {
  name: string;
  method: string;
  path: (slug: string) => string;
  body?: unknown;
  status: number;
  message?: string;
}

const SAMPLES: Sample[] = [
  { name: "projects: unknown project", method: "GET", path: () => "/projects/nope", status: 404 },
  {
    name: "projects: invalid body",
    method: "POST",
    path: () => "/projects",
    body: {},
    status: 400,
    message: "name:",
  },
  {
    name: "builds: unknown build",
    method: "GET",
    path: (slug) => `/projects/${slug}/builds/nope`,
    status: 404,
    message: "Build not found",
  },
  {
    name: "snapshots: unknown build",
    method: "GET",
    path: (slug) => `/projects/${slug}/builds/nope/snapshots`,
    status: 404,
  },
  {
    name: "labels: reserved key",
    method: "DELETE",
    path: (slug) => `/projects/${slug}/label-types/persistent`,
    status: 400,
    message: "Label type 'persistent' cannot be removed.",
  },
  {
    name: "unknown API path",
    method: "GET",
    path: () => "/nowhere",
    status: 404,
    message: "Not found",
  },
];

/** Every app a test booted: each is torn down after the test, also when an assertion failed. */
const booted: ReturnType<typeof createShelfApp>[] = [];

afterEach(async () => {
  await Promise.all(booted.splice(0).map(async (app) => await app.lifecycle.teardown()));
});

function boot() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }) as never,
    testing: { runner: stubRunner() },
  });
  booted.push(app);
  const call = async (method: string, path: string, body?: unknown): Promise<Response> =>
    await app.request(path, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined
        ? {}
        : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
  return { app, call };
}

async function createProject(call: ReturnType<typeof boot>["call"]): Promise<string> {
  const created = await call("POST", "/api/v1/projects", { name: "Envelope" });
  return ((await created.json()) as { slug: string }).slug;
}

describe("every /api/v1 refusal answers { error: { message } }", () => {
  for (const sample of SAMPLES) {
    it(`${sample.name} (${sample.status})`, async () => {
      const { call } = boot();
      const slug = await createProject(call);

      const res = await call(sample.method, `/api/v1${sample.path(slug)}`, sample.body);

      expect(res.status).toBe(sample.status);
      expect(res.headers.get("content-type")).toContain("application/json");
      const body = (await res.json()) as { error: { message: string } };
      expect(Object.keys(body)).toEqual(["error"]);
      expect(typeof body.error.message).toBe("string");
      expect(body.error.message).toContain(sample.message ?? "");
      expect(body.error.message.length).toBeGreaterThan(0);
    });
  }

  it("a duplicate label type answers 409 in the envelope", async () => {
    const { call } = boot();
    const slug = await createProject(call);
    const path = `/api/v1/projects/${slug}/label-types`;
    expect((await call("POST", path, { key: "team", name: "Team" })).status).toBe(201);

    const res = await call("POST", path, { key: "team", name: "Team" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { message: "A label type with the key 'team' already exists." },
    });
  });

  it("a malformed JSON body answers 400 in the envelope", async () => {
    const { call } = boot();

    const res = await call("POST", "/api/v1/projects", "{bad");

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(typeof body.error.message).toBe("string");
  });

  it("pages keep their own answers: text for a missing page", async () => {
    const { call } = boot();

    const res = await call("GET", "/nowhere");

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("404 Not Found");
  });
});
