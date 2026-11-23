/**
 * Remote browsers for `browsers` (`@storyshelf/runner/remote`, ADR 0007): the presets, the
 * `defineRemote` constructor, leases, the pool, the connection limiter, sizing and the probes.
 */
export { remote } from "./remote.ts";
export type { BrowserName, RemoteBrowser, RemoteConnection, RemoteOptions } from "./remote.ts";
export { playwrightServer, type PlaywrightServerOptions } from "./playwright-server.ts";
export { azurePlaywright, type AzurePlaywrightOptions } from "./azure.ts";
export { browserstack, type BrowserStackOptions } from "./browserstack.ts";
export {
  defineRemote,
  isRemoteBrowser,
  hasSchemeFor,
  remoteTargetsOf,
  scrubConnection,
} from "./remote-browser.ts";
export type {
  RemoteConnectContext,
  RemoteLeaseOutcome,
  RemoteLeasedConnection,
  RemotePurpose,
  RemoteReleaseInfo,
  RemoteProtocol,
  RemoteSupport,
  RemoteTarget,
} from "./remote-browser.ts";
export {
  RemoteConnectError,
  connectLeased,
  onRemoteShutdown,
  shutdownRemote,
} from "./remote-lease.ts";
export type {
  ConnectLeasedContext,
  ConnectLeasedOptions,
  HeldConnection,
  RemoteConnectErrorOptions,
} from "./remote-lease.ts";
export { UNVERIFIED_NOTE, logRemoteSizing, remoteSizingOf } from "./remote-sizing.ts";
export type { RemoteSizing } from "./remote-sizing.ts";
export { refCounted } from "./remote-pool.ts";
export type { PoolLease, RefCounted, RefCountedOptions } from "./remote-pool.ts";
export {
  isRetryableConnectError,
  retryConnect,
  type RetryConnectOptions,
} from "./connect-retry.ts";
export {
  FONT_PROBE_FAMILIES,
  boundedProbe,
  inPageProbe,
  remoteEnvironment,
  type BrowserProbe,
  type ProbeControl,
  type ProbeOutcome,
} from "./remote-environment.ts";
export { createSessionGate, sessionGateFor, type SessionGate } from "./session-gate.ts";
