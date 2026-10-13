import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import {
  archiveFileName,
  importByteLimit,
  MAX_BASELINE_IMPORT_BYTES,
  readCappedBody,
  toWebStream,
} from "./baselines.handlers.ts";

function streamed(parts: string[]): Request {
  const body = new ReadableStream<Uint8Array>({
    start(controller): void {
      for (const part of parts) {
        controller.enqueue(new TextEncoder().encode(part));
      }
      controller.close();
    },
  });
  return new Request("http://x/", { method: "POST", body, duplex: "half" } as RequestInit);
}

async function statusOf(promise: Promise<unknown>): Promise<number | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof HTTPException ? error.status : -1;
  }
}

describe("readCappedBody", () => {
  it("buffers a body within the limit", async () => {
    expect(String(await readCappedBody(streamed(["ab", "cd"]), 4))).toBe("abcd");
  });

  it("fails with 413 while streaming past the limit", async () => {
    expect(await statusOf(readCappedBody(streamed(["abc", "def"]), 4))).toBe(413);
  });

  it("fails with 413 on an oversized content-length before reading", async () => {
    const request = new Request("http://x/", {
      method: "POST",
      body: "abc",
      headers: { "content-length": "999" },
    });
    expect(await statusOf(readCappedBody(request, 4))).toBe(413);
  });

  it("fails with 400 without a body", async () => {
    expect(await statusOf(readCappedBody(new Request("http://x/", { method: "POST" }), 4))).toBe(
      400,
    );
  });
});

describe("importByteLimit", () => {
  it("caps maxUploadBytes because the archive is buffered", () => {
    expect(importByteLimit({ maxUploadBytes: 10 })).toBe(10);
    expect(importByteLimit({})).toBe(MAX_BASELINE_IMPORT_BYTES);
  });
});

async function* twoChunks(): AsyncGenerator<Buffer> {
  yield Buffer.from("a");
  yield Buffer.from("b");
}

describe("toWebStream", () => {
  it("pulls chunks lazily and closes", async () => {
    expect(await new Response(toWebStream(twoChunks())).text()).toBe("ab");
  });

  it("returns the iterator on cancel", async () => {
    let finished = false;
    async function* chunks(): AsyncGenerator<Buffer> {
      try {
        yield Buffer.from("a");
        yield Buffer.from("b");
      } finally {
        finished = true;
      }
    }
    const reader = toWebStream(chunks()).getReader();
    await reader.read();
    await reader.cancel();
    expect(finished).toBe(true);
  });
});

describe("archiveFileName", () => {
  it("builds a header-safe file name", () => {
    expect(archiveFileName("demo")).toBe("demo-baselines.zip");
    expect(archiveFileName("demo", 'feat/"x"')).toBe("demo-baselines-feat_x_.zip");
  });
});
