import type { AddressInfo } from "node:net";
import { sanitizedStartError, StartInterruptedError } from "./errors.ts";
import { openListener, type Listener } from "./listener.ts";
import { shutdown, type ShutdownParts } from "./shutdown.ts";
import { onShutdownSignals } from "./signals.ts";
import {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  type NodeServer,
  type ShutdownResult,
  type ShutdownTrigger,
  type StartServerOptions,
} from "./types.ts";

/**
 * Serve an existing app on Node: wait for the app to be ready (`app.lifecycle.setup()`, which
 * throws on a failed boot check), run `beforeListen`, then open the port. The host owns the
 * listener, the bounded drain and the app's teardown, which runs exactly once however the shutdown
 * starts. A failed or interrupted start cleans up what it opened and rejects with the primary
 * error, sanitised. It never calls `process.exit`: the executable owns the final exit, e.g.
 * `server.closed.then(() => process.exit())`.
 */
export async function startServer(options: StartServerOptions): Promise<NodeServer> {
  const host = createHost(options);
  try {
    await host.step(async () => {
      await options.app.lifecycle.setup();
    });
    await host.step(async () => {
      await options.beforeListen?.();
    });
    return host.started(await host.listen());
  } catch (error) {
    await host.close("start-failed");
    throw sanitizedStartError(host.interruption() ?? error);
  }
}

/** The mutable state of one host: its listener, its single shutdown and its watchers. */
interface Host {
  step(run: () => Promise<void>): Promise<void>;
  listen(): Promise<AddressInfo>;
  started(address: AddressInfo): NodeServer;
  close(trigger: ShutdownTrigger): Promise<ShutdownResult>;
  interruption(): StartInterruptedError | null;
}

function createHost(options: StartServerOptions): Host {
  const timeoutMs = shutdownTimeoutOf(options);
  const logger = options.app.lifecycle.logger;
  const state: HostState = { listener: null, closing: null, interrupted: null, running: false };
  const done = Promise.withResolvers<ShutdownResult>();
  const close = async (trigger: ShutdownTrigger): Promise<ShutdownResult> => {
    if (!state.running && trigger !== "start-failed") {
      state.interrupted ??= new StartInterruptedError(trigger);
    }
    // Synchronous up to here: the first caller starts the one shutdown, every other one shares it.
    state.closing ??= shutdownOnce(
      state,
      unwatch,
      (listener) => ({
        lifecycle: options.app.lifecycle,
        listener,
        timeoutMs,
        logger,
      }),
      trigger,
    ).then((result) => {
      done.resolve(result);
      return result;
    });
    return await state.closing;
  };
  const unwatch = watch(options, close);
  if (options.signal?.aborted) {
    close("abort").catch(() => {}); // Intentionally empty — a shutdown logs its own failures
  }
  return hostOf(options, state, close, done.promise);
}

/**
 * Shut down what the host owns (the listener read now, not earlier), then stop watching for signals.
 * The handlers stay until the shutdown settles, so a repeated signal joins it instead of hitting
 * the default action and killing the process mid-drain.
 */
async function shutdownOnce(
  state: HostState,
  unwatch: () => void,
  partsOf: (listener: Listener | null) => ShutdownParts,
  trigger: ShutdownTrigger,
): Promise<ShutdownResult> {
  try {
    return await shutdown(partsOf(state.listener), trigger);
  } finally {
    unwatch();
  }
}

interface HostState {
  listener: Listener | null;
  closing: Promise<ShutdownResult> | null;
  interrupted: StartInterruptedError | null;
  running: boolean;
}

function hostOf(
  options: StartServerOptions,
  state: HostState,
  close: (trigger: ShutdownTrigger) => Promise<ShutdownResult>,
  closed: Promise<ShutdownResult>,
): Host {
  const assertStarting = (): void => {
    if (state.interrupted) {
      throw state.interrupted;
    }
  };
  return {
    step: async (run) => {
      assertStarting();
      await run();
      assertStarting();
    },
    listen: async () => {
      assertStarting();
      const at = { port: options.port ?? 3000, hostname: options.hostname };
      state.listener = openListener(options.app, at, options.app.lifecycle.logger);
      const address = await state.listener.listening;
      assertStarting();
      return address;
    },
    started: (address) => {
      state.running = true;
      return nodeServer(address, options.hostname, close, closed);
    },
    close,
    interruption: () => state.interrupted,
  };
}

/** Shut down on SIGINT/SIGTERM (with `handleSignals`) and on `signal`'s abort; returns the unwatcher. */
function watch(
  options: StartServerOptions,
  close: (trigger: ShutdownTrigger) => Promise<ShutdownResult>,
): () => void {
  const onSignal = (trigger: ShutdownTrigger): void => {
    close(trigger).catch(() => {}); // Intentionally empty — a shutdown logs its own failures
  };
  const removeSignals = options.handleSignals ? onShutdownSignals(onSignal) : null;
  const onAbort = (): void => {
    onSignal("abort");
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  return () => {
    removeSignals?.();
    options.signal?.removeEventListener("abort", onAbort);
  };
}

function shutdownTimeoutOf(options: StartServerOptions): number {
  const timeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) {
    throw new RangeError("shutdownTimeoutMs must be a whole number of milliseconds, 0 or more");
  }
  return timeoutMs;
}

function nodeServer(
  address: AddressInfo,
  hostname: string | undefined,
  close: (trigger: ShutdownTrigger) => Promise<ShutdownResult>,
  closed: Promise<ShutdownResult>,
): NodeServer {
  return {
    port: address.port,
    url: `http://${urlHost(hostname)}:${address.port}`,
    closed,
    close: async () => await close("close"),
  };
}

/** The host part of a local URL: `localhost` for a wildcard bind, brackets around IPv6. */
function urlHost(hostname: string | undefined): string {
  if (hostname === undefined || hostname === "0.0.0.0" || hostname === "::") {
    return "localhost";
  }
  return hostname.includes(":") ? `[${hostname}]` : hostname;
}
