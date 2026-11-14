import type { VapidConfig } from "./types.ts";

/**
 * VAPID configuration from the environment, or undefined when push is off. Push needs
 * `SHELF_VAPID_PUBLIC_KEY`, `SHELF_VAPID_PRIVATE_KEY` (a secret) and `SHELF_VAPID_SUBJECT` (a
 * `mailto:` or `https:` contact): with both keys set the subject is required, because some push
 * services refuse a made-up one.
 *
 * @throws {Error} when both keys are set without a subject.
 */
export function vapidConfigFromEnv(
  env: Record<string, string | undefined>,
): VapidConfig | undefined {
  const publicKey = env["SHELF_VAPID_PUBLIC_KEY"]?.trim();
  const privateKey = env["SHELF_VAPID_PRIVATE_KEY"]?.trim();
  if (!publicKey || !privateKey) {
    return undefined;
  }
  const subject = env["SHELF_VAPID_SUBJECT"]?.trim();
  if (!subject) {
    throw new Error(
      "SHELF_VAPID_SUBJECT is required with the VAPID keys (a mailto: or https: URL)",
    );
  }
  return { publicKey, privateKey, subject };
}
