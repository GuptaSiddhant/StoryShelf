import { createAdaptorServer } from "@hono/node-server";
import type { Logger } from "@storyshelf/core/logger";
import type { Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { remainingUntil, within } from "./deadline.ts";
import type { NodeHostApp } from "./types.ts";

/** One HTTP listener: open, then drained exactly once. */
export interface Listener {
  /** Resolves with the bound address once listening; rejects on a listen error (`EADDRINUSE`, …). */
  readonly listening: Promise<AddressInfo>;
  /**
   * Stop accepting, close idle keep-alive sockets, and let requests in flight finish (each answered
   * with `Connection: close`) until `deadline`; then destroy what is left. True when none was left.
   */
  drain(deadline: number): Promise<boolean>;
}

/** Where to listen. */
export interface ListenAt {
  port: number;
  hostname: string | undefined;
}

/** Open a listener for `app` (the port starts opening now; `listening` says when it is open). */
export function openListener(app: NodeHostApp, at: ListenAt, logger: Logger): Listener {
  const server = createAdaptorServer({ fetch: app.fetch.bind(app) }) as Server;
  const responses = trackResponses(server);
  const listening = listen(server, at, logger);
  return {
    listening,
    drain: async (deadline) => {
      responses.closing();
      if (!(await listening.then(isOpen, isClosed))) {
        return true;
      }
      return await closeBy(server, deadline);
    },
  };
}

const isOpen = (): boolean => true;
const isClosed = (): boolean => false;

/** Listen, rejecting on the first error; later server errors are logged, never thrown. */
async function listen(server: Server, at: ListenAt, logger: Logger): Promise<AddressInfo> {
  return await new Promise<AddressInfo>((resolve, reject) => {
    server.once("error", reject);
    server.listen(at.port, at.hostname, () => {
      server.off("error", reject);
      server.on("error", (error) => {
        logger.error({ err: error }, "http server error");
      });
      resolve(server.address() as AddressInfo);
    });
  });
}

/** Close the listener and wait for its connections until `deadline`, then destroy the rest. */
async function closeBy(server: Server, deadline: number): Promise<boolean> {
  const closed = new Promise<boolean>((resolve) => {
    server.close(() => {
      resolve(true);
    });
  });
  server.closeIdleConnections();
  const inTime = await within(closed, remainingUntil(deadline), false);
  if (!inTime) {
    server.closeAllConnections();
    await closed;
  }
  return inTime;
}

/**
 * Track open responses so a closing server ends keep-alive: a response not yet written goes out
 * with `Connection: close`, and each socket that turns idle is closed at once instead of after the
 * keep-alive timeout.
 */
function trackResponses(server: Server): { closing(): void } {
  const open = new Set<ServerResponse>();
  let draining = false;
  server.on("request", (_request, response: ServerResponse) => {
    if (draining) {
      response.shouldKeepAlive = false;
    }
    open.add(response);
    response.once("close", () => {
      open.delete(response);
      if (draining) {
        setImmediate(() => {
          server.closeIdleConnections();
        });
      }
    });
  });
  return {
    closing: () => {
      draining = true;
      for (const response of open) {
        if (!response.headersSent) {
          response.shouldKeepAlive = false;
        }
      }
    },
  };
}
