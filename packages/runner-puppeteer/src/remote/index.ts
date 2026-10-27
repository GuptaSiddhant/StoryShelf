/** Remote browsers for `browsers` (`@storyshelf/runner-puppeteer/remote`, ADR 0007). */
export { cdp, type CdpFixedOptions, type CdpLeasedOptions, type CdpOptions } from "./cdp.ts";
export { RemoteConnectError, refCounted } from "@storyshelf/core/adapter/capture-runner";
export type {
  PoolLease,
  RefCounted,
  RefCountedOptions,
  RemoteBrowser,
  RemoteConnectContext,
  RemoteReleaseInfo,
} from "@storyshelf/core/adapter/capture-runner";
