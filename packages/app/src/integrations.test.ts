import type { IntegrationStatus } from "@storyshelf/core/integrations";
import { describe, expect, it } from "vitest";
import {
  NOT_REGISTERED_REASON,
  offeredKinds,
  unofferedIntegrations,
  unofferedKindMessage,
  unofferedReason,
} from "./integrations.ts";
import { runWithStore, type Store } from "./store.ts";

const STATUSES: IntegrationStatus[] = [
  { group: "notifiers", kind: "slack-webhook", name: "Slack", state: "available" },
  { group: "notifiers", kind: "email", name: "Email", state: "unavailable", reason: "no sender" },
  { group: "notifiers", kind: "teams-workflow", name: "Teams", state: "disabled" },
  { group: "design", kind: "figma", name: "Figma", state: "disabled", reason: "Turned off" },
];

/** The store's notifiers are the offered (available) ones: here only Slack. */
const notifiers = [{ metadata: { kind: "slack-webhook" } }];

const inStore = <T>(integrations: IntegrationStatus[] | undefined, run: () => T): T =>
  runWithStore({ config: {}, integrations, notifiers } as unknown as Store, run);

describe("unofferedIntegrations", () => {
  it("lists the group's kinds that are not available, with why", () => {
    inStore(STATUSES, () => {
      expect(unofferedIntegrations("notifiers")).toEqual([
        { kind: "email", name: "Email", reason: "no sender" },
        { kind: "teams-workflow", name: "Teams", reason: "disabled" },
      ]);
      expect(unofferedIntegrations("design")).toEqual([
        { kind: "figma", name: "Figma", reason: "Turned off" },
      ]);
    });
  });

  it("is empty in a hand-built store", () => {
    inStore(undefined, () => {
      expect(unofferedIntegrations("notifiers")).toEqual([]);
    });
  });
});

describe("unofferedReason", () => {
  it("is undefined for an offered kind, the reason for an unoffered one", () => {
    inStore(STATUSES, () => {
      expect(offeredKinds()).toEqual(["slack-webhook"]);
      expect(unofferedReason("slack-webhook")).toBeUndefined();
      expect(unofferedReason("email")).toBe("no sender");
    });
  });

  it("holds back a kind no registered notifier provides (#1126)", () => {
    inStore(STATUSES, () => {
      expect(unofferedReason("removed-custom")).toBe(NOT_REGISTERED_REASON);
    });
  });
});

describe("unofferedKindMessage", () => {
  it("names the provider and the reason", () => {
    inStore(STATUSES, () => {
      expect(unofferedKindMessage("email")).toBe(
        "Email is not available on this server: no sender",
      );
      expect(unofferedKindMessage("slack-webhook")).toBeUndefined();
    });
  });
});
