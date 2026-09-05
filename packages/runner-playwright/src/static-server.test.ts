import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStaticServer } from "./static-server.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-static-"));
  writeFileSync(join(dir, "index.html"), "<html>storybook</html>");
  writeFileSync(join(dir, "app.js"), "console.log(1)");
  writeFileSync(join(dir, "data.json"), "{}");
  mkdirSync(join(dir, "nested"), { recursive: true });
  writeFileSync(join(dir, "nested", "index.html"), "<html>nested</html>");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("createStaticServer", () => {
  it("serves index.html at the root with the html mime type", async () => {
    const server = await createStaticServer(dir);
    try {
      const res = await fetch(`${server.url}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      await expect(res.text()).resolves.toContain("storybook");
    } finally {
      await server.close();
    }
  });

  it("serves assets with mapped mime types", async () => {
    const server = await createStaticServer(dir);
    try {
      const js = await fetch(`${server.url}/app.js`);
      expect(js.status).toBe(200);
      expect(js.headers.get("content-type")).toContain("text/javascript");
      const json = await fetch(`${server.url}/data.json`);
      expect(json.headers.get("content-type")).toContain("application/json");
    } finally {
      await server.close();
    }
  });

  it("resolves directories to their index.html", async () => {
    const server = await createStaticServer(dir);
    try {
      const res = await fetch(`${server.url}/nested`);
      expect(res.status).toBe(200);
      await expect(res.text()).resolves.toContain("nested");
    } finally {
      await server.close();
    }
  });

  it("returns 404 for missing files", async () => {
    const server = await createStaticServer(dir);
    try {
      const res = await fetch(`${server.url}/nope.html`);
      expect(res.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("blocks path traversal outside the root", async () => {
    const server = await createStaticServer(dir);
    try {
      const res = await fetch(`${server.url}/..%2F..%2Fetc%2Fpasswd`);
      expect(res.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("throws for a missing root directory", async () => {
    await expect(createStaticServer(join(dir, "missing"))).rejects.toThrow(
      "Storybook directory not found",
    );
  });
});
