import type { VapidConfig } from "./types.ts";

/**
 * VAPID configuration from the environment, or undefined when push is off. Push needs both keys:
 * `SHELF_VAPID_PUBLIC_KEY`, `SHELF_VAPID_PRIVATE_KEY` (a secret), and `SHELF_VAPID_SUBJECT`
 * (a `mailto:` or `https:` contact).
 */
export function vapidConfigFromEnv(
  env: Record<string, string | undefined>,
): VapidConfig | undefined {
  const publicKey = env["SHELF_VAPID_PUBLIC_KEY"]?.trim();
  const privateKey = env["SHELF_VAPID_PRIVATE_KEY"]?.trim();
  if (!publicKey || !privateKey) {
    return undefined;
  }
  return {
    publicKey,
    privateKey,
    subject:
      env["SHELF_VAPID_SUBJECT"]?.trim().replace(/^$/u, "mailto:admin@localhost") ??
      "mailto:admin@localhost",
  };
}
