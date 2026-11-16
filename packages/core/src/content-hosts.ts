/**
 * Host classes of `subdomain` hosting (ADR 0051, decision 5): which `Host` is the portal, a content host
 * (`<build-id>.<baseDomain>`, one exact build) or an alias host (`<project-slug>.<baseDomain>`), and the
 * origins built from them. Pure and configuration-only: an origin is never taken from a request, and a
 * request's `Host` is only ever compared with the values derived here. Re-exported through
 * `@storyshelf/core/config`.
 */
import type { ShelfConfig } from "./config.ts";
import {
  normalizeBaseDomain,
  type StorybookHostingConfig,
  type StorybookHostingMode,
} from "./storybook-hosting.ts";

/** Labels that never name a project alias or a content host (ADR 0051, decision 5). */
export const RESERVED_HOST_LABELS: readonly string[] = [
  "www",
  "api",
  "app",
  "admin",
  "auth",
  "static",
];

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const ULID_SHAPE = /^[0-7][0-9a-hjkmnp-tv-z]{25}$/iu;

/** Whether a string has the 26-character shape of a build id, in either case. */
export function isUlidShape(value: string): boolean {
  return ULID_SHAPE.test(value);
}

/** Whether a label is reserved (`www`, `api`, `app`, `admin`, `auth`, `static`). */
export function isReservedLabel(label: string): boolean {
  return RESERVED_HOST_LABELS.includes(label.toLowerCase());
}

/** Whether a project slug may be served as an alias host: a DNS label that is neither reserved nor ULID-shaped. */
export function isAliasLabel(slug: string): boolean {
  return DNS_LABEL.test(slug) && !isReservedLabel(slug) && !isUlidShape(slug);
}

/** The host label of a build: the lower-case form of its stored upper-case ULID. */
export function contentHostLabel(buildId: string): string {
  return buildId.toLowerCase();
}

/** The hosts of one `subdomain` deployment, derived from the configured portal origin and base domain. */
export interface HostingOrigins {
  /** `http:` or `https:`, from the portal origin. */
  protocol: string;
  /** The portal's host with its port, as a request's `Host` carries it. */
  portalHost: string;
  /** The domain content hosts live under. */
  baseDomain: string;
  /** `:<port>` of the portal origin, or `""`; content hosts share it. */
  port: string;
}

/** The hosts for a portal origin (`publicBaseUrl`) and a normalized base domain. */
export function hostingOriginsOf(portalOrigin: string, baseDomain: string): HostingOrigins {
  const url = new URL(portalOrigin);
  return {
    protocol: url.protocol,
    portalHost: url.host.toLowerCase(),
    baseDomain,
    port: url.port === "" ? "" : `:${url.port}`,
  };
}

/** The portal's origin: scheme and host only. */
export function portalOriginOf(origins: HostingOrigins): string {
  return `${origins.protocol}//${origins.portalHost}`;
}

/** The origin of one build's content host. */
export function contentOriginOf(origins: HostingOrigins, buildId: string): string {
  return `${origins.protocol}//${contentHostLabel(buildId)}.${origins.baseDomain}${origins.port}`;
}

/** What a request's `Host` names. */
export type HostClass =
  | { kind: "portal" }
  | { kind: "content"; buildId: string }
  | { kind: "alias"; slug: string }
  | { kind: "unknown" };

/**
 * Classify a request `Host`. Anything that is not exactly the portal host, one DNS label under the base
 * domain (with the portal's port) or missing is `unknown`; a reserved label is `unknown`; a ULID-shaped
 * label is a content host and any other label an alias host. A trailing dot, a userinfo part, a second
 * label and an upper-case or percent-encoded name never match.
 */
export function classifyHost(host: string | null | undefined, origins: HostingOrigins): HostClass {
  const given = host?.trim().toLowerCase() ?? "";
  if (given === origins.portalHost) {
    return { kind: "portal" };
  }
  const suffix = `.${origins.baseDomain}${origins.port}`;
  if (!given.endsWith(suffix)) {
    return { kind: "unknown" };
  }
  const label = given.slice(0, -suffix.length);
  if (!DNS_LABEL.test(label) || isReservedLabel(label)) {
    return { kind: "unknown" };
  }
  return isUlidShape(label)
    ? { kind: "content", buildId: label.toUpperCase() }
    : { kind: "alias", slug: label };
}

/**
 * `storybookHosting`, with the deprecated `publishedBaseDomain` read as
 * `{ mode: "subdomain", baseDomain }` (ADR 0051, decision 6). `undefined` means `trusted`.
 */
export function storybookHostingOf(
  config: Pick<ShelfConfig, "storybookHosting" | "publishedBaseDomain"> | undefined,
): StorybookHostingConfig | undefined {
  if (config?.storybookHosting !== undefined) {
    return config.storybookHosting;
  }
  const alias = config?.publishedBaseDomain;
  if (alias === undefined) {
    return undefined;
  }
  const domain = normalizeBaseDomain(alias);
  return { mode: "subdomain", baseDomain: domain.ok ? domain.value : alias };
}

/** The configured hosting mode; unset means `trusted`. */
export function hostingModeOf(
  config: Pick<ShelfConfig, "storybookHosting" | "publishedBaseDomain"> | undefined,
): StorybookHostingMode {
  return storybookHostingOf(config)?.mode ?? "trusted";
}

/**
 * The hosts of a `subdomain` deployment, or `undefined` in any other mode (or without a usable portal
 * origin, which boot refuses).
 */
export function hostingOriginsOfConfig(
  config:
    | Pick<ShelfConfig, "storybookHosting" | "publishedBaseDomain" | "publicBaseUrl">
    | undefined,
): HostingOrigins | undefined {
  const hosting = storybookHostingOf(config);
  if (hosting?.mode !== "subdomain" || hosting.baseDomain === undefined || !config?.publicBaseUrl) {
    return undefined;
  }
  return hostingOriginsOf(config.publicBaseUrl, hosting.baseDomain);
}

/**
 * `<baseDomain>[:port]`, the suffix content and alias links are built under (`createUrlBuilder`), or
 * `undefined` outside `subdomain` mode.
 */
export function contentHostSuffix(
  config:
    | Pick<ShelfConfig, "storybookHosting" | "publishedBaseDomain" | "publicBaseUrl">
    | undefined,
): string | undefined {
  const origins = hostingOriginsOfConfig(config);
  return origins ? `${origins.baseDomain}${origins.port}` : undefined;
}

/**
 * The boot rule that keeps the portal out of the content namespace: a portal host exactly one label
 * under the base domain would match as an alias host (`a.example.com` under `example.com`). Throws with
 * the reason. A portal host equal to the base domain is allowed.
 */
export function assertPortalOutsideContentHosts(portalOrigin: string, baseDomain: string): void {
  const hostname = new URL(portalOrigin).hostname.toLowerCase();
  const suffix = `.${baseDomain}`;
  if (hostname.endsWith(suffix) && !hostname.slice(0, -suffix.length).includes(".")) {
    throw new Error(
      `storybookHosting.baseDomain "${baseDomain}" would also match the portal host "${hostname}"; use a baseDomain the portal host is not directly under (the portal host may equal it)`,
    );
  }
}
