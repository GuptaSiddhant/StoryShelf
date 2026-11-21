import { createShelfApp, type ShelfApp } from "@storyshelf/app";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createKvStorage } from "./kv-storage.ts";
import { jsonWebhookNotifier } from "./webhook-notifier.ts";

/** Compose a shelf from a database adapter plus the two custom adapters. */
export function createShelf(database: DatabaseAdapter, kvToken: string): ShelfApp {
  return createShelfApp({
    database,
    storage: createKvStorage({ baseUrl: "https://kv.internal.example.com", token: kvToken }),
    notifications: {
      // Keep the built-in Slack, Teams and git providers and add one more kind.
      notifiers: (builtIn) => [...builtIn, jsonWebhookNotifier],
    },
  });
}
