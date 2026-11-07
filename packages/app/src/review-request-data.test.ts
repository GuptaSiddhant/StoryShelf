import { describe, expect, it } from "vitest";
import { buildIdOf, parseJobData, reviewRequestKey } from "./review-request-data.ts";

const user = { kind: "user", userId: "u1", provider: "email", route: "default" } as const;

describe("review request data", () => {
  it("keys a request by event and recipient, not by why the recipient was chosen", () => {
    expect(reviewRequestKey("b:0", { kind: "channel", channelId: "c1" })).toBe("b:0|channel:c1");
    expect(reviewRequestKey("b:0", user)).toBe("b:0|user:u1:email");
    expect(reviewRequestKey("b:0", { ...user, route: "assigned" })).toBe("b:0|user:u1:email");
  });

  it("takes the build id off an event id", () => {
    expect(buildIdOf("01BUILD:3")).toBe("01BUILD");
    expect(buildIdOf("nocolon")).toBe("");
  });

  it("parses well-formed data and refuses the rest", () => {
    const data = { projectId: "p", eventId: "b:0", target: user };
    expect(parseJobData(data)).toEqual(data);
    expect(parseJobData({ ...data, target: { kind: "channel", channelId: "c" } })).toBeDefined();
    expect(parseJobData({ ...data, target: { ...user, route: "x" } })).toBeUndefined();
    expect(parseJobData({ ...data, target: { kind: "channel" } })).toBeUndefined();
    expect(parseJobData({ ...data, target: null })).toBeUndefined();
    expect(parseJobData({ ...data, eventId: 1 })).toBeUndefined();
    expect(parseJobData({})).toBeUndefined();
  });
});
