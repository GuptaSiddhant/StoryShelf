import { describe, expect, it, vi } from "vitest";
import {
  assertUniqueKinds,
  resolveIntegrationGroup,
  resolveIntegrations,
  type IntegrationGroup,
} from "./resolve.ts";

interface Item {
  metadata: { kind: string; name: string };
}

const item = (kind: string, name = kind): Item => ({ metadata: { kind, name } });
const builtIn: readonly Item[] = Object.freeze([item("slack"), item("teams")]);
const group: IntegrationGroup = { name: "notifications.notifiers", reasons: () => [] };
const kinds = (items: readonly Item[]): string[] => items.map((entry) => entry.metadata.kind);

describe("resolveIntegrations", () => {
  it("gives the built-ins when the option is undefined", () => {
    const resolved = resolveIntegrations(builtIn);
    expect(resolved).toEqual(builtIn);
    expect(resolved).not.toBe(builtIn);
  });

  it("gives exactly the array, with no built-ins", () => {
    const custom = [item("custom")];
    expect(resolveIntegrations(builtIn, custom)).toEqual(custom);
    expect(resolveIntegrations(builtIn, [])).toEqual([]);
  });

  it("gives the function's result, called once with the built-ins", () => {
    const option = vi.fn((list: readonly Item[]) => [...list, item("custom")]);
    expect(kinds(resolveIntegrations(builtIn, option))).toEqual(["slack", "teams", "custom"]);
    expect(option).toHaveBeenCalledOnce();
    expect(option).toHaveBeenCalledWith(builtIn);
  });

  it("gives none for false", () => {
    expect(resolveIntegrations(builtIn, false)).toEqual([]);
  });

  it("filters built-ins out through the function", () => {
    const resolved = resolveIntegrations(builtIn, (list) =>
      list.filter((entry) => entry.metadata.kind !== "teams"),
    );
    expect(kinds(resolved)).toEqual(["slack"]);
  });

  it("replaces a built-in of the same kind through the function", () => {
    const mine = item("slack");
    const resolved = resolveIntegrations(builtIn, (list) => [
      ...list.filter((entry) => entry.metadata.kind !== "slack"),
      mine,
    ]);
    expect(kinds(resolved)).toEqual(["teams", "slack"]);
    expect(resolved).toContain(mine);
  });
});

describe("resolveIntegrationGroup", () => {
  it("returns the resolved list when every item holds", () => {
    expect(kinds(resolveIntegrationGroup(group, builtIn))).toEqual(["slack", "teams"]);
  });

  it("throws on a duplicate kind, naming the kind", () => {
    expect(() =>
      resolveIntegrationGroup(group, builtIn, (list) => [...list, item("slack", "My Slack")]),
    ).toThrow(
      'notifications.notifiers[2] ("My Slack"): kind "slack" is already used by "slack"; a ' +
        "provider kind must be unique.",
    );
  });

  it("throws on a duplicate kind inside an array too", () => {
    expect(() => resolveIntegrationGroup(group, [], [item("x"), item("x")])).toThrow(/"x"/u);
  });

  it("throws when an item breaks its adapter contract, naming the index", () => {
    const strict: IntegrationGroup = {
      name: "design",
      reasons: (candidate) => (candidate === "bad" ? ["missing methods: create"] : []),
    };
    expect(() =>
      resolveIntegrationGroup(strict, [], [item("a"), "bad" as unknown as Item]),
    ).toThrow("design[1]: missing methods: create");
  });

  it("throws when the function returns no array", () => {
    expect(() =>
      resolveIntegrationGroup(group, builtIn, () => undefined as unknown as Item[]),
    ).toThrow("notifications.notifiers: the function must return an array of providers");
  });

  it("throws on an option of none of the four forms", () => {
    expect(() => resolveIntegrationGroup(group, builtIn, "slack" as unknown as Item[])).toThrow(
      "notifications.notifiers must be an array, a function of the built-ins, or false",
    );
    expect(() => resolveIntegrationGroup(group, builtIn, true as unknown as false)).toThrow(
      TypeError,
    );
  });

  it("checks the contract before the kinds, so a broken item never reads metadata", () => {
    const strict: IntegrationGroup = { name: "g", reasons: () => ["invalid metadata: kind"] };
    expect(() => resolveIntegrationGroup(strict, [], [{} as Item])).toThrow(
      "g[0]: invalid metadata: kind",
    );
  });
});

describe("assertUniqueKinds", () => {
  it("accepts distinct kinds and an empty list", () => {
    expect(() => {
      assertUniqueKinds(group, builtIn);
    }).not.toThrow();
    expect(() => {
      assertUniqueKinds(group, []);
    }).not.toThrow();
  });
});
