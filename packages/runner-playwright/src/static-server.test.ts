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
      expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
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
      expect(js.headers.get("content-type")).toContain("javascript");
      expect(js.headers.get("cache-control")).toBe("public, max-age=3600");
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
      expect(res.headers.get("cache-control")).toBeNull();
    } finally {
      await server.close();
    }
  });

  it("does not compress by default, even when gzip is accepted", async () => {
    const server = await createStaticServer(dir);
    try {
      const res = await fetch(`${server.url}/app.js`, { headers: { "accept-encoding": "gzip" } });
      expect(res.headers.get("content-encoding")).toBeNull();
      expect(res.headers.get("vary")).toBeNull();
    } finally {
      await server.close();
    }
  });

  it("negotiates gzip for compressible assets and respects an explicit refusal", async () => {
    writeFileSync(join(dir, "large.js"), "let a = 1;\n".repeat(100));
    const server = await createStaticServer(dir, { compression: true });
    try {
      const compressed = await fetch(`${server.url}/large.js`, {
        headers: { "accept-encoding": "gzip" },
      });
      expect(compressed.headers.get("content-encoding")).toBe("gzip");
      expect(compressed.headers.get("vary")).toBe("Accept-Encoding");
      expect(await compressed.text()).toBe("let a = 1;\n".repeat(100));
      const plain = await fetch(`${server.url}/large.js`, {
        headers: { "accept-encoding": "gzip;q=0, *;q=1" },
      });
      expect(plain.headers.get("content-encoding")).toBeNull();
      expect(plain.headers.get("vary")).toBe("Accept-Encoding");
    } finally {
      await server.close();
    }
  });

  it("serves concurrent gzip requests for the same asset", async () => {
    const body = "const repeated = 123;\n".repeat(1000);
    writeFileSync(join(dir, "concurrent.js"), body);
    const server = await createStaticServer(dir, { compression: true });
    try {
      const replies = await Promise.all(
        Array.from({ length: 8 }, async () => {
          const res = await fetch(`${server.url}/concurrent.js`, {
            headers: { "accept-encoding": "gzip" },
          });
          return { encoding: res.headers.get("content-encoding"), body: await res.text() };
        }),
      );
      expect(replies).toEqual(Array.from({ length: 8 }, () => ({ encoding: "gzip", body })));
    } finally {
      await server.close();
    }
  });

  it("bounds the compression cache and falls back to uncompressed files", async () => {
    for (let index = 0; index < 9; index += 1)
      writeFileSync(join(dir, `${index}.js`), "x".repeat(512 * 1024));
    const server = await createStaticServer(dir, { compression: true });
    try {
      for (let index = 0; index < 9; index += 1) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- fill the cache in a known order
        const res = await fetch(`${server.url}/${index}.js`, {
          headers: { "accept-encoding": "gzip" },
        });
        expect(res.headers.get("content-encoding")).toBe(index < 8 ? "gzip" : null);
        // oxlint-disable-next-line eslint/no-await-in-loop -- consume each response before the next
        await res.arrayBuffer();
      }
    } finally {
      await server.close();
    }
  });

  it("leaves oversized and binary assets uncompressed", async () => {
    writeFileSync(join(dir, "oversized.js"), "x".repeat(512 * 1024 + 1));
    writeFileSync(join(dir, "image.png"), Buffer.alloc(128, 1));
    const server = await createStaticServer(dir, { compression: true });
    try {
      for (const name of ["oversized.js", "image.png"]) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- consume each response before the next
        const res = await fetch(`${server.url}/${name}`, {
          headers: { "accept-encoding": "gzip" },
        });
        expect(res.headers.get("content-encoding")).toBeNull();
        // oxlint-disable-next-line eslint/no-await-in-loop -- consume each response before the next
        await res.arrayBuffer();
      }
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
