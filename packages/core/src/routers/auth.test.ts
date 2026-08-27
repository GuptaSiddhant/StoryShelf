import { describe, expect, it } from "vitest";

import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import { createShelfRouter } from "../index.tsx";

const dbFail = async (): Promise<never> => {
  return await Promise.reject(new Error("database not used in this test"));
};

const storageFail = async (): Promise<never> => {
  return await Promise.reject(new Error("storage not used in this test"));
};

function stubDatabase(): DatabaseAdapter {
  return {
    insert: dbFail,
    update: dbFail,
    get: dbFail,
    remove: dbFail,
    list: dbFail,
    count: dbFail,
    all: dbFail,
    migrate: dbFail,
    close: dbFail,
  };
}

function stubStorage(): StorageAdapter {
  return {
    read: storageFail,
    write: storageFail,
    delete: storageFail,
    exists: storageFail,
    list: storageFail,
  };
}

const admin = { id: "user_1", email: "ada@example.com", name: "Ada", role: "admin" as const };

const passwordAuth = {
  check: async (request: Request): Promise<typeof admin | null> => {
    await Promise.resolve();
    const cookie = request.headers.get("cookie") ?? "";
    return cookie.includes("storyshelf_session=ok") ? admin : null;
  },
  createSession: async (): Promise<string> => {
    await Promise.resolve();
    return "ok";
  },
  destroySession: async (): Promise<void> => {
    await Promise.resolve();
  },
  login: async (password: string): Promise<string> => {
    await Promise.resolve();
    if (password !== "hunter2") {
      throw new Error("Invalid password");
    }
    return "ok";
  },
};

function app(): ReturnType<typeof createShelfRouter> {
  return createShelfRouter({
    database: stubDatabase(),
    storage: stubStorage(),
    auth: passwordAuth,
  });
}

describe("ui auth gate", () => {
  it("redirects unauthenticated HTML requests to /auth/login", async () => {
    const response = await app().request("/");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/auth/login");
  });

  it("lets authenticated users through to the UI", async () => {
    const response = await app().request("/", { headers: { cookie: "storyshelf_session=ok" } });
    expect(response.status).toBe(200);
  });

  it("does not gate API routes", async () => {
    const response = await app().request("/api/v1/projects");
    expect(response.status).not.toBe(302);
  });
});

describe("auth routes", () => {
  it("renders the login page", async () => {
    const response = await app().request("/auth/login");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Sign in");
  });

  it("rejects a wrong password", async () => {
    const form = new FormData();
    form.set("password", "wrong");
    const response = await app().request("/auth/login", { method: "POST", body: form });
    expect(response.status).toBe(401);
  });

  it("sets a session cookie on success", async () => {
    const form = new FormData();
    form.set("password", "hunter2");
    const response = await app().request("/auth/login", { method: "POST", body: form });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("set-cookie")).toContain("storyshelf_session=ok");
  });

  it("clears the session cookie on logout", async () => {
    const response = await app().request("/auth/logout", { method: "POST" });
    expect(response.status).toBe(302);
    expect(response.headers.get("set-cookie")).toContain("storyshelf_session=;");
  });
});