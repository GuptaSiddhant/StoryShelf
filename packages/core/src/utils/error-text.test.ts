import { describe, expect, it } from "vitest";
import { errorMessage, errorText } from "./error-text.ts";

describe("errorMessage", () => {
  it("gives an Error's own message exactly, causes and all left out", () => {
    expect(errorMessage(new Error("boom", { cause: new Error("inner") }))).toBe("boom");
    expect(errorMessage(new Error(""))).toBe("");
  });

  it("gives a string whole and numbers as text", () => {
    expect(errorMessage("ECONNRESET")).toBe("ECONNRESET");
    expect(errorMessage(503)).toBe("503");
  });

  it("reads an error-like object's message", () => {
    expect(errorMessage({ message: "socket hang up" })).toBe("socket hang up");
    expect(errorMessage({ type: "error", message: "WebSocket error: ECONNREFUSED" })).toBe(
      "WebSocket error: ECONNREFUSED",
    );
  });

  it("reads the underlying error of a WebSocket error event", () => {
    const event = { type: "error", error: new Error("connect ECONNREFUSED 10.0.0.1:9222") };
    expect(errorMessage(event)).toBe("connect ECONNREFUSED 10.0.0.1:9222");
    expect(errorMessage({ type: "error", error: { message: "nested" } })).toBe("nested");
  });

  it("reads a close event's reason and code", () => {
    expect(errorMessage({ type: "close", code: 1006, reason: "abnormal closure" })).toBe(
      "abnormal closure (code 1006)",
    );
    expect(errorMessage({ type: "close", code: 1006, reason: "" })).toBe("close event (code 1006)");
  });

  it("names a bare event by its type, never [object Event]", () => {
    expect(errorMessage(new Event("error"))).toBe("error event");
  });

  it("says unknown error for a value that says nothing", () => {
    for (const value of [null, undefined, {}, [], () => 1, Symbol("x"), { message: "" }]) {
      expect(errorMessage(value)).toBe("unknown error");
    }
  });

  it("survives a cycle, a deep nesting and a getter that throws", () => {
    const cyclic: Record<string, unknown> = { type: "error" };
    cyclic["error"] = cyclic;
    expect(errorMessage(cyclic)).toBe("error event");
    let deep: Record<string, unknown> = { message: "deepest" };
    for (let level = 0; level < 20; level += 1) deep = { error: deep };
    expect(errorMessage(deep)).toBe("unknown error");
    const hostile = {
      get message(): string {
        throw new Error("no");
      },
    };
    expect(errorMessage(hostile)).toBe("unknown error");
  });
});

describe("errorText", () => {
  it("adds the cause chain, once per distinct cause", () => {
    const error = new Error("Cannot connect", {
      cause: new Error("WebSocket error", { cause: new Error("ECONNREFUSED") }),
    });
    expect(errorText(error)).toBe("Cannot connect: WebSocket error: ECONNREFUSED");
  });

  it("does not repeat a cause the message already contains", () => {
    const error = new Error("play failed: ECONNRESET", { cause: new Error("ECONNRESET") });
    expect(errorText(error)).toBe("play failed: ECONNRESET");
  });

  it("stops at a cycle and at four links", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    a.cause = b;
    expect(errorText(a)).toBe("a: b");
    let chain: Error = new Error("e0");
    for (let level = 1; level < 10; level += 1) chain = new Error(`e${level}`, { cause: chain });
    expect(errorText(chain)).toBe("e9: e8: e7: e6");
  });

  it("visits at most four links even when every cause repeats the same message", () => {
    const reads = { count: 0 };
    const linked = (cause: Error | undefined): Error => {
      const error = new Error("same");
      if (cause !== undefined) {
        Object.defineProperty(error, "cause", {
          get: () => {
            reads.count += 1;
            return cause;
          },
        });
      }
      return error;
    };
    let chain: Error | undefined;
    for (let link = 0; link < 1000; link += 1) chain = linked(chain);
    expect(errorText(chain)).toBe("same");
    expect(reads.count).toBeLessThanOrEqual(4);
  });

  it("names an Error with no message by its kind", () => {
    expect(errorText(new TypeError(""))).toBe("TypeError");
  });

  it("shows every shape as readable text", () => {
    expect(errorText({ type: "error", error: new Error("ECONNREFUSED") })).toBe("ECONNREFUSED");
    expect(errorText("plain")).toBe("plain");
    for (const value of [null, undefined, {}]) {
      expect(errorText(value)).toBe("unknown error");
    }
  });

  it("redacts secrets in the message and in a cause", () => {
    const error = new Error("connect failed for wss://user:hunter2@farm.example/?token=abc123", {
      cause: { message: "api_key=supersecret rejected" },
    });
    const text = errorText(error);
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("abc123");
    expect(text).not.toContain("supersecret");
    expect(text).toContain("[redacted]");
  });

  it("runs the caller's scrub first, whole, before pattern redaction and the cut", () => {
    const endpoint = "wss://farm.example/tenant-7?token=abc123";
    const scrub = (text: string): string => text.replaceAll(endpoint, "[endpoint]");
    expect(errorText(new Error(`refused ${endpoint}`), { scrub })).toBe("refused [endpoint]");
    const long = errorText(new Error(`${"x".repeat(490)} ${endpoint}`), { scrub });
    expect(long).toHaveLength(500);
    expect(long).not.toMatch(/farm|tenant|abc123/u);
  });

  it("is bounded", () => {
    expect(errorText(new Error("x".repeat(5000)))).toHaveLength(500);
    expect(errorText(new Error("x".repeat(5000)), { maxLength: 40 })).toHaveLength(40);
  });
});
