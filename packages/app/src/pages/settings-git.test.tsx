import { describe, expect, it } from "vitest";
import { linkBadge, linkDetails, requiredCheckOf, type SettingsGitLink } from "./settings-git.tsx";

const link: SettingsGitLink = {
  id: "l1",
  repository: "acme/widgets",
  prefix: "web",
  connectionName: "Acme App",
  state: "approved",
  managed: false,
  reason: null,
  lastDeliveredAt: null,
  outputs: { storybook: true, comment: "always", annotations: true },
  commentAllowed: true,
};

describe("link states", () => {
  it("names each state the way the project sees it", () => {
    expect(linkBadge({ ...link, state: "pending" }).label).toBe("Waiting for approval");
    expect(linkBadge({ ...link, state: "refused" }).label).toBe("Refused");
    expect(linkBadge({ ...link, state: "broken" }).label).toBe("Broken");
    expect(linkBadge(link).label).toBe("Connected");
    expect(linkBadge({ ...link, managed: true }).label).toBe("Managed by configuration");
    expect(linkBadge({ ...link, managed: true, state: "broken" }).label).toBe("Broken");
  });

  it("gives the required check from the prefix", () => {
    expect(requiredCheckOf(link)).toBe("web/testing");
  });

  it("says what each state needs, and claims no delivery it cannot know", () => {
    expect(linkDetails({ ...link, state: "pending" })).toContain("until a site admin approves");
    expect(linkDetails({ ...link, state: "refused", reason: "Not this team's" })).toContain(
      "Not this team's",
    );
    const broken = linkDetails({ ...link, state: "broken", reason: "App uninstalled" });
    expect(broken).toContain("App uninstalled");
    expect(broken).toContain("reconnect");
    expect(linkDetails(link)).not.toContain("delivery");
    const delivered = new Date(Date.now() - 3_600_000).toISOString();
    expect(linkDetails({ ...link, lastDeliveredAt: delivered })).toContain("last delivery");
  });
});
