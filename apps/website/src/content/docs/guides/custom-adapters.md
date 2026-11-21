---
title: Write your own adapter
description: Plug a storage backend, a notifier or another adapter into createShelfApp. The contract an adapter follows, two worked examples tested in CI, and how to package one.
---

`createShelfApp` is built from adapters: a database, storage, an optional capture runner, notifiers and more, each an object that satisfies an interface from `@storyshelf/core`. If no built-in covers your backend or chat tool, you can write one in a few dozen lines and test it with the same contract suites the built-ins pass.

This page is for a developer outside this repository. Both worked examples live in the repository as [a checked fixture](https://github.com/GuptaSiddhant/StoryShelf/tree/main/apps/website/examples/custom-adapters) that CI typechecks and runs, and a test fails if a code block below stops matching its file. They import only published subpaths of `@storyshelf/core`, never `src/`.

:::caution
Before 1.0, a minor release may change an adapter interface. The change is listed under **Breaking** in the [changelog](/changelog/). Pin the minor you test against (see [Packaging](#packaging)).
:::

## What you can replace

| Adapter          | Interface (import path)                                            | Built in                                                                                            | Write your own when                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Storage          | `StorageAdapter` from `@storyshelf/core/adapter/storage`           | local disk (built into `@storyshelf/core/storage/local`), [S3, Azure Blob, GCS](/packages/#storage) | Your blob store has no preset (an internal object service, a key-value API). [Example 1](#example-1-a-storage-adapter).                                                                                            |
| Message notifier | `MessageNotifierProvider` from `@storyshelf/core/adapter/notifier` | Slack, Teams, email                                                                                 | A chat tool or webhook receiver StoryShelf does not ship. [Example 2](#example-2-a-message-notifier).                                                                                                              |
| State notifier   | `StateNotifierProvider` from `@storyshelf/core/adapter/notifier`   | GitHub, GitLab                                                                                      | A git host that shows a build as a named state (a status, a check). See [State notifiers](#state-notifiers).                                                                                                       |
| Design provider  | `DesignProvider` from `@storyshelf/core/adapter/design`            | Figma                                                                                               | Another design tool whose links should show beside a story.                                                                                                                                                        |
| Email sender     | `EmailSender` from `@storyshelf/core/adapter/email-sender`         | SMTP, HTTP, Mailpit and log presets (`@storyshelf/core/integrations`)                               | A mail API the presets do not reach.                                                                                                                                                                               |
| Capture runner   | `CaptureRunner` from `@storyshelf/core/adapter/capture-runner`     | [Playwright](/packages/runner/)                                                          | Rarely: a different rendering engine.                                                                                                                                                                              |
| Capture queue    | `CaptureQueue` from `@storyshelf/core/adapter/capture-queue`       | The database job queue                                                                              | Rarely: you must run jobs on a queue service you already operate.                                                                                                                                                  |
| Database         | Not an extension point                                             | SQLite, Postgres, MySQL                                                                             | A new driver for an existing dialect plugs in through the driver entry point of `@storyshelf/db` ([#1242](https://github.com/GuptaSiddhant/StoryShelf/issues/1242)), once that lands. See [Databases](#databases). |

The built-in notifiers and the Figma provider are registered by `createShelfApp` unless you say otherwise (`notifications.notifiers` and `design` each take an array, a function of the built-ins, or `false`). You pass storage, database and the capture runner as values.

Two things are not adapters:

- **A remote browser** is configuration. Use `defineRemote` and a preset, as described in [Remote browsers](/guides/remote-browsers/) (ADR 0007).
- **Authentication** is one engine, configured in code, not a family of adapters.

### Databases

`DatabaseAdapter` is not an extension point for third parties: the dialects are built in. What you can do depends on what you want to add:

- **A new driver or host for an existing dialect** (another serverless Postgres, a hosted MySQL, a SQLite variant) plugs in through the public driver entry point of `@storyshelf/db`, planned in [#1242](https://github.com/GuptaSiddhant/StoryShelf/issues/1242). It does not exist yet. Until it lands, use one of the built-in presets.
- **A new SQL dialect** (MSSQL, Oracle and so on) goes into `@storyshelf/db` as a pull request, not as a third-party adapter. Today the dialects live in `db-sqlite`, `db-postgres` and `db-mysql`, which become `@storyshelf/db` under #1242. A new dialect needs a `Dialect` implementation ([#1229](https://github.com/GuptaSiddhant/StoryShelf/issues/1229)) with the fenced retention lifecycle ([ADR 0039](https://github.com/GuptaSiddhant/StoryShelf/blob/main/docs/adr/0039-build-retention-lifecycle.md)), DDL and migration generation ([#1228](https://github.com/GuptaSiddhant/StoryShelf/issues/1228), [#1230](https://github.com/GuptaSiddhant/StoryShelf/issues/1230)), and it has to follow the expand and contract steps of every release ([ADR 0053](https://github.com/GuptaSiddhant/StoryShelf/blob/main/docs/adr/0053-migrations-keep-previous-release-working.md)). The bar is `databaseContractSuite` plus the lifecycle contract suites, all exported from `@storyshelf/core/test-helpers`.
- **A non-SQL store is not supported.** The models, the job queue and retention fencing assume SQL transactions.

## The contract every adapter follows

### The `Adapter` base and its metadata

Every interface extends `Adapter` (`@storyshelf/core/adapter/metadata`). An adapter is a plain object with:

- `metadata`: `name`, `version`, `kind` and `category` are required, `description` is optional. `category` is the slot (`"storage"`, `"notifier"` and so on) and is fixed by the interface you implement. `kind` is an open string that names your implementation (`"kv-http"`). Notifier kinds must be unique across everything wired into one app: two providers with the same kind stop the server at startup, naming both. To replace a built-in, filter it out of the list you return.
- `lifecycle` (optional): `setup(ctx)`, `health()` and `teardown()`. **All or nothing**: implement all three or leave `lifecycle` out. Each must be safe to call more than once. `setup` receives the resolved config and a logger (`AdapterSetupContext`) and throws when something required is missing, so a bad configuration fails at startup. `health` is a cheap probe returning `{ ok, detail? }`, and `detail` must not contain a secret.
- `setLogger(logger)` (optional): see below.

Notifier providers add `schema` (a zod schema for the channel config), `audience` (`"room"` or `"person"`), an optional `logo`, and `delivery` (`"message"`, the default, or `"state"`).

### Logging: use the logger you are given

The host calls `setLogger` with its own pino logger. Store it, derive a child with `logger.child({ component: "…" })`, and never create a logger of your own. An explicit `options.logger` wins over the bound one. Log structured objects, not interpolated strings, and put an error under `err`:

```ts
logger?.info({ channelId }, "webhook posted");
logger?.warn({ err: error, channelId }, "delivery failed");
```

A notifier's `create` receives the channel's logger in its options, and `send` and `setState` receive one per call.

### Errors and retries

Throw when an operation fails: that is the whole protocol. What happens next depends on the adapter:

- **Message notifier** (`send`): a project event is sent inline and best effort. A throw is logged by the host and recorded as the channel's outcome, with the message redacted and cut to 500 characters. Do not count on a retry.
- **State notifier** (`setState`): a refused write must throw. State is delivered by a `notify` job that retries up to five attempts in all, and `setState` is idempotent, so a retry is safe. A comment you cannot write is logged and must not fail the status.
- **Storage**: `read` and `readStream` reject for a missing object. `delete` of a missing object succeeds, so a repeated delete is idempotent. `writeStream` must not leave a partial object behind when the stream fails.
- **Lifecycle**: `setup` throws to refuse startup.

### Secrets

A secret never appears in a log, an error message or an API answer.

- A channel's secret (a webhook URL, a token) arrives decrypted, in memory, as `secret` in `create`. Keep it in a closure. Do not return it, log it or put it in `metadata`.
- Do not put request URLs that carry credentials in your own errors or logs. `redactUrlForLog(url)` from `@storyshelf/core/utils` keeps only the origin.
- The host runs adapter error text through `redactSecrets` / `sanitizeErrorText` before it shows it, but that is a backstop, not a license: write messages that do not contain secrets in the first place.

### Outbound HTTP

Make HTTP requests with `httpJson`, `httpText`, `httpBytes` or `httpStatus` from `@storyshelf/core/utils`, not another client. They add a timeout (30 seconds), retries on network errors, 429 and 502 to 504 (three attempts, honoring `Retry-After`), tracing, and log redaction. A non-2xx answer throws `HttpError`, which carries `status`, a `body` snippet and `headers`.

For a URL a **project admin** typed in (a channel's webhook), pass `destination: "project"`. The request is then refused unless the URL is `https` and public, so a channel cannot make the server call an internal address. Leave it out for a URL the operator configured, such as your storage service.

Do not add `ky`, `ofetch` or an SDK for a plain HTTP API.

## Example 1: a storage adapter

This adapter stores objects on an HTTP key-value service: `PUT`, `GET`, `HEAD` and `DELETE` on `/v1/objects/<key>`, a listing at `/v1/objects?prefix=`, and values carried as base64 in JSON. It is small, but it is a complete `StorageAdapter`.

```ts title="kv-storage.ts"
import type { AdapterHealth, AdapterLifecycle } from "@storyshelf/core/adapter/metadata";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import type { Logger } from "@storyshelf/core/logger";
import { HttpError, httpJson, httpStatus, httpText } from "@storyshelf/core/utils";
import { Buffer } from "node:buffer";
import { Readable } from "node:stream";

/** Where the key-value service lives and how to authenticate to it. */
export interface KvStorageOptions {
  baseUrl: string;
  /** The service token: sent as a header, never logged or put in an error. */
  token: string;
  /** An explicit logger wins over the one the host binds with `setLogger`. */
  logger?: Logger;
}

/** Storage on a small HTTP key-value service (`/v1/objects/<key>`), values sent as base64 JSON. */
export function createKvStorage(options: KvStorageOptions): StorageAdapter {
  const api = createKvApi(options);
  return {
    metadata: { name: "Key-value storage", version: "0.0.0", kind: "kv-http", category: "storage" },
    setLogger: api.bindLogger,
    lifecycle: kvLifecycle(api),
    ...kvObjects(api),
  };
}

/** What every request needs: URLs, the auth header and the current logger. */
interface KvApi {
  base: string;
  objectUrl(path: string): string;
  request(): { headers: Record<string, string>; logger: Logger | undefined };
  bindLogger(bound: Logger): void;
}

function createKvApi(options: KvStorageOptions): KvApi {
  const base = options.baseUrl.replace(/\/+$/u, "");
  const headers = { authorization: `Bearer ${options.token}` };
  let logger = options.logger?.child({ component: "storage-kv" });
  return {
    base,
    objectUrl: (path) => `${base}/v1/objects/${encodeURIComponent(safe(path))}`,
    request: () => ({ headers, logger }),
    bindLogger(bound): void {
      logger = (options.logger ?? bound).child({ component: "storage-kv" });
    },
  };
}

/** All three hooks or none; each is safe to call twice. */
function kvLifecycle(api: KvApi): AdapterLifecycle {
  return {
    setup(): Promise<void> {
      // A malformed URL fails at startup, not on the first upload.
      if (!URL.canParse(api.base)) return Promise.reject(new Error("baseUrl is not a valid URL"));
      return Promise.resolve();
    },
    async health(): Promise<AdapterHealth> {
      try {
        await httpStatus(`${api.base}/v1/health`, { ...api.request(), retries: 1 });
        return { ok: true };
      } catch {
        return { ok: false, detail: "key-value service unreachable" }; // never the thrown error
      }
    },
    teardown: () => Promise.resolve(), // nothing is held open
  };
}

/** The seven object operations of a `StorageAdapter`. */
function kvObjects(api: KvApi): Omit<StorageAdapter, "metadata" | "lifecycle" | "setLogger"> {
  const read = async (path: string): Promise<Buffer> => {
    // A missing object is a 404 `HttpError`, which rejects: that is the contract.
    const body = await httpJson<{ data: string }>(api.objectUrl(path), api.request());
    return Buffer.from(body.data, "base64");
  };
  const write = async (path: string, data: Buffer): Promise<void> => {
    const json = { data: data.toString("base64") };
    await httpText(api.objectUrl(path), { ...api.request(), method: "PUT", json });
  };
  return {
    read,
    write,
    exists: async (path) => await existsAt(api, path),
    delete: async (path) => await deleteAt(api, path),
    async list(prefix): Promise<string[]> {
      const url = `${api.base}/v1/objects?prefix=${encodeURIComponent(prefix)}`;
      return (await httpJson<{ keys: string[] }>(url, api.request())).keys;
    },
    async writeStream(path, stream): Promise<void> {
      // Collect first: a stream that fails midway never reaches `write`, so no partial object.
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
      await write(path, Buffer.concat(chunks));
    },
    readStream: async (path) => Readable.from([await read(path)]),
  };
}

async function existsAt(api: KvApi, path: string): Promise<boolean> {
  try {
    await httpStatus(api.objectUrl(path), { ...api.request(), method: "HEAD" });
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function deleteAt(api: KvApi, path: string): Promise<void> {
  try {
    await httpText(api.objectUrl(path), { ...api.request(), method: "DELETE" });
  } catch (error) {
    if (!isNotFound(error)) throw error; // deleting what is not there succeeds
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof HttpError && error.status === 404;
}

/** Refuse a path that climbs out of its prefix; keys are relative, `/`-separated. */
function safe(path: string): string {
  if (path.startsWith("/") || path.split("/").includes("..")) {
    throw new Error(`Unsafe storage path: ${path}`);
  }
  return path;
}
```

Points worth copying:

- `httpJson` and `httpText` do the requests, so retries, timeouts and redaction come for free. `httpJson` parses every answer as JSON, so `delete` uses `httpText`, which takes any body.
- A 404 is `HttpError` with `status` 404. `exists` and `delete` translate it; `read` lets it reject.
- `writeStream` collects the stream before writing. A stream that fails midway never reaches `write`, so nothing partial is stored. Collecting buffers the whole object in memory; a backend with a streaming upload should stream instead.
- Paths are relative and `/`-separated. The adapter refuses `..` and a leading `/`.
- `health` returns a fixed `detail`. It never repeats the thrown error, which could include the endpoint.

### Test it with the contract suite

`storageContractSuite` runs the cases every built-in storage adapter passes: metadata, an idempotent lifecycle, a write, read, exists and delete round trip, a repeated delete, recursive listing, a rejected missing read, and a streamed write that cleans up after a failure. It fakes the transport, never the adapter, so stub `fetch` (or inject a client) and keep your adapter real. Here the transport is an in-memory service:

```ts title="fake-kv-service.ts"
/** An in-memory stand-in for the key-value service, installed as `fetch` in tests. */
export function fakeKvService(token: string): typeof fetch {
  const objects = new Map<string, string>();
  return (input, init) => {
    const url = new URL(String(input));
    const authorized = new Headers(init?.headers).get("authorization") === `Bearer ${token}`;
    return Promise.resolve(authorized ? respond(objects, url, init) : deny());
  };
}

function deny(): Response {
  return new Response("denied", { status: 401 });
}

function respond(objects: Map<string, string>, url: URL, init?: RequestInit): Response {
  if (url.pathname === "/v1/health") return new Response("ok");
  if (url.pathname === "/v1/objects") {
    const prefix = url.searchParams.get("prefix") ?? "";
    return Response.json({
      keys: [...objects.keys()].filter((k) => k.startsWith(prefix)).toSorted(),
    });
  }
  return respondToObject(
    objects,
    decodeURIComponent(url.pathname.slice("/v1/objects/".length)),
    init,
  );
}

function respondToObject(objects: Map<string, string>, key: string, init?: RequestInit): Response {
  const method = init?.method ?? "GET";
  if (method === "PUT") {
    objects.set(key, (JSON.parse(String(init?.body)) as { data: string }).data);
    return new Response("stored");
  }
  const data = objects.get(key);
  if (data === undefined) return new Response("not found", { status: 404 });
  if (method === "DELETE") objects.delete(key);
  return method === "GET" ? Response.json({ data }) : new Response(null);
}
```

```ts title="kv-storage.test.ts"
import { storageContractSuite } from "@storyshelf/core/test-helpers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeKvService } from "./fake-kv-service.ts";
import { createKvStorage } from "./kv-storage.ts";

beforeEach(() => {
  vi.stubGlobal("fetch", fakeKvService("secret-token"));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// The shared contract: the same cases every built-in storage adapter passes.
storageContractSuite("kv-http", () =>
  createKvStorage({ baseUrl: "http://kv.test", token: "secret-token" }),
);

describe("kv-http storage", () => {
  it("refuses a path that climbs out of its prefix", async () => {
    const storage = createKvStorage({ baseUrl: "http://kv.test", token: "secret-token" });
    await expect(storage.read("../other")).rejects.toThrow("Unsafe storage path");
  });

  it("reports an unreachable service as not healthy, without the token", async () => {
    const storage = createKvStorage({ baseUrl: "http://kv.test", token: "wrong-token" });
    const health = await storage.lifecycle?.health();
    expect(health?.ok).toBe(false);
    expect(JSON.stringify(health)).not.toContain("wrong-token");
  });
});
```

The contract is the minimum. Add your own cases for what is yours: path safety, an unhealthy service and a wrong token, as above.

## Example 2: a message notifier

A message provider is a descriptor: `metadata` with a config schema, and `create` that binds one channel's config and secret to an adapter with `send`. This one posts `{ subject, text }` to the channel's webhook URL, which is the channel secret.

```ts title="webhook-notifier.ts"
import type {
  MessageNotifierAdapter,
  MessageNotifierProvider,
} from "@storyshelf/core/adapter/notifier";
import type { Logger } from "@storyshelf/core/logger";
import { httpStatus } from "@storyshelf/core/utils";
import { z } from "zod";

/** What a project admin may set on a channel of this kind; the URL is the secret, not config. */
export const webhookConfigSchema = z.object({ prefix: z.string().min(1).optional() });

/** A chat-style provider that POSTs `{ subject, text }` as JSON to the channel's webhook URL. */
export const jsonWebhookNotifier: MessageNotifierProvider = {
  metadata: {
    name: "JSON webhook",
    version: "0.0.0",
    kind: "json-webhook",
    category: "notifier",
    audience: "room",
    schema: webhookConfigSchema,
  },
  create(opts: { config: unknown; secret?: string; logger?: Logger }): MessageNotifierAdapter {
    const config = webhookConfigSchema.parse(opts.config); // an invalid config throws here
    const logger = opts.logger?.child({ component: "notify-json-webhook" });
    const url = opts.secret;
    return {
      metadata: jsonWebhookNotifier.metadata,
      async send({ channel, formatted }): Promise<void> {
        if (!url) throw new Error("JSON webhook channel is missing its URL secret");
        const subject = config.prefix ? `${config.prefix} ${formatted.subject}` : formatted.subject;
        // The URL was set by a project admin, so mark it `project`: https and public only.
        // `httpStatus` never reads the response body: a receiver that echoes the URL (the secret)
        // in an error cannot get it into the thrown `HTTP <status>` message.
        await httpStatus(url, {
          method: "POST",
          json: { subject, text: formatted.text },
          destination: "project",
          logger,
        });
        logger?.info({ channelId: channel.id }, "webhook posted"); // never log `url`
      },
    };
  },
};
```

Points worth copying:

- `create` validates the config with the schema and throws on an invalid one.
- `send` gets `formatted`, with `subject`, `text`, `markdown` and `html` already rendered. Use the field your target understands. Slack uses `markdown` in a block, and email uses `html`.
- The URL is a project's, so the request carries `destination: "project"`, and the URL is never logged.
- A missing secret throws, so the channel shows a failed outcome.

### Test it with the contract suite

`notifierContractSuite` checks structure: notifier metadata with a schema, a `create` function and a schema that can parse. Delivery stays yours to test behind a faked transport. Requests with `destination: "project"` do not use the global `fetch` directly, so call `publicNetworkForTests()` from `@storyshelf/core/test-helpers` to resolve every host to a public address and route the guarded transport to your stubbed `fetch`. It returns a restore function.

```ts title="webhook-notifier.test.ts"
import type { NotificationChannel } from "@storyshelf/core/adapter/notifier";
import { notifierContractSuite, publicNetworkForTests } from "@storyshelf/core/test-helpers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonWebhookNotifier } from "./webhook-notifier.ts";

const formatted = { subject: "Build approved", text: "ok", markdown: "ok", html: "<p>ok</p>" };
const channel = {
  id: "chan-1",
  projectId: "proj-1",
  provider: "json-webhook",
} as NotificationChannel;
const url = "https://hooks.example.com/T123/secret-path";
let restore: () => void;
const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => new Response("ok"));

beforeEach(() => {
  vi.stubGlobal("fetch", fetchSpy);
  restore = publicNetworkForTests();
});
afterEach(() => {
  restore();
  vi.unstubAllGlobals();
  fetchSpy.mockClear();
});

// The shared structural contract: metadata, create descriptor and a real config schema.
notifierContractSuite("json-webhook", () => jsonWebhookNotifier);

describe("json-webhook notifier", () => {
  it("posts the subject and text to the secret URL", async () => {
    const adapter = jsonWebhookNotifier.create({ config: { prefix: "[shelf]" }, secret: url });
    await adapter.send({ channel, formatted });
    const [target, init] = fetchSpy.mock.calls[0] ?? [];
    expect(target).toBe(url);
    expect(JSON.parse(String(init?.body))).toEqual({
      subject: "[shelf] Build approved",
      text: "ok",
    });
  });

  it("throws on a refused delivery so the job retries, without the URL in the error", async () => {
    fetchSpy.mockResolvedValue(new Response("nope", { status: 400 }));
    const adapter = jsonWebhookNotifier.create({ config: {}, secret: url });
    const failure = await adapter.send({ channel, formatted }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain("secret-path");
  });

  it("keeps a response body that echoes the URL out of the thrown message", async () => {
    fetchSpy.mockResolvedValue(new Response(`bad hook ${url}`, { status: 500 }));
    const adapter = jsonWebhookNotifier.create({ config: {}, secret: url });
    const failure = await adapter.send({ channel, formatted }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("HTTP 500");
    expect((failure as Error).message).not.toContain("bad hook");
    expect(String(failure)).not.toContain("secret-path");
  });

  it("rejects an invalid config and a missing secret", async () => {
    expect(() => jsonWebhookNotifier.create({ config: { prefix: "" }, secret: url })).toThrow();
    const adapter = jsonWebhookNotifier.create({ config: {} });
    await expect(adapter.send({ channel, formatted })).rejects.toThrow("missing its URL secret");
  });
});
```

### State notifiers

A git host shows a build as a state, so a state provider differs from a message provider:

- `metadata.delivery` is `"state"` and mandatory.
- The adapter implements `setState({ channel, target, state, url, logger })` instead of `send`. It is idempotent and the latest call wins. A `target` it cannot show, such as a comment on a host with no comments, is skipped silently. `url` is absent while the server has no public origin, and then a status has no link and a comment is not written.
- `commitOnBranch({ sha, branch })` is optional. It lets the host confirm that a build claiming the default branch really is on it.
- Never decide a status yourself. The server computes the desired statuses with the pure `statusesForBuild` and queues one `notify` job per git channel. Your `setState` only makes the host show the state it is handed, and throws when the host refuses.

Test one with `stateNotifierContractSuite(label, make, validConfig)`. It runs the notifier suite and then checks that the provider declares state delivery, that `create` with a valid config returns an adapter with `setState`, and that `create` throws for an invalid config. Copy the structure of the built-in GitHub and GitLab providers in `@storyshelf/core/integrations`.

## Wire it into `createShelfApp`

Storage is a value. Notifiers go in `notifications.notifiers`, as an array (exactly these) or a function that receives the built-ins:

```ts title="wire.ts"
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
```

The kind you chose is what a channel's `provider` field names. A project admin adds a `json-webhook` channel in the notification settings or through the API, as in [Notifications](/guides/notifications/#configure-channels-project-admin), with the webhook URL as its `secret`. The channel's `config` is validated against your schema.

Options for `createShelfApp` are described in [Server configuration](/guides/config/#server-config-vs-client-config).

## Packaging

Publish the adapter as its own package:

- **Name:** `storyshelf-adapter-<name>`, for example `storyshelf-adapter-kv`. Never use the `@storyshelf/*` scope; it belongs to the project.
- **ESM only.** Set `"type": "module"` and ship `.mjs` or `.js` with `exports`. StoryShelf is ESM.
- **`@storyshelf/core` is a peer dependency**, not a dependency, so your adapter and the server share one copy of the interfaces, `HttpError` and the logger. List it in `devDependencies` too, for your tests. A notifier's `schema` is a zod schema, so make `zod` a peer dependency as well, on the major `@storyshelf/core` uses.
- **One production owner per third-party dependency.** If your adapter needs an SDK, list it in your `dependencies` once, and re-export nothing from it. A package that needs only HTTP needs no dependency at all, as both examples show.
- **Say which versions you support.** Interfaces may change in a minor before 1.0, so use a caret range that stays inside the minor you tested: `"@storyshelf/core": "^0.14.0"` means `>=0.14.0 <0.15.0`. Widen it after you run your contract suites against the next minor, and read its **Breaking** notes first.
- **Run the contract suite in your CI**, against the newest StoryShelf release, so a breaking change shows up as a red build rather than as a failed channel.

A minimal `package.json`:

```json
{
  "name": "storyshelf-adapter-kv",
  "version": "1.0.0",
  "type": "module",
  "types": "./dist/index.d.mts",
  "exports": { ".": "./dist/index.mjs" },
  "peerDependencies": { "@storyshelf/core": "^0.14.0" },
  "devDependencies": { "@storyshelf/core": "^0.14.0", "vitest": "^5.0.0" }
}
```

## Reference

- [`@storyshelf/core`](/packages/core/): the generated API for every adapter interface and contract suite.
- [Notifications](/guides/notifications/): channels, events and what a message contains.
- [Remote browsers](/guides/remote-browsers/): configuration instead of an adapter.
- [Upgrading and support](/guides/support/): what a release promises, and where breaking changes are announced.
