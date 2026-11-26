import { describe, expect, it } from "vitest";
import { failureDetail, failureText } from "./failure-detail.ts";

describe("failureDetail", () => {
  it("keeps the name of an error whose message is only empty", () => {
    const error = new Error("");
    error.name = "UnknownError";
    expect(failureDetail(error, { step: "screenshot" })).toEqual({
      name: "UnknownError",
      message: "",
      step: "screenshot",
    });
    expect(failureText(failureDetail(error, { step: "screenshot" }))).toBe(
      "screenshot: UnknownError",
    );
  });

  it("lists the cause chain nearest first and stops at a cycle", () => {
    const inner = new TypeError("socket closed");
    const outer = new Error("render failed", { cause: inner });
    (inner as { cause?: unknown }).cause = outer;
    const detail = failureDetail(outer);
    expect(detail.causes).toEqual([{ name: "TypeError", message: "socket closed" }]);
    expect(failureText(detail)).toBe("Error: render failed (caused by TypeError: socket closed)");
  });

  it("scrubs a connection's secrets, then redacts and caps every string", () => {
    const endpoint = "wss://farm.example/ws/abc123";
    const error = new Error(`connect to ${endpoint} failed, api_key=supersecret`, {
      cause: new Error(`refused ${endpoint}`),
    });
    const detail = failureDetail(error, {
      step: "navigate",
      scrub: (text) => text.replaceAll(endpoint, "[remote]"),
    });
    const text = JSON.stringify(detail);
    expect(text).not.toContain("abc123");
    expect(text).not.toContain("supersecret");
    expect(detail.causes?.[0]?.message).toBe("refused [remote]");
    expect(failureDetail(new Error("x".repeat(2000))).message).toHaveLength(300);
    expect(
      failureText(failureDetail(new Error("x".repeat(2000), { cause: "y".repeat(2000) }))),
    ).toHaveLength(500);
  });

  it("describes a value that is not an error, and never throws on a hostile one", () => {
    expect(failureDetail("plain")).toEqual({ name: "ThrownValue", message: "plain" });
    expect(failureDetail({ name: "CdpError", message: "Target closed" })).toEqual({
      name: "CdpError",
      message: "Target closed",
    });
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("boom");
        },
      },
    );
    expect(failureDetail(hostile).name).toBe("ThrownValue");
    expect(failureDetail(null)).toEqual({ name: "ThrownValue", message: "" });
  });

  it("re-sanitizes a detail a runner already built", () => {
    const built = {
      name: "UnknownError",
      message: "token=hunter2hunter2",
      step: "settle",
      causes: [{ name: "Error", message: "password=abcdef123" }],
    };
    const again = failureDetail(built);
    expect(again.step).toBe("settle");
    expect(JSON.stringify(again)).not.toContain("hunter2");
    expect(JSON.stringify(again)).not.toContain("abcdef123");
  });
});
