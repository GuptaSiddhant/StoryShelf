import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import type { ApiClient } from "./client.ts";
import { ALL_TOOLS } from "./tools/index.ts";

type Class = "hosting" | "testing" | "review";

/** Strictest first: a tool that touches a `testing` route must itself be `testing`. */
const STRICTNESS: readonly Class[] = ["testing", "review", "hosting"];

const TABLE_FILE = new URL("../../app/src/routes/api-routes.ts", import.meta.url);

interface RouteRule {
  method: string;
  pattern: RegExp;
  routeClass: Class;
}

/**
 * The app's `/api/v1` route table. Read as text: the app's sources are outside this package's
 * `rootDir`, and the table is a plain literal of `"METHOD /path": "class"` lines.
 */
function loadRules(): RouteRule[] {
  const source = readFileSync(TABLE_FILE, "utf8");
  const lines = source.matchAll(
    /^\s*"(?<method>[A-Z]+) \/api\/v1(?<path>\/[^"]*)": "(?<routeClass>hosting|testing|review)",$/gmu,
  );
  return [...lines].map(({ groups = {} }) => ({
    method: groups["method"] ?? "",
    pattern: new RegExp(`^${(groups["path"] ?? "").replaceAll(/:[A-Za-z]+/gu, "[^/?]+")}$`, "u"),
    routeClass: groups["routeClass"] as Class,
  }));
}

/** Run a tool against a recording client and return the `METHOD /path` of every call it made. */
async function callsOf(tool: (typeof ALL_TOOLS)[number]): Promise<string[]> {
  const calls: string[] = [];
  const record = (method: string) => async (path: string) => {
    calls.push(`${method} ${path.split("?")[0]}`);
    return path.endsWith("/attempts") ? [{ attemptNo: 1 }] : [];
  };
  const client: ApiClient = {
    defaultSlug: "demo",
    get: record("GET") as ApiClient["get"],
    post: record("POST") as ApiClient["post"],
  };
  const args = Object.fromEntries(
    Object.keys(tool.input).map((key) => [key, key === "body" ? "text" : "x"]),
  );
  await tool.run(client, args);
  return calls;
}

describe("MCP tool route classes", () => {
  const rules = loadRules();

  it("reads the whole route table", () => {
    expect(rules.length).toBeGreaterThan(60);
  });

  for (const tool of ALL_TOOLS) {
    it(`${tool.name} declares the strictest class of the routes it calls`, async () => {
      const calls = await callsOf(tool);
      expect(calls.length, "the tool called no route").toBeGreaterThan(0);
      const classes = calls.map((call) => {
        const [method = "", path = ""] = call.split(" ");
        const rule = rules.find((r) => r.method === method && r.pattern.test(path));
        expect(rule, `${call} is not in api-routes.ts`).toBeDefined();
        return rule?.routeClass ?? "hosting";
      });
      const seen = new Set(classes);
      const strictest = STRICTNESS.find((c) => seen.has(c)) ?? "hosting";
      expect(tool.routeClass ?? "hosting").toBe(strictest);
    });
  }
});
