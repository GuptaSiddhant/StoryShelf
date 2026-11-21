import { readSetting } from "@storyshelf/core/config";
import type { ShelfApp } from "../app-types.ts";

/**
 * Call a site-admin endpoint of the loaded app in-process (no network, no URL): the operation is the
 * route's own, so it has one implementation. The instance's own `SHELF_ADMIN_TOKEN` authorises it.
 */
export async function adminCall<T>(app: ShelfApp, path: string, body: object): Promise<T> {
  const token = readSetting(process.env, "SHELF_ADMIN_TOKEN");
  if (!token) {
    throw new Error(
      "SHELF_ADMIN_TOKEN is not set: this command runs with the instance's admin token.",
    );
  }
  const response = await app.fetch(
    new Request(`http://storyshelf.invalid${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} answered ${response.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
}
