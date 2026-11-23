import { describe, expect, it } from "vitest";
import { installLine, missingPeerHint } from "./missing-peer.ts";

function notFound(specifier: string, code = "ERR_MODULE_NOT_FOUND"): Error {
  return Object.assign(
    new Error(`Cannot find package '${specifier}' imported from /app/src/index.ts`),
    {
      code,
    },
  );
}

describe("missingPeerHint", () => {
  it("names the subpath, the range and the install line of a missing peer", () => {
    const hint = missingPeerHint(notFound("@libsql/client"));
    expect(hint).toContain("@libsql/client is not installed");
    expect(hint).toContain("@storyshelf/db/sqlite/turso");
    expect(hint).toContain('npm install @libsql/client@"^0.18.0"');
  });

  it("lists every subpath that needs the peer", () => {
    expect(missingPeerHint(notFound("@neondatabase/serverless"))).toContain(
      "@storyshelf/db/postgres/neon, @storyshelf/db/postgres/neon-http",
    );
  });

  it("finds a peer imported through one of its own subpaths", () => {
    expect(missingPeerHint(notFound("@aws-sdk/client-s3/dist/index.js"))).toContain(
      "@storyshelf/storage/s3",
    );
  });

  it("names the package when the peer serves all of it", () => {
    expect(missingPeerHint(notFound("sharp"))).toContain("needed by @storyshelf/runner)");
  });

  it("accepts the CommonJS code too", () => {
    expect(missingPeerHint(notFound("pg", "MODULE_NOT_FOUND"))).toContain(
      'npm install pg@"^8.0.0"',
    );
  });

  it.each([
    ["a module that is not a known peer", notFound("left-pad")],
    ["a relative import", notFound("./local.ts")],
    [
      "another error code",
      Object.assign(new Error("Cannot find package 'pg'"), { code: "EACCES" }),
    ],
    ["a plain error", new Error("boom")],
    ["a non-error", "boom"],
  ])("returns nothing for %s", (_label, error) => {
    expect(missingPeerHint(error)).toBeUndefined();
  });
});

describe("installLine", () => {
  it("quotes the range", () => {
    expect(installLine("pg", "^8.0.0")).toBe('npm install pg@"^8.0.0"');
  });
});
