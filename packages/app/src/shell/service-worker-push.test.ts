import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { PUSH_ENDPOINT_HEADER } from "./service-worker-push.ts";
import { serviceWorkerScript } from "./service-worker.ts";

/* oxlint-disable typescript/promise-function-async -- fakes return pre-resolved promises */

const ORIGIN = "https://shelf.test";

type Listener = (event: Record<string, unknown>) => void;

interface Shown {
  title: string;
  options: { body: string; data: { url?: unknown } };
}

interface Rig {
  push: (data: unknown) => Promise<void>;
  click: (
    data: unknown,
    windows?: { url: string }[],
  ) => Promise<{ opened: string[]; focused: string[]; closed: boolean }>;
  logout: (
    subscribed: boolean,
  ) => Promise<{ calls: string[]; sentHeader: string | null | undefined }>;
  shown: Shown[];
}

/** Run the worker in a sandbox with a fake registration, window list and network. */
function rig(): Rig {
  const listeners = new Map<string, Listener>();
  const shown: Shown[] = [];
  const state = {
    subscription: null as null | { endpoint: string; unsubscribe: () => Promise<boolean> },
  };
  const log: string[] = [];
  const opened: string[] = [];
  const focused: string[] = [];
  let windows: { url: string; focus?: () => Promise<unknown> }[] = [];
  let sentHeader: string | null | undefined;
  const self = {
    addEventListener: (name: string, fn: Listener) => listeners.set(name, fn),
    skipWaiting: () => null,
    location: { origin: ORIGIN },
    registration: {
      showNotification: (title: string, options: Shown["options"]) => {
        shown.push({ title, options });
        return Promise.resolve();
      },
      pushManager: { getSubscription: () => Promise.resolve(state.subscription) },
    },
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve(windows),
      openWindow: (url: string) => {
        opened.push(url);
        return Promise.resolve();
      },
    },
  };
  class FakeRequest {
    url: string;
    method: string;
    headers: Headers;
    constructor(input: FakeRequest | string, init?: { headers?: Headers }) {
      this.url = typeof input === "string" ? input : input.url;
      this.method = typeof input === "string" ? "GET" : input.method;
      this.headers = init?.headers ?? (typeof input === "string" ? new Headers() : input.headers);
    }
  }
  runInNewContext(serviceWorkerScript(), {
    self,
    Request: FakeRequest,
    Headers,
    fetch: (request: FakeRequest) => {
      log.push("fetch");
      sentHeader = request.headers?.get(PUSH_ENDPOINT_HEADER);
      return Promise.resolve(new Response("ok"));
    },
    Response,
    URL,
    Date,
    setTimeout,
    Uint8Array,
    navigator: { storage: { persisted: () => Promise.resolve(true) } },
    indexedDB: {},
    caches: {},
    crypto: {},
  });
  const fire = async (name: string, event: Record<string, unknown>): Promise<void> => {
    const waits: Promise<unknown>[] = [];
    listeners.get(name)?.({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  return {
    shown,
    push: async (data) => {
      await fire("push", {
        data: data === undefined ? null : { json: () => (data === "bad" ? JSON.parse("{") : data) },
      });
    },
    click: async (data, list = []) => {
      windows = list.map((entry) => ({
        ...entry,
        focus: () => {
          focused.push(entry.url);
          return Promise.resolve();
        },
      }));
      let closed = false;
      await fire("notificationclick", {
        notification: {
          data,
          close: () => {
            closed = true;
          },
        },
      });
      return { opened: [...opened], focused: [...focused], closed };
    },
    logout: async (subscribed) => {
      log.length = 0;
      state.subscription = subscribed
        ? {
            endpoint: "https://push.example.net/p/abc",
            unsubscribe: () => {
              log.push("unsubscribe");
              return Promise.resolve(true);
            },
          }
        : null;
      const answers: Promise<Response>[] = [];
      listeners.get("fetch")?.({
        request: Object.assign(new FakeRequest(`${ORIGIN}/auth/logout`), {
          method: "POST",
          mode: "cors",
        }),
        respondWith: (p: Promise<Response>) => answers.push(p),
      });
      await answers[0];
      return { calls: [...log], sentHeader };
    },
  };
}

describe("push handler", () => {
  it("shows the title and the one-line body", async () => {
    const worker = rig();
    await worker.push({
      title: "[Shelf] review:requested",
      body: "Shelf: review:requested",
      url: "/projects/p/builds/b",
    });
    expect(worker.shown).toEqual([
      {
        title: "[Shelf] review:requested",
        options: { body: "Shelf: review:requested", data: { url: "/projects/p/builds/b" } },
      },
    ]);
  });

  it("still shows something for an empty or unreadable payload", async () => {
    const worker = rig();
    await worker.push(undefined);
    await worker.push("bad");
    expect(worker.shown.map((entry) => entry.title)).toEqual(["StoryShelf", "StoryShelf"]);
  });
});

describe("notificationclick handler", () => {
  it("opens a same-origin path", async () => {
    const result = await rig().click({ url: "/projects/p/builds/b?x=1" });
    expect(result).toEqual({
      opened: [`${ORIGIN}/projects/p/builds/b?x=1`],
      focused: [],
      closed: true,
    });
  });

  it("focuses a window that already shows the page", async () => {
    const result = await rig().click({ url: "/projects/p" }, [{ url: `${ORIGIN}/projects/p` }]);
    expect(result.focused).toEqual([`${ORIGIN}/projects/p`]);
    expect(result.opened).toEqual([]);
  });

  it("opens the home page when the payload had no link", async () => {
    expect((await rig().click({})).opened).toEqual([`${ORIGIN}/`]);
  });

  it.each([
    "https://evil.example/phish",
    "//evil.example/phish",
    "http://shelf.test.evil.example/x",
    "javascript:alert(1)",
    "data:text/html,hi",
    42,
  ])("refuses %s and opens nothing", async (url) => {
    const result = await rig().click({ url });
    expect(result.opened).toEqual([]);
    expect(result.closed).toBe(true);
  });
});

describe("sign-out", () => {
  it("unsubscribes the device before the request goes out, naming its endpoint", async () => {
    const result = await rig().logout(true);
    expect(result.calls).toEqual(["unsubscribe", "fetch"]);
    expect(result.sentHeader).toBe("https://push.example.net/p/abc");
  });

  it("sends the request untouched when the device has no push subscription", async () => {
    const result = await rig().logout(false);
    expect(result.calls).toEqual(["fetch"]);
    expect(result.sentHeader).toBeNull();
  });
});
