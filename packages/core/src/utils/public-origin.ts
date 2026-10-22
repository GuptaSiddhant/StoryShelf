/** Finding the address a deployment is reached at without being told (ADR 0007, decision 6). */

/** Environment variables, as `process.env` has them. */
export type Env = Readonly<Record<string, string | undefined>>;

/**
 * The origin (`scheme://host[:port]`) of `value`, or `undefined` when it is not an http(s) URL
 * without credentials. A bare host (`app.example.com`), as platforms often publish, reads as https.
 */
export function normalizeOrigin(value?: string): string | undefined {
  const text = value?.trim();
  if (!text) {
    return undefined;
  }
  // `javascript:alert(1)`, `mailto:x`: a scheme with no `//` is no address (`host:8443` is).
  if (/^[a-z][a-z\d+.-]*:(?!\/\/|\d+(?:\/|$))/iu.test(text)) {
    return undefined;
  }
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//iu.test(text) ? text : `https://${text}`);
    const web = url.protocol === "https:" || url.protocol === "http:";
    return web && url.username === "" && url.password === "" && url.hostname !== ""
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}

/** One platform: the variables that say its address, tried in order. */
interface Platform {
  /** Variable whose presence says the app runs there; absent when the address variable alone says so. */
  marker?: readonly [string, string?];
  /** Variables holding a host or URL, first set one wins. */
  address: readonly string[];
}

const PLATFORMS: readonly Platform[] = [
  // Heroku: needs the `runtime-dyno-metadata` Labs feature.
  { address: ["HEROKU_APP_DEFAULT_DOMAIN_NAME"] },
  // Railway: only when the service has a public domain.
  { address: ["RAILWAY_PUBLIC_DOMAIN"] },
  // Vercel: the production alias beats the per-deployment URL.
  { marker: ["VERCEL", "1"], address: ["VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_URL"] },
  // Netlify: `URL` is the site's main URL (a generic name, so it needs the platform marker).
  { marker: ["NETLIFY", "true"], address: ["URL", "DEPLOY_PRIME_URL"] },
  // Render.
  { address: ["RENDER_EXTERNAL_URL", "RENDER_EXTERNAL_HOSTNAME"] },
  // Azure App Service.
  { address: ["WEBSITE_HOSTNAME"] },
  // DigitalOcean App Platform: `APP_URL` is a bindable variable the app spec must set.
  { marker: ["DIGITALOCEAN_APP_ID"], address: ["APP_URL"] },
];

/**
 * The address the hosting platform publishes in `env`, as an origin, or `undefined` when none is
 * set. It is the platform's own domain, a working fallback but the wrong link behind a custom
 * domain. Cloud Run, AWS App Runner, Lambda function URLs and Cloudflare Workers publish nothing.
 */
export function detectPublicBaseUrl(env: Env): string | undefined {
  for (const platform of PLATFORMS) {
    const found = fromPlatform(platform, env);
    if (found !== undefined) {
      return found;
    }
  }
  return fromFly(env) ?? fromContainerApps(env);
}

function fromPlatform(platform: Platform, env: Env): string | undefined {
  if (platform.marker !== undefined) {
    const [name, expected] = platform.marker;
    const actual = env[name];
    if (actual === undefined || actual === "" || (expected !== undefined && actual !== expected)) {
      return undefined;
    }
  }
  for (const name of platform.address) {
    const origin = normalizeOrigin(env[name]);
    if (origin !== undefined) {
      return origin;
    }
  }
  return undefined;
}

/** Fly.io: `<app>.fly.dev`. */
function fromFly(env: Env): string | undefined {
  const app = env["FLY_APP_NAME"];
  return app ? normalizeOrigin(`${app}.fly.dev`) : undefined;
}

/** Azure Container Apps: `<app>.<environment DNS suffix>`. */
function fromContainerApps(env: Env): string | undefined {
  const app = env["CONTAINER_APP_NAME"];
  const suffix = env["CONTAINER_APP_ENV_DNS_SUFFIX"];
  return app && suffix ? normalizeOrigin(`${app}.${suffix}`) : undefined;
}
