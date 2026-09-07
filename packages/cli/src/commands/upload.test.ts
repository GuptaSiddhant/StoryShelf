import AdmZip from "adm-zip";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runUpload } from "./upload.ts";

let dir: string;

function baseOptions(): {
  url: string;
  slug: string;
  token: string;
  sha: string;
  branch: string;
  cwd: string;
} {
  return {
    url: "https://shelf.example.com",
    slug: "demo",
    token: "ci-token",
    sha: "abc123",
    branch: "main",
    cwd: dir,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-cli-upload-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe("runUpload validation", () => {
  function throwsWithout(field: string, partial: Record<string, string>, message: string): void {
    it(`throws without ${field}`, async () => {
      await expect(runUpload({ ...partial, cwd: dir })).rejects.toThrow(message);
    });
  }
  const cases: { field: string; partial: Record<string, string>; message: string }[] = [
    {
      field: "url",
      partial: { slug: "demo", token: "t", sha: "s", branch: "b" },
      message: "--url is required",
    },
    {
      field: "slug",
      partial: { url: "u", token: "t", sha: "s", branch: "b" },
      message: "--slug is required",
    },
    {
      field: "token",
      partial: { url: "u", slug: "s", sha: "s", branch: "b" },
      message: "--token is required",
    },
    {
      field: "sha",
      partial: { url: "u", slug: "s", token: "t", branch: "b" },
      message: "--sha is required",
    },
    {
      field: "branch",
      partial: { url: "u", slug: "s", token: "t", sha: "s" },
      message: "--branch is required",
    },
  ];
  for (const { field, partial, message } of cases) {
    throwsWithout(field, partial, message);
  }

  it("skips silently when the branch matches skip", async () => {
    const fetched = vi.fn(async (): Promise<{ ok: boolean; json: () => Promise<unknown> }> => {
      await Promise.resolve();
      return {
        ok: true,
        json: async (): Promise<unknown> => {
          await Promise.resolve();
          return { id: "b1" };
        },
      };
    });
    vi.stubGlobal("fetch", fetched);
    await runUpload({ ...baseOptions(), branch: "dependabot/npm", skip: "dependabot/*" });
    expect(fetched).not.toHaveBeenCalled();
  });
});

describe("runUpload success", () => {
  function writeFixture(): void {
    const buildDir = join(dir, "storybook-static");
    mkdirSync(buildDir, { recursive: true });
    writeFileSync(join(buildDir, "index.json"), JSON.stringify({ v: 5, entries: {} }));
    writeFileSync(join(buildDir, "iframe.html"), "<html></html>");
  }

  it("posts JSON metadata then streams the zip with PUT", async () => {
    writeFixture();
    const calls: { method: string; url: string; contentType: string | null }[] = [];
    let putBytes: Buffer = Buffer.alloc(0);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        await Promise.resolve();
        const headers = new Headers(init?.headers);
        calls.push({
          method: init?.method ?? "GET",
          url,
          contentType: headers.get("content-type"),
        });
        if ((init?.method ?? "") === "PUT") {
          putBytes = await collectBody(init?.body);
          return okJson({ id: "b1" });
        }
        return okJson({ build: { id: "b1" }, uploadUrl: "/api/v1/projects/demo/builds/b1/zip" });
      }),
    );

    await runUpload({ ...baseOptions(), buildDir: "storybook-static", label: ["pr=123"] });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ method: "POST", contentType: "application/json" });
    expect(calls[1]).toMatchObject({
      method: "PUT",
      url: "https://shelf.example.com/api/v1/projects/demo/builds/b1/zip",
      contentType: "application/zip",
    });
    const zip = new AdmZip(putBytes);
    expect(
      zip
        .getEntries()
        .map((entry) => entry.entryName)
        .toSorted(),
    ).toEqual(["iframe.html", "index.json"]);
  });

  it("throws on invalid --label flags", async () => {
    writeFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await Promise.resolve();
        return okJson({ build: { id: "b1" }, uploadUrl: "/x" });
      }),
    );
    await expect(runUpload({ ...baseOptions(), label: ["noequals"] })).rejects.toThrow(
      "--label must be key=value",
    );
  });
});

/** Collect a streamed request body into a buffer. */
async function collectBody(body: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as Readable) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

function okJson(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async (): Promise<string> => {
      await Promise.resolve();
      return "";
    },
    json: async (): Promise<unknown> => {
      await Promise.resolve();
      return payload;
    },
  } as Response;
}
