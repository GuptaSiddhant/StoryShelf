import { describe, expect, it } from "vitest";
import {
  assertPortalOutsideContentHosts,
  classifyHost,
  contentHostLabel,
  contentHostSuffix,
  contentOriginOf,
  hostingModeOf,
  hostingOriginsOf,
  hostingOriginsOfConfig,
  isAliasLabel,
  isReservedLabel,
  isUlidShape,
  portalOriginOf,
  storybookHostingOf,
} from "./content-hosts.ts";
import { createUrlBuilder } from "./urls.ts";

const ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const origins = hostingOriginsOf("https://shelf.example.com", "shelf.example.com");

describe("labels", () => {
  it("knows a build id by its shape, in either case", () => {
    expect(isUlidShape(ID)).toBe(true);
    expect(isUlidShape(ID.toLowerCase())).toBe(true);
    expect(isUlidShape(`${ID}0`)).toBe(false);
    expect(isUlidShape("81ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(false);
    expect(contentHostLabel(ID)).toBe(ID.toLowerCase());
  });

  it("reserves www, api, app, admin, auth and static", () => {
    for (const label of ["www", "api", "app", "admin", "auth", "static", "ADMIN"]) {
      expect(isReservedLabel(label)).toBe(true);
    }
    expect(isReservedLabel("storybook")).toBe(false);
  });

  it("serves as an alias only a plain, unreserved, non-ULID DNS label", () => {
    expect(isAliasLabel("my-project")).toBe(true);
    for (const slug of ["admin", ID.toLowerCase(), "-x", "x-", "a.b", "A", "", "x".repeat(64)]) {
      expect(isAliasLabel(slug), slug).toBe(false);
    }
  });
});

describe("classifyHost", () => {
  it("knows the portal, a content host and an alias host", () => {
    expect(classifyHost("shelf.example.com", origins)).toEqual({ kind: "portal" });
    expect(classifyHost(`${ID.toLowerCase()}.shelf.example.com`, origins)).toEqual({
      kind: "content",
      buildId: ID,
    });
    expect(classifyHost("my-project.shelf.example.com", origins)).toEqual({
      kind: "alias",
      slug: "my-project",
    });
  });

  it("is case-insensitive", () => {
    expect(classifyHost("SHELF.Example.com", origins)).toEqual({ kind: "portal" });
    expect(classifyHost(`${ID}.SHELF.example.com`, origins)).toEqual({
      kind: "content",
      buildId: ID,
    });
  });

  it("refuses a request with no host at all", () => {
    expect(classifyHost(null, origins)).toEqual({ kind: "unknown" });
  });

  it.each([
    "",
    "example.com",
    "evil.com",
    "203.0.113.7",
    "[::1]",
    "admin.shelf.example.com",
    "a.b.shelf.example.com",
    ".shelf.example.com",
    "shelf.example.com.",
    "x.shelf.example.com:8080",
    "x@shelf.example.com",
    "x_y.shelf.example.com",
    "-x.shelf.example.com",
    "xshelf.example.com",
    "shelf.example.com.evil.com",
  ])("refuses the host %s", (host) => {
    expect(classifyHost(host, origins)).toEqual({ kind: "unknown" });
  });

  it("includes the portal's port in every host", () => {
    const local = hostingOriginsOf("http://localhost:3000", "localhost");
    expect(classifyHost("localhost:3000", local)).toEqual({ kind: "portal" });
    expect(classifyHost("localhost", local)).toEqual({ kind: "unknown" });
    expect(classifyHost("abc.localhost:3000", local)).toEqual({ kind: "alias", slug: "abc" });
    expect(classifyHost("abc.localhost:4000", local)).toEqual({ kind: "unknown" });
  });
});

describe("origins", () => {
  it("builds the portal and content origins from configuration", () => {
    expect(portalOriginOf(origins)).toBe("https://shelf.example.com");
    expect(contentOriginOf(origins, ID)).toBe(`https://${ID.toLowerCase()}.shelf.example.com`);
    const local = hostingOriginsOf("http://localhost:3000/prefix", "localhost");
    expect(portalOriginOf(local)).toBe("http://localhost:3000");
    expect(contentOriginOf(local, ID)).toBe(`http://${ID.toLowerCase()}.localhost:3000`);
  });
});

describe("storybookHostingOf", () => {
  const publicBaseUrl = "https://shelf.example.com";

  it("reads storybookHosting, then the deprecated alias, then nothing", () => {
    const hosting = { mode: "sandboxed" } as const;
    expect(storybookHostingOf({ storybookHosting: hosting })).toBe(hosting);
    expect(storybookHostingOf({ publishedBaseDomain: "Shelf.Example.com." })).toEqual({
      mode: "subdomain",
      baseDomain: "shelf.example.com",
    });
    expect(storybookHostingOf({})).toBeUndefined();
    expect(hostingModeOf({})).toBe("trusted");
    expect(hostingModeOf({ publishedBaseDomain: "x.com" })).toBe("subdomain");
  });

  it("has origins and a link suffix only in subdomain mode with a portal origin", () => {
    const sub = {
      storybookHosting: { mode: "subdomain", baseDomain: "x.com" },
      publicBaseUrl,
    } as const;
    expect(hostingOriginsOfConfig(sub)?.baseDomain).toBe("x.com");
    expect(contentHostSuffix(sub)).toBe("x.com");
    expect(contentHostSuffix({ ...sub, publicBaseUrl: "http://localhost:3000" })).toBe(
      "x.com:3000",
    );
    expect(contentHostSuffix({ storybookHosting: sub.storybookHosting })).toBeUndefined();
    expect(
      contentHostSuffix({ storybookHosting: { mode: "sandboxed" }, publicBaseUrl }),
    ).toBeUndefined();
    expect(contentHostSuffix({})).toBeUndefined();
  });
});

describe("assertPortalOutsideContentHosts", () => {
  it("refuses a portal exactly one label under the base domain", () => {
    expect(() => {
      assertPortalOutsideContentHosts("https://a.example.com", "example.com");
    }).toThrow(/would also match the portal host/u);
  });

  it("allows a portal equal to, deeper than, or outside the base domain", () => {
    for (const portal of [
      "https://example.com",
      "https://a.b.example.com",
      "https://other.org",
      "https://a.example.com:8443/x",
    ]) {
      expect(() => {
        assertPortalOutsideContentHosts(
          portal,
          portal.includes("a.example.com:") ? "b.example.com" : "example.com",
        );
      }, portal).not.toThrow();
    }
  });
});

describe("createUrlBuilder with content hosts", () => {
  it("links a build to its one-label content host and a project to its alias host", () => {
    const urls = createUrlBuilder("https://shelf.example.com", "shelf.example.com");
    expect(urls.storybookBuild("proj", ID)).toBe(`https://${ID.toLowerCase()}.shelf.example.com`);
    expect(urls.storybook("proj")).toBe("https://proj.shelf.example.com");
  });

  it("takes the scheme from the root and is protocol-relative for a relative root", () => {
    expect(
      createUrlBuilder("http://localhost:3000", "localhost:3000").storybookBuild("p", ID),
    ).toBe(`http://${ID.toLowerCase()}.localhost:3000`);
    expect(createUrlBuilder("/", "shelf.example.com").storybookBuild("p", ID)).toBe(
      `//${ID.toLowerCase()}.shelf.example.com`,
    );
  });

  it("keeps the portal path for a slug that cannot be an alias, and without content hosts", () => {
    expect(createUrlBuilder("/", "shelf.example.com").storybook("admin")).toBe(
      "/projects/admin/storybook",
    );
    expect(createUrlBuilder("/").storybookBuild("p", ID)).toBe(`/projects/p/storybook/build/${ID}`);
  });
});
