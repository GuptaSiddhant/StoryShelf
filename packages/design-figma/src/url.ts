/** Figma URL parsing: validates design links and extracts the file key and node id. */
import type { DesignRef } from "@storyshelf/core/adapter/design";

const FIGMA_HOSTS = new Set(["figma.com", "www.figma.com"]);
const FILE_PATH = /^\/(?:file|design|proto|board|make)\/(?<key>[A-Za-z0-9]+)(?:\/|$)/u;
/** `1:2` after normalizing; Figma node ids are `<number>:<number>`. */
const NODE_ID = /^\d+:\d+$/u;

/**
 * Parse a Figma file/design/board/proto/make URL, or null when it is not a Figma
 * link. Embed (`/embed`), community and Figma Sites (`figma.site`) links are
 * deliberately rejected, as are malformed `node-id` values.
 */
export function parseFigmaUrl(raw: string): DesignRef | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !FIGMA_HOSTS.has(url.hostname)) return null;
  const fileKey = FILE_PATH.exec(url.pathname)?.groups?.["key"];
  if (!fileKey) return null;
  const node = url.searchParams.get("node-id")?.replaceAll("-", ":") ?? null;
  if (node !== null && !NODE_ID.test(node)) return null;
  return { fileKey, nodeId: node, url: withoutCredentials(url) };
}

/** The URL as stored and rendered into `href`s: no credentials, no fragment. */
function withoutCredentials(url: URL): string {
  const clean = new URL(url);
  clean.username = "";
  clean.password = "";
  clean.hash = "";
  return clean.toString();
}
