/**
 * Child process of `start-server.signals.test.ts`: the real app behind `startServer` with
 * `handleSignals`, reporting on stdout. It never calls `process.exit`: the test checks that the
 * process ends on its own once the host has shut down and removed its handlers.
 */
import { startServer } from "../index.ts";
import { realApp } from "./real-app.ts";

const counts = (): Record<string, number> => ({
  SIGINT: process.listenerCount("SIGINT"),
  SIGTERM: process.listenerCount("SIGTERM"),
});
const report = (line: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify(line)}\n`);
};

const real = realApp({ teardownDelayMs: 500 });
const before = counts();
const server = await startServer({
  app: real.app,
  port: 0,
  hostname: "127.0.0.1",
  handleSignals: true,
  shutdownTimeoutMs: 5000,
});
// The pid of this node process: `nub` runs it under a wrapper, which must not get the signal.
report({ event: "listening", pid: process.pid, port: server.port, handlers: counts(), before });
const result = await server.closed;
report({ event: "closed", result, teardowns: real.teardowns(), handlers: counts(), before });
real.cleanup();
