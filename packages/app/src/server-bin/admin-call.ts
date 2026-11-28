import type { ShelfOptions } from "@storyshelf/core/config";
import type { ShelfApp } from "../app-types.ts";

/** The instance's admin token: its configured one, else `SHELF_ADMIN_TOKEN`. Throws when there is none. */
export function adminTokenOf(
  options: ShelfOptions,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const token = options.config?.adminToken ?? env["SHELF_ADMIN_TOKEN"];
  if (!token) {
    throw new Error(
      "The instance has no admin token (config.adminToken / SHELF_ADMIN_TOKEN): this command runs with it.",
    );
  }
  return token;
}

/**
 * Call a site-admin endpoint of the loaded app in-process (no network, no URL): the operation is the
 * route's own, so it has one implementation.
 */
export async function adminCall<T>(
  app: ShelfApp,
  token: string,
  path: string,
  body: object,
): Promise<T> {
  const response = await app.fetch(
    new Request(`http://storyshelf.invalid${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      errorMessageOf(text) ?? `${path} answered ${response.status}: ${text.slice(0, 300)}`,
    );
  }
  return JSON.parse(text) as T;
}

/** The `error.message` of the API's error envelope, or undefined when the body is something else. */
function errorMessageOf(text: string): string | undefined {
  try {
    const body = JSON.parse(text) as { error?: { message?: unknown } } | null;
    const message = body?.error?.message;
    return typeof message === "string" && message !== "" ? message : undefined;
  } catch {
    return undefined;
  }
}
