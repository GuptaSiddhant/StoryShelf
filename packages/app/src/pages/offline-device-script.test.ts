import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { offlineDeviceScript } from "./offline-device-script.ts";

/**
 * A MessageChannel whose port2 answers through port1, as the page's `send()` expects. The fake
 * "service worker" replies with what the real one posts (`{ ok, usage }`, see
 * shell/service-worker-sync.ts `handleMessage`), so the script is tested against the real shape.
 */
class ReplyChannel {
  readonly port1: { onmessage: ((event: { data: unknown }) => void) | null } = { onmessage: null };
  readonly port2: { postMessage(data: unknown): void };
  constructor() {
    const port1 = this.port1;
    this.port2 = { postMessage: (data) => port1.onmessage?.({ data }) };
  }
}

const usageReply = {
  ok: true,
  usage: {
    usedBytes: 2048,
    capBytes: 524_288_000,
    projects: [
      { slug: "design-system", size: 2048, syncedAt: "2026-11-20T10:00:00.000Z", expired: false },
    ],
  },
};

/** Boot the script in a page with one Library "Keep offline" button; resolves after its usage read. */
async function bootPage(reply: unknown): Promise<JSDOM> {
  const dom = new JSDOM(
    `<body><button type="button" data-offline-keep="design-system" data-offline-state="idle"
      data-idle-label="Keep offline" data-kept-label="Kept offline">Keep offline</button></body>`,
    { runScripts: "outside-only", url: "https://shelf.test/" },
  );
  const { window } = dom;
  Object.assign(window, { MessageChannel: ReplyChannel });
  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve({
        active: {
          postMessage(_message: unknown, ports: Array<{ postMessage(data: unknown): void }>) {
            queueMicrotask(() => ports[0]?.postMessage(reply));
          },
        },
      }),
    },
  });
  window.eval(offlineDeviceScript());
  // Let the usage read resolve: the worker reply, then the page's paint.
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  return dom;
}

describe("offlineDeviceScript", () => {
  it("paints a kept project's button from the worker's { ok, usage } reply", async () => {
    const dom = await bootPage(usageReply);
    const button = dom.window.document.querySelector<HTMLButtonElement>("[data-offline-keep]");
    expect(button?.dataset["offlineState"]).toBe("kept");
    expect(button?.textContent).toBe("Kept offline");
    dom.window.close();
  });
});
