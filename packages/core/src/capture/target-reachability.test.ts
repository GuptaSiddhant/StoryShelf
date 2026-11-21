import { describe, expect, it, vi } from "vitest";
import { TargetLaunchError } from "../adapters/capture-target.ts";
import {
  launchFailureOf,
  reachabilityOf,
  reasonClassOf,
  TargetReachability,
} from "./target-reachability.ts";

const clock = (): (() => Date) => {
  let tick = 0;
  return () => {
    tick += 1;
    return new Date(Date.UTC(2026, 10, 21, 0, 0, tick - 1));
  };
};

describe("TargetReachability", () => {
  it("reports an outage once, however many builds fail, and the recovery once", async () => {
    const reach = new TargetReachability(clock());
    const onChange = vi.fn();
    reach.onChange = onChange;
    await reach.failed("chromium@sprite", "connection");
    await reach.failed("chromium@sprite", "connection");
    await reach.succeeded("chromium@other");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(reach.unreachable().get("chromium@sprite")).toEqual({
      reason: "connection",
      since: "2026-11-21T00:00:00.000Z",
    });
    await reach.succeeded("chromium@sprite");
    await reach.succeeded("chromium@sprite");
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith({
      kind: "recovered",
      target: "chromium@sprite",
      since: "2026-11-21T00:00:00.000Z",
    });
    expect(reach.unreachable().size).toBe(0);
  });

  it("does not clear an outage that began after the run did", async () => {
    const reach = new TargetReachability(clock());
    const onChange = vi.fn();
    const started = new Map(reach.unreachable());
    await reach.failed("chromium@sprite", "connection");
    reach.onChange = onChange;
    await reach.succeeded("chromium@sprite", started);
    expect(reach.unreachable().has("chromium@sprite")).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    // A run that began during the same outage does clear it.
    await reach.succeeded("chromium@sprite", new Map(reach.unreachable()));
    expect(reach.unreachable().size).toBe(0);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("works without a listener", async () => {
    const reach = new TargetReachability();
    await reach.failed("firefox", "launch");
    await reach.succeeded("firefox");
    expect(reach.unreachable().size).toBe(0);
  });

  it("keeps one record per owner", () => {
    const owner = {};
    expect(reachabilityOf(owner)).toBe(reachabilityOf(owner));
    expect(reachabilityOf({})).not.toBe(reachabilityOf(owner));
  });
});

describe("reasonClassOf", () => {
  it.each([
    ["browserType.connect: WebSocket error: 500", "connection"],
    ["executable does not exist", "not-installed"],
    ["version mismatch", "launch"],
  ])("classifies %s", (text, expected) => {
    expect(reasonClassOf(text)).toBe(expected);
  });
});

describe("launchFailureOf", () => {
  it("reads a TargetLaunchError, keeping the class and not the text", () => {
    const error = new TargetLaunchError("chromium@sprite", "WebSocket error: 500 wss://k:secret@h");
    const found = launchFailureOf(error);
    expect(found).toEqual({ target: "chromium@sprite", reason: "connection" });
    expect(JSON.stringify(found)).not.toContain("secret");
  });

  it("reads the message a forked child sends", () => {
    expect(launchFailureOf(new Error("Cannot launch webkit: executable does not exist"))).toEqual({
      target: "webkit",
      reason: "not-installed",
    });
    expect(launchFailureOf("Cannot launch firefox: boom")).toEqual({
      target: "firefox",
      reason: "launch",
    });
  });

  it("ignores everything else", () => {
    expect(launchFailureOf(new Error("Cannot launch nothing: x"))).toBeNull();
    expect(launchFailureOf(new Error("boom"))).toBeNull();
    expect(launchFailureOf(42)).toBeNull();
  });
});
