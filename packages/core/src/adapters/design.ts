/**
 * Design-provider adapter interface: link validation, file/node metadata and
 * rendered previews from a design tool (Figma, …). Core owns link resolution,
 * the metadata/render cache and credential storage; a provider owns only the
 * vendor specifics below.
 */
import type { Buffer } from "node:buffer";
import type { Logger } from "../logger.ts";
import type { Adapter, AdapterMetadata } from "./metadata.ts";
import type { OAuthClient } from "./oauth.ts";

/** Design-provider metadata: identity plus the copy the settings UI shows for its credential. */
export interface DesignAdapterMetadata extends AdapterMetadata {
  readonly category: "design";
  /** Credential field label, e.g. "Figma access token". */
  readonly credentialLabel: string;
  /** Help text under the credential field (scopes needed, expiry). */
  readonly credentialHelp: string;
  /** Placeholder for the credential input, e.g. "figd_…". */
  readonly credentialPlaceholder?: string;
  /** Example of a link this provider accepts, shown on rejection. */
  readonly urlHint: string;
  /** Longest lifetime of a credential, so the UI can count down to rotation. */
  readonly credentialMaxAgeDays?: number;
}

/** A parsed design link. */
export interface DesignRef {
  /** Provider file identifier. */
  fileKey: string;
  /** Node id inside the file, or null when the link targets the whole file. */
  nodeId: string | null;
  /** URL to open: the pasted link without credentials or fragment. */
  url: string;
}

/** Outcome of a metadata fetch. `error` is transient (outage/rate limit) and never persisted. */
export type DesignState = "ok" | "deleted" | "unauthorized" | "forbidden" | "error";

/** Metadata of a design file or node. */
export interface DesignMeta {
  state: DesignState;
  name: string | null;
  version: string | null;
  lastModified: string | null;
}

/** Per-call options: a signal cancelling the whole call (page-render budget) plus a logger. */
export interface DesignCallOptions {
  logger?: Logger;
  signal?: AbortSignal;
}

/** How a stored credential authenticates: a pasted personal token or a user's OAuth access token. */
export type DesignAuthType = "token" | "oauth";

/** Descriptor — registered at startup, parses links and binds a credential. */
export interface DesignProvider extends Adapter<DesignAdapterMetadata> {
  /** Parse a pasted link; null when it is not one of this provider's links. */
  parseUrl(raw: string): DesignRef | null;
  /** Create a client bound to a decrypted credential (`authType` defaults to a personal token). */
  create(opts: { credential: string; authType?: DesignAuthType; logger?: Logger }): DesignClient;
  /** Present only when the operator configured OAuth for this provider. */
  readonly oauth?: OAuthClient;
}

/** Runtime — bound to a credential, talks to the vendor API. */
export interface DesignClient {
  /**
   * Metadata for several refs of one file, keyed by node id (`""` = whole file).
   * API failures map to a {@link DesignState} per ref rather than throwing.
   */
  fetchMetas(
    fileKey: string,
    refs: readonly DesignRef[],
    options?: DesignCallOptions,
  ): Promise<Map<string, DesignMeta>>;
  /**
   * PNG renders of several nodes of one file, keyed by node id. Nodes the vendor
   * cannot render are omitted; throws when the render API call itself fails.
   */
  fetchRenders(
    fileKey: string,
    nodeIds: readonly string[],
    options?: DesignCallOptions,
  ): Promise<Map<string, Buffer>>;
}

/** Thrown when a design link is not accepted by any configured provider. */
export class InvalidDesignUrlError extends Error {
  readonly value: string;

  constructor(value: string, hint?: string) {
    super(
      hint ? `Enter a supported design link, e.g. ${hint}` : "No design provider is configured",
    );
    this.value = value;
    this.name = "InvalidDesignUrlError";
  }
}

/** First provider that accepts the link, with its parsed ref. */
export function parseDesignUrl(
  providers: readonly DesignProvider[],
  raw: string,
): { provider: DesignProvider; ref: DesignRef } | null {
  for (const provider of providers) {
    const ref = provider.parseUrl(raw);
    if (ref) return { provider, ref };
  }
  return null;
}
