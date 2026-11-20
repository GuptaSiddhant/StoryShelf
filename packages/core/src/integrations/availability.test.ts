import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { DesignProvider } from "../adapters/design.ts";
import type { IntegrationAvailability } from "../adapters/metadata.ts";
import type { NotifierProvider } from "../adapters/notifier/provider.ts";
import { makeFakeDesign } from "../test-helpers/fake-design.ts";
import { availabilityOf, offerIntegrations, TURNED_OFF_REASON } from "./availability.ts";
import { BUILT_IN_INTEGRATIONS } from "./built-in.ts";

function notifier(kind: string, availability?: () => IntegrationAvailability): NotifierProvider {
  return {
    metadata: { name: kind, version: "1", kind, category: "notifier", schema: z.object({}) },
    create: () => ({}),
    ...(availability ? { availability } : {}),
  } as unknown as NotifierProvider;
}

const design: DesignProvider = makeFakeDesign().provider;

describe("availabilityOf", () => {
  it("reads a provider without a check as available", () => {
    expect(availabilityOf(notifier("slack-webhook"))).toBe("available");
  });

  it("returns the provider's answer", () => {
    expect(availabilityOf(notifier("email", () => ({ unavailable: "no sender" })))).toEqual({
      unavailable: "no sender",
    });
  });

  it("reads a throwing check as unavailable with its message", () => {
    const broken = notifier("email", () => {
      throw new Error("boom");
    });
    expect(availabilityOf(broken)).toEqual({ unavailable: "boom" });
    const odd = notifier("email", () => {
      // oxlint-disable-next-line no-throw-literal -- a JavaScript provider can throw anything
      throw "odd";
    });
    expect(availabilityOf(odd)).toEqual({ unavailable: "odd" });
  });

  it("redacts and bounds a thrown message: it reaches project admins (#1126)", () => {
    const leaky = notifier("email", () => {
      throw new Error(`smtp://mail:hunter2@relay.example failed; token=abc123 ${"x".repeat(400)}`);
    });
    const result = availabilityOf(leaky);
    const reason = result === "available" ? "" : result.unavailable;
    expect(reason).not.toContain("hunter2");
    expect(reason).not.toContain("abc123");
    expect(reason.length).toBeLessThanOrEqual(200);
  });
});

describe("offerIntegrations", () => {
  it("offers available providers and reports every kind", () => {
    const email = notifier("email", () => ({ unavailable: "no sender" }));
    const slack = notifier("slack-webhook");
    const teams = notifier("teams-workflow");
    const offered = offerIntegrations(
      { notifiers: [email, slack], design: [] },
      { notifiers: [email, slack, teams], design: [design] },
    );
    expect(offered.notifiers).toEqual([slack]);
    expect(offered.design).toEqual([]);
    expect(offered.statuses).toEqual([
      {
        group: "notifiers",
        kind: "email",
        name: "email",
        state: "unavailable",
        reason: "no sender",
      },
      { group: "notifiers", kind: "slack-webhook", name: "slack-webhook", state: "available" },
      {
        group: "notifiers",
        kind: "teams-workflow",
        name: "teams-workflow",
        state: "disabled",
        reason: TURNED_OFF_REASON,
      },
      {
        group: "design",
        kind: design.metadata.kind,
        name: design.metadata.name,
        state: "disabled",
        reason: TURNED_OFF_REASON,
      },
    ]);
  });

  it("asks each provider once", () => {
    let calls = 0;
    const counted = notifier("email", () => {
      calls += 1;
      return "available";
    });
    const offered = offerIntegrations(
      { notifiers: [counted], design: [] },
      { notifiers: [], design: [] },
    );
    expect(offered.notifiers).toEqual([counted]);
    expect(calls).toBe(1);
  });

  it("offers every built-in but email on a server with no sender", () => {
    const offered = offerIntegrations(
      {
        notifiers: [...BUILT_IN_INTEGRATIONS.notifiers],
        design: [...BUILT_IN_INTEGRATIONS.design],
      },
      BUILT_IN_INTEGRATIONS,
    );
    expect(offered.notifiers.map((provider) => provider.metadata.kind)).not.toContain("email");
    expect(offered.design.map((provider) => provider.metadata.kind)).toEqual(["figma"]);
    expect(offered.statuses.find((status) => status.kind === "email")?.state).toBe("unavailable");
  });
});
