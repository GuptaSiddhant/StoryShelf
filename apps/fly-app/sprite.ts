import {
  refCounted,
  remote,
  type BrowserName,
  RemoteConnectError,
  type RemoteBrowser,
} from "@storyshelf/runner-playwright/remote";
/**
 * The demo's browser on a Fly Sprite: a Playwright server on a hibernating computer (see
 * `sprite/`), reached through `remote()` as the `chromium@sprite` target (ADR 0007).
 *
 * Config only, no vendor SDK. A Sprite wakes on the first request to its URL, so waking it is a
 * poll of the proxy's `/healthz` until the Playwright server behind it answers; `refCounted`
 * shares that one wake between the shards and passes of a run, and the Sprite idles by itself once
 * the connections close, so `close` has nothing to do.
 */
import { setTimeout as delay } from "node:timers/promises";

/** The header the Sprite's proxy checks the shared secret in (`sprite/proxy.mjs`). */
export const SECRET_HEADER = "x-storyshelf-secret";
const API = "https://api.sprites.dev";

/** What the demo needs to reach its browser Sprite. */
export interface SpriteConfig {
  /** Fly Sprites org token: finds the Sprite's URL through the API. Never logged. */
  token: string;
  /** The proxy's shared secret, sent on every connection. Never logged. */
  secret: string;
  /** The Sprite's name (default `storyshelf-browser`). */
  name: string;
  /** The Sprite's URL when known; otherwise the API tells. */
  url: string | null;
}

/** Seams for a test: the HTTP client and the pause between wake polls. */
export interface SpriteDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** How long one wake may take in total, and the pause between its polls (ms). */
const WAKE_TIMEOUT_MS = 60_000;
const POLL_MS = 250;

/**
 * The Sprite config from the app's environment, or `null` while the demo should render on its
 * own Chromium: both `FLY_SPRITES_TOKEN` and `SPRITE_BROWSER_SECRET` must be set.
 */
export function spriteFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): SpriteConfig | null {
  const token = nonEmpty(env["FLY_SPRITES_TOKEN"]);
  const secret = nonEmpty(env["SPRITE_BROWSER_SECRET"]);
  if (token === undefined || secret === undefined) {
    return null;
  }
  return {
    token,
    secret,
    name: nonEmpty(env["SPRITE_BROWSER_NAME"]) ?? "storyshelf-browser",
    url: nonEmpty(env["SPRITE_BROWSER_URL"]) ?? null,
  };
}

/** The runner's `browsers`: its own Chromium, and the Sprite when configured. */
export function browsersFor(
  sprite: SpriteConfig | null,
  deps: SpriteDeps = {},
): (BrowserName | RemoteBrowser)[] {
  return sprite === null ? ["chromium"] : ["chromium", spriteBrowser(sprite, deps)];
}

/** `chromium@sprite`: wakes the Sprite for a run and lets it sleep afterwards. */
export function spriteBrowser(config: SpriteConfig, deps: SpriteDeps = {}): RemoteBrowser {
  const http = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const pool = refCounted<string>({
    // Longer than the gap between a build's passes (extract, tests and shards connect close together).
    idleMs: 60_000,
    open: async (_context, signal) => await wake(config, http, sleep, signal),
    // The Sprite pauses by itself when its last connection closes: nothing to stop.
    close: () => {},
  });
  return remote({
    name: "sprite",
    engines: ["chromium"],
    protocol: "playwright",
    // The browser reaches the Storybook through this connection: no signed public URL needed.
    reach: "loopback",
    // One page at a time until measured (#511); raise with the Sprite's size.
    sessions: 1,
    timeouts: { acquireMs: WAKE_TIMEOUT_MS + 5000 },
    connect: pool.connect((url) => ({
      endpoint: websocketOf(url),
      headers: { [SECRET_HEADER]: config.secret },
    })),
    release: async (lease, info) => {
      await pool.release(lease, info);
    },
  });
}

/** Wake the Sprite and return its base URL once its Playwright server answers. */
async function wake(
  config: SpriteConfig,
  http: typeof fetch,
  sleep: NonNullable<SpriteDeps["sleep"]>,
  signal: AbortSignal,
): Promise<string> {
  const url = config.url ?? (await spriteUrl(config, http, signal));
  const deadline = Date.now() + WAKE_TIMEOUT_MS;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- one poll after another, until it answers
    if (await healthy(url, config.secret, http, signal)) {
      return url;
    }
    if (Date.now() >= deadline) {
      throw new Error("The browser Sprite did not become ready in time");
    }
    // eslint-disable-next-line no-await-in-loop -- the pause between two polls
    await sleep(POLL_MS, signal);
  }
}

/** The Sprite's URL from the Sprites API. Errors say the status, never the token. */
async function spriteUrl(
  config: SpriteConfig,
  http: typeof fetch,
  signal: AbortSignal,
): Promise<string> {
  const response = await http(`${API}/v1/sprites/${encodeURIComponent(config.name)}`, {
    headers: { authorization: `Bearer ${config.token}` },
    // Never follow a redirect with the token (or, below, the secret header) attached.
    redirect: "error",
    signal,
  });
  if (!response.ok) {
    throw new Error(`The Sprites API answered ${response.status} for the browser Sprite`);
  }
  const body = (await response.json()) as { url?: unknown };
  if (typeof body.url !== "string" || body.url === "") {
    throw new Error("The Sprites API returned no URL for the browser Sprite");
  }
  return body.url;
}

/** Whether the proxy answers `/healthz` 200: the Sprite is awake and the Playwright server is up. */
async function healthy(
  base: string,
  secret: string,
  http: typeof fetch,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const response = await http(new URL("/healthz", base), {
      headers: { [SECRET_HEADER]: secret },
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    if (response.status === 401 || response.status === 403) {
      // A wrong or rotated secret never becomes right by waiting: fail now, naming the status only.
      throw new RemoteConnectError(
        `The browser Sprite refused the secret (${response.status}); check SPRITE_BROWSER_SECRET`,
        { transient: false },
      );
    }
    return response.ok;
  } catch (error) {
    if (error instanceof RemoteConnectError) {
      throw error;
    }
    if (signal.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error("Cancelled");
    }
    return false;
  }
}

/** `https://x.sprites.app` → `wss://x.sprites.app/`. */
function websocketOf(url: string): string {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol === "http:" ? "ws:" : "wss:";
  parsed.pathname = "/";
  return parsed.toString();
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

async function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  await delay(ms, undefined, { signal });
}
