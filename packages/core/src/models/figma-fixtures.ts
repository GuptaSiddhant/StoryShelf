/** Shared fixtures for the Figma model tests: a scriptable fake of api.figma.com and its CDN. */
import { vi, type MockInstance } from "vitest";

/** Spy on `fetch` returned by the fakes below. */
export type FetchSpy = MockInstance<typeof fetch>;

export const URL_NODE = "https://www.figma.com/design/KEY/Kit?node-id=1-2";
export const URL_NODE_B = "https://www.figma.com/design/KEY/Kit?node-id=3-4";
export const URL_FILE = "https://www.figma.com/design/KEY/Kit";
export const PNG_BYTES = Buffer.from([137, 80, 78, 71]);

/** Requested URL of a fetch spy call. */
export const requested = (call: unknown[]): string =>
  call[0] instanceof Request ? call[0].url : String(call[0]);

/** Mock a JSON-only API that answers every request with `status` and `body`. */
export function respond(status: number, body: unknown = {}): FetchSpy {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    await Promise.resolve();
    return new Response(JSON.stringify(body), { status });
  });
}

const CDN_IMAGES = {
  images: { "1:2": "https://cdn.example.com/a.png", "3:4": "https://cdn.example.com/b.png" },
};
const DEFAULT_NODES = {
  "1:2": { document: { name: "Button" } },
  "3:4": { document: { name: "Card" } },
};

/** Mock the metadata, Images and CDN endpoints; `version` is the file version served. */
export function figmaWithRender(
  version: string,
  opts: { images?: unknown; png?: boolean; nodes?: Record<string, unknown> } = {},
): FetchSpy {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    await Promise.resolve();
    const url = requested([input]);
    if (url.includes("/images/")) return Response.json(opts.images ?? CDN_IMAGES);
    if (url.startsWith("https://cdn.example.com/")) {
      return opts.png === false ? new Response("x", { status: 404 }) : new Response(PNG_BYTES);
    }
    return Response.json({
      name: "Kit",
      version,
      lastModified: "2026-01-01T00:00:00Z",
      nodes: opts.nodes ?? DEFAULT_NODES,
    });
  });
}
