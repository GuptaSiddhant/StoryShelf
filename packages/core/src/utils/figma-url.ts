/** Figma URL parsing: validates design links and extracts the file key and node id. */

/** A parsed Figma link. */
export interface FigmaRef {
  fileKey: string;
  /** Node id in API form (`1:2`), or null when the link targets the whole file. */
  nodeId: string | null;
  /** Canonical URL to open (original link, trimmed). */
  url: string;
}

const FIGMA_HOSTS = new Set(["figma.com", "www.figma.com"]);
const FILE_PATH = /^\/(?:file|design|proto|board|make)\/(?<key>[A-Za-z0-9]+)(?:\/|$)/u;

/** Parse a Figma file/design/board/proto URL, or null when it is not a Figma link. */
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
  const node = url.searchParams.get("node-id");
  return {
    fileKey,
    nodeId: node ? node.replace("-", ":") : null,
    url: url.toString(),
  };
}

/** Thrown when a design link is not a usable Figma URL. */
export class InvalidDesignUrlError extends Error {
  constructor(readonly value: string) {
    super("Enter a Figma file, design, board or prototype URL (https://www.figma.com/design/…)");
    this.name = "InvalidDesignUrlError";
  }
}
