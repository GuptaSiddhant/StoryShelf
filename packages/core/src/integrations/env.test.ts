import { describe, expect, it } from "vitest";
import { BUILT_IN_INTEGRATIONS } from "./built-in.ts";
import { INTEGRATIONS_DISABLED_VAR, integrationsFromEnv } from "./env.ts";

const kindsOf = (providers: readonly { metadata: { kind: string } }[]): string[] =>
  providers.map((provider) => provider.metadata.kind);

describe("integrationsFromEnv", () => {
  it("turns nothing off when the variable is unset or blank", () => {
    for (const env of [{}, { [INTEGRATIONS_DISABLED_VAR]: " , " }]) {
      const options = integrationsFromEnv(env);
      expect(options.disabled).toEqual([]);
      expect(kindsOf(options.notifiers(BUILT_IN_INTEGRATIONS.notifiers))).toEqual(
        kindsOf(BUILT_IN_INTEGRATIONS.notifiers),
      );
      expect(kindsOf(options.design(BUILT_IN_INTEGRATIONS.design))).toEqual(["figma"]);
    }
  });

  it("filters the named kinds out, accepting short names, case and spaces", () => {
    const options = integrationsFromEnv({
      [INTEGRATIONS_DISABLED_VAR]: " Slack, teams,figma,slack",
    });
    expect(options.disabled).toEqual(["slack-webhook", "teams-workflow", "figma"]);
    const notifiers = kindsOf(options.notifiers(BUILT_IN_INTEGRATIONS.notifiers));
    expect(notifiers).not.toContain("slack-webhook");
    expect(notifiers).not.toContain("teams-workflow");
    expect(notifiers).toContain("email");
    expect(options.design(BUILT_IN_INTEGRATIONS.design)).toEqual([]);
  });

  it("accepts exact kinds", () => {
    const options = integrationsFromEnv({ [INTEGRATIONS_DISABLED_VAR]: "email,gitlab" });
    const notifiers = kindsOf(options.notifiers(BUILT_IN_INTEGRATIONS.notifiers));
    expect(notifiers).not.toContain("email");
    expect(notifiers).not.toContain("gitlab");
  });

  it("fails startup on an unknown kind, naming it and the known ones", () => {
    expect(() => integrationsFromEnv({ [INTEGRATIONS_DISABLED_VAR]: "slack,discord" })).toThrow(
      /unknown integration kind "discord".*known kinds: .*figma.*slack/u,
    );
  });
});
