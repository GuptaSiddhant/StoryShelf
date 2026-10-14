/** Figma URL parsing: validates design links and extracts the file key and node id. */

/** A parsed Figma link. */
export interface FigmaRef {
  fileKey: string;
  /** Node id in API form (`1:2`), or null when the link targets the whole file. */
  nodeId: string | null;
  /** URL to open: the pasted link without credentials or fragment. */
  url: string;
}

const FIGMA_HOSTS = new Set(["figma.com", "www.figma.com"]);
const FILE_PATH = /^\/(?:file|design|proto|board|make)\/(?<key>[A-Za-z0-9]+)(?:\/|$)/u;

/** `1:2` after normalizing; Figma node ids are `<number>:<number>`. */
const NODE_ID = /^\d+:\d+$/u;

/**
 * Parse a Figma file/design/board/proto/make URL, or null when it is not a Figma
 * link. Embed (`/embed`), community and Figma Sites (`figma.site`) links are
 * deliberately rejected, as are malformed `node-id` values.
 */
export function parseFigmaUrl(raw: string): FigmaRef | null {
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

/** Thrown when a design link is not a usable Figma URL. */
export class InvalidDesignUrlError extends Error {
  constructor(readonly value: string) {
    super(
      "Enter a figma.com file, design, board, prototype or make URL (https://www.figma.com/design/…); embed, community and Figma Sites links are not supported",
    );
    this.name = "InvalidDesignUrlError";
  }
}
