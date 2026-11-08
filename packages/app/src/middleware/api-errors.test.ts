import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";
import {
  apiErrorResponse,
  errorBody,
  isApiPath,
  jsonRefusal,
  mountErrorHandlers,
  validationMessage,
} from "./api-errors.ts";

function logger() {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
}

function build(log = logger()) {
  const app = new Hono();
  app.get("/api/v1/refuse", () => {
    throw new HTTPException(409, { message: "Already there" });
  });
  app.get("/api/v1/boom", () => {
    throw new Error("secret detail: db password");
  });
  app.get("/api/v1/own-json", () => {
    throw new HTTPException(409, {
      res: Response.json({ error: { code: "x", message: "Own body" } }, { status: 409 }),
    });
  });
  app.get("/api/v1/guard", (c) => jsonRefusal(c, 429, "Slow down", { retry: 1 }));
  app.get("/page/refuse", () => {
    throw new HTTPException(400, { message: "Page refusal" });
  });
  app.get("/page/boom", () => {
    throw new Error("secret detail");
  });
  app.get("/page/guard", (c) => jsonRefusal(c, 429, "Slow down", { retry: 1 }));
  mountErrorHandlers(app, log as never);
  return { app, log };
}

describe("isApiPath", () => {
  it("matches the API and below, not a sibling", () => {
    expect(isApiPath("/api/v1")).toBe(true);
    expect(isApiPath("/api/v1/projects")).toBe(true);
    expect(isApiPath("/api/v10/projects")).toBe(false);
    expect(isApiPath("/api/auth/sign-in")).toBe(false);
    expect(isApiPath("/projects")).toBe(false);
  });
});

describe("mountErrorHandlers", () => {
  it("answers a refusal on the API as the JSON envelope with its own status", async () => {
    const { app } = build();
    const res = await app.request("/api/v1/refuse");
    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: { message: "Already there" } });
  });

  it("keeps a JSON body an exception brings, so a route can add fields to error", async () => {
    const { app } = build();
    const res = await app.request("/api/v1/own-json");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "x", message: "Own body" } });
  });

  it("answers an unexpected error with a generic message and logs the cause", async () => {
    const { app, log } = build();
    const res = await app.request("/api/v1/boom");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: { message: "Internal Server Error" } });
    expect(text).not.toContain("password");
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0]?.[0]).toMatchObject({ err: expect.any(Error) });
  });

  it("answers an unknown API path with the JSON 404", async () => {
    const { app } = build();
    const res = await app.request("/api/v1/nowhere");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { message: "Not found" } });
  });

  it("leaves an HTMX request to an API route with the answers it always had", async () => {
    const { app } = build();
    const hx = { headers: { "HX-Request": "true" } };
    const refused = await app.request("/api/v1/refuse", hx);
    expect(refused.status).toBe(409);
    expect(await refused.text()).toBe("Already there");
    const missing = await app.request("/api/v1/nowhere", hx);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("404 Not Found");
    const broken = await app.request("/api/v1/boom", hx);
    expect(broken.status).toBe(500);
    expect(await broken.text()).toBe("Internal Server Error");
    const guard = await app.request("/api/v1/guard", hx);
    expect(await guard.json()).toEqual({ error: "Slow down", retry: 1 });
  });

  it("leaves pages alone: Hono's text answers", async () => {
    const { app } = build();
    const missing = await app.request("/nowhere");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("404 Not Found");
    const refused = await app.request("/page/refuse");
    expect(refused.status).toBe(400);
    expect(await refused.text()).toBe("Page refusal");
    const broken = await app.request("/page/boom");
    expect(broken.status).toBe(500);
    expect(await broken.text()).toBe("Internal Server Error");
  });
});

describe("jsonRefusal", () => {
  it("uses the envelope on the API, with extra fields next to the message", async () => {
    const { app } = build();
    const res = await app.request("/api/v1/guard");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: { message: "Slow down", retry: 1 } });
  });

  it("keeps the flat shape elsewhere", async () => {
    const { app } = build();
    const res = await app.request("/page/guard");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Slow down", retry: 1 });
  });
});

describe("helpers", () => {
  it("builds the envelope", () => {
    expect(errorBody("No")).toEqual({ error: { message: "No" } });
  });

  it("answers with extra fields", async () => {
    const app = new Hono();
    app.get("/", (c) => apiErrorResponse(c, 503, "Down", { failures: [1] }));
    const res = await app.request("/");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: { message: "Down", failures: [1] } });
  });

  it("describes a failed validation in one line", () => {
    expect(
      validationMessage([
        { path: ["name"], message: "Required" },
        { path: ["a", 0, "b"], message: "Too short" },
        { path: [], message: "Bad body" },
      ]),
    ).toBe("name: Required; a.0.b: Too short; Bad body");
    expect(validationMessage([])).toBe("Invalid request");
  });
});
