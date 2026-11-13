import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { EmailSender } from "../adapters/email-sender.ts";
import type { NotifierProvider } from "../adapters/notifier/provider.ts";
import { makeFakeDesign } from "../test-helpers/fake-design.ts";
import {
  BUILT_IN_INTEGRATIONS,
  INTEGRATION_GROUPS,
  resolveShelfIntegrations,
  type BuiltInIntegrations,
} from "./index.ts";

function notifier(kind: string, name = kind): NotifierProvider {
  return {
    metadata: { name, version: "1", kind, category: "notifier", schema: z.object({}).loose() },
    create: () => ({}),
  } as unknown as NotifierProvider;
}

function sender(kind: string): EmailSender {
  return {
    metadata: { name: kind, version: "1", kind, category: "notifier" },
    send: async () => {},
  } as unknown as EmailSender;
}

const builtIn: BuiltInIntegrations = {
  notifiers: [notifier("slack-webhook"), notifier("teams-workflow")],
  email: [sender("smtp")],
  design: [makeFakeDesign().provider],
};

describe("BUILT_IN_INTEGRATIONS", () => {
  it("holds the git notifiers and Figma, and is frozen; each move task adds its own", () => {
    expect(BUILT_IN_INTEGRATIONS.notifiers.map((entry) => entry.metadata.kind)).toEqual([
      "github",
      "gitlab",
      "git-log",
    ]);
    expect(BUILT_IN_INTEGRATIONS.email).toEqual([]);
    expect(BUILT_IN_INTEGRATIONS.design.map((p) => p.metadata.kind)).toEqual(["figma"]);
    expect(Object.isFrozen(BUILT_IN_INTEGRATIONS)).toBe(true);
    expect(Object.isFrozen(BUILT_IN_INTEGRATIONS.notifiers)).toBe(true);
  });

  it("names each group by its option path", () => {
    expect(Object.values(INTEGRATION_GROUPS).map((group) => group.name)).toEqual([
      "notifications.notifiers",
      "notifications.email",
      "design",
    ]);
  });
});

describe("resolveShelfIntegrations", () => {
  it("gives the built-ins of every group when nothing is set", () => {
    expect(resolveShelfIntegrations({}, builtIn)).toEqual(builtIn);
    expect(resolveShelfIntegrations({})).toEqual({
      notifiers: [...BUILT_IN_INTEGRATIONS.notifiers],
      email: [],
      design: [...BUILT_IN_INTEGRATIONS.design],
    });
  });

  it("resolves each group by its own form", () => {
    const custom = notifier("custom");
    const resolved = resolveShelfIntegrations(
      { notifiers: (list) => [...list, custom], email: false, design: [] },
      builtIn,
    );
    expect(resolved.notifiers.map((entry) => entry.metadata.kind)).toEqual([
      "slack-webhook",
      "teams-workflow",
      "custom",
    ]);
    expect(resolved.email).toEqual([]);
    expect(resolved.design).toEqual([]);
  });

  it("lets a custom provider replace a built-in of the same kind", () => {
    const mine = notifier("slack-webhook", "My Slack");
    const resolved = resolveShelfIntegrations(
      { notifiers: (list) => [...list.filter((p) => p.metadata.kind !== "slack-webhook"), mine] },
      builtIn,
    );
    expect(resolved.notifiers.map((entry) => entry.metadata.name)).toEqual([
      "teams-workflow",
      "My Slack",
    ]);
  });

  it("throws at startup on a duplicate kind, naming the group and the kind", () => {
    expect(() =>
      resolveShelfIntegrations(
        { notifiers: (list) => [...list, notifier("slack-webhook")] },
        builtIn,
      ),
    ).toThrow(
      /notifications\.notifiers\[2\] \("slack-webhook"\): kind "slack-webhook" is already used/u,
    );
    expect(() => resolveShelfIntegrations({ email: [sender("smtp"), sender("smtp")] })).toThrow(
      /notifications\.email\[1\] \("smtp"\): kind "smtp"/u,
    );
    const design = makeFakeDesign().provider;
    expect(() => resolveShelfIntegrations({ design: [design, design] })).toThrow(
      /design\[1\] \(".*"\): kind "fake"/u,
    );
  });

  it("checks each item against its adapter contract", () => {
    const broken = { metadata: { name: "N", version: "1", kind: "n", category: "notifier" } };
    expect(() =>
      resolveShelfIntegrations({ notifiers: [broken as unknown as NotifierProvider] }),
    ).toThrow(/notifications\.notifiers\[0\]: .*missing methods: create/u);
    expect(() =>
      resolveShelfIntegrations({ email: [{ metadata: {} } as unknown as EmailSender] }),
    ).toThrow(/notifications\.email\[0\]: invalid metadata/u);
    expect(() => resolveShelfIntegrations({ design: [notifier("x") as never] })).toThrow(
      /design\[0\]: category "notifier" does not match slot "design"/u,
    );
  });

  it("keeps kinds per group: the same kind in two groups is not a duplicate", () => {
    const resolved = resolveShelfIntegrations({
      notifiers: [notifier("log")],
      email: [sender("log")],
    });
    expect(resolved.notifiers).toHaveLength(1);
    expect(resolved.email).toHaveLength(1);
  });
});
