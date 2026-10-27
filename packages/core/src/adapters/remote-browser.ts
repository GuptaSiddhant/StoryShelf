/**
 * Remote browsers (ADR 0007, decisions 1 and 3): one service a runner connects to instead of
 * launching a browser, expanding to one `<engine>@<name>` target per engine. Presets are plain
 * configuration over {@link defineRemote}; the runners add only what they can drive.
 */
import {
  TARGET_NAME_PATTERN,
  isBrowserName,
  type BrowserName,
  type CaptureTarget,
  type TargetReach,
} from "./capture-target.ts";

/** How a runner talks to the service: Playwright's own protocol, or the Chrome DevTools Protocol. */
export type RemoteProtocol = "playwright" | "cdp";

/** Where and how to connect. A function `connect` is called per connection, so a token can be fresh. */
export interface RemoteConnection {
  /** `ws(s)://…` (CDP also accepts `http(s)://…`). May carry credentials: it is never logged. */
  endpoint: string;
  /** Request headers for the handshake, such as `authorization`. Never logged. */
  headers?: Record<string, string>;
}

/** A connection a function `connect` returns, with what `release` needs back. */
export interface RemoteLeasedConnection<TLease = unknown> extends RemoteConnection {
  /** Opaque to the runner, handed to `release` once and never logged (it may carry credentials). */
  lease?: TLease | undefined;
}

/** What a run is doing when it connects. */
export type RemotePurpose = "render" | "extract" | "tests";

/** How a leased connection ended, handed to `release`. */
export type RemoteLeaseOutcome = "finished" | "failed" | "cancelled";

/** What a function `connect` is told about the connection it is asked for. */
export interface RemoteConnectContext {
  engine: BrowserName;
  /** The StoryShelf build; the same for every shard of it. */
  buildId: string;
  /** The shard's own id; the build id when the render is not sharded. */
  runId: string;
  /** The shard's 1-based position in the build's plan; `undefined` (never 0) when not sharded. */
  shardIndex?: number | undefined;
  /** `render` for a build or shard, `extract` for the parameter pre-pass, `tests` for `.test()` entries. */
  purpose: RemotePurpose;
  /** This connection's attempt, from 1; each retry connects anew. */
  attempt: number;
  /**
   * Aborts while `connect` is pending: on `timeouts.acquireMs`, a cancel (user, build, render
   * budget) and shutdown. Spent once `connect` resolves.
   */
  signal: AbortSignal;
}

/** What `release` is told about how the connection's render went. */
export interface RemoteReleaseInfo {
  outcome: RemoteLeaseOutcome;
  /** Why it failed, for `failed`. Carries no credentials, but may carry provider text. */
  error?: unknown;
}

/** What {@link defineRemote} takes: what `remote()` exposes to operators. */
export interface RemoteOptions<TLease = unknown> {
  /** The target name half (`chromium@<name>`): lowercase letters, digits and hyphens, at most 32. */
  name: string;
  /** The engines to offer (a subset of what the service has). */
  engines: readonly BrowserName[];
  /** Parallel sessions the plan allows: the page cap of the target, per process (decision 4). A function is read live. */
  sessions: number | (() => number);
  /** Declared, never inferred: how the runner talks to the service. */
  protocol: RemoteProtocol;
  /**
   * Declared, never inferred: `loopback` when the remote browser can route back to this host
   * (Playwright's `exposeNetwork: "<loopback>"`), else `url` (it needs a signed Storybook URL).
   */
  reach: TargetReach;
  /**
   * The connection: an object for a fixed service (validated at creation), or a function called
   * for every connection (sync or async) to wake or start something, pick a server per shard, or
   * mint a token. A throw is retried and ends as a `TargetLaunchError`.
   */
  connect:
    | RemoteConnection
    | ((
        context: RemoteConnectContext,
      ) => RemoteLeasedConnection<TLease> | Promise<RemoteLeasedConnection<TLease>>);
  /**
   * Called once for every connection `connect` returned a `lease` for, after the render that used
   * it finished, failed or was cancelled (and for leases still held at shutdown, `cancelled`).
   * Only valid with a function `connect`. A throw or a timeout (`timeouts.releaseMs`) is logged and
   * never fails the render.
   */
  release?: ((lease: TLease, info: RemoteReleaseInfo) => Promise<void> | void) | undefined;
  /** OS the service renders on, reported when the page cannot tell (`linux-x64`, `windows`, …). */
  platform?: string | undefined;
  /** Connect retries: `attempts` after the first (default 3), `backoffMs` doubling (default 500). */
  retry?: { attempts?: number | undefined; backoffMs?: number | undefined } | undefined;
  /**
   * `acquireMs` bounds the `connect` function, `connectMs` the handshake after it (a farm with a
   * client cap queues extra connections, so a busy farm shows up as this timeout), `releaseMs`
   * the `release` hook. All default to 30 000.
   */
  timeouts?:
    | {
        acquireMs?: number | undefined;
        connectMs?: number | undefined;
        releaseMs?: number | undefined;
      }
    | undefined;
}

/** One remote service, validated: an entry of a runner's `browsers`. */
export interface RemoteBrowser {
  readonly kind: "remote";
  readonly name: string;
  readonly engines: readonly BrowserName[];
  readonly sessions: number | (() => number);
  readonly protocol: RemoteProtocol;
  readonly reach: TargetReach;
  readonly connect: RemoteOptions["connect"];
  readonly release: ((lease: never, info: RemoteReleaseInfo) => Promise<void> | void) | undefined;
  readonly platform: string | undefined;
  readonly retry: { readonly attempts: number; readonly backoffMs: number };
  readonly timeouts: {
    readonly acquireMs: number;
    readonly connectMs: number;
    readonly releaseMs: number;
  };
}

/** What a runner supports, which {@link defineRemote} checks the service against. */
export interface RemoteSupport {
  /** Engines the runner can drive. */
  engines: readonly BrowserName[];
  /** Protocols the runner can speak. */
  protocols: readonly RemoteProtocol[];
  /** Shown in errors, for example `remote()`. */
  label: string;
}

/** One target a remote service offers. */
export interface RemoteTarget {
  kind: "remote";
  target: CaptureTarget;
  engine: BrowserName;
  remote: RemoteBrowser;
  /** How the browser reaches the Storybook. */
  reach: TargetReach;
}

const CDP_ENGINES = new Set<BrowserName>(["chromium", "chrome"]);
const SCHEMES: Record<RemoteProtocol, readonly string[]> = {
  playwright: ["ws:", "wss:"],
  cdp: ["ws:", "wss:", "http:", "https:"],
};

/** Options 0.7 took that 0.8 renamed or removed, with what replaces them (a loud migration error). */
const MOVED: Record<string, string> = {
  acquire: "merge it into `connect` (a function that receives a context)",
  exposeNetwork: 'declare `reach: "loopback"` on the service instead',
  connectRetries: "use `retry: { attempts }`",
  connectBackoffMs: "use `retry: { backoffMs }`",
  connectTimeoutMs: "use `timeouts: { connectMs }`",
  acquireTimeoutMs: "use `timeouts: { acquireMs }`",
};

const KNOWN = new Set([
  "name",
  "engines",
  "sessions",
  "protocol",
  "reach",
  "connect",
  "release",
  "platform",
  "retry",
  "timeouts",
]);

/**
 * Validate a remote service eagerly, so a mistake fails when the runner is created and not when the
 * first build runs: unknown or moved options, the name, the sessions, the engines against what the
 * runner drives, the protocol, the reach, and a fixed connection (endpoint scheme).
 */
export function defineRemote<TLease = unknown>(
  options: RemoteOptions<TLease>,
  support: RemoteSupport,
): RemoteBrowser {
  const plain = options as unknown as RemoteOptions;
  checkOptions(plain, support);
  checkEngines(plain, support);
  checkProtocol(plain, support);
  return {
    kind: "remote",
    name: options.name,
    engines: [...options.engines],
    sessions: options.sessions,
    protocol: options.protocol,
    reach: options.reach,
    connect: options.connect,
    release: options.release,
    platform: options.platform,
    retry: { attempts: options.retry?.attempts ?? 3, backoffMs: options.retry?.backoffMs ?? 500 },
    timeouts: {
      acquireMs: options.timeouts?.acquireMs ?? 30_000,
      connectMs: options.timeouts?.connectMs ?? 30_000,
      releaseMs: options.timeouts?.releaseMs ?? 30_000,
    },
  };
}

/** The targets a service offers, in the order of its `engines`. */
export function remoteTargetsOf(remote: RemoteBrowser): RemoteTarget[] {
  return remote.engines.map((engine) => ({
    kind: "remote",
    target: `${engine}@${remote.name}`,
    engine,
    remote,
    reach: remote.reach,
  }));
}

/** Whether a value is a remote service entry. */
export function isRemoteBrowser(value: unknown): value is RemoteBrowser {
  return typeof value === "object" && value !== null && (value as RemoteBrowser).kind === "remote";
}

/** Whether `endpoint` has a scheme `protocol` can open. */
export function hasSchemeFor(protocol: RemoteProtocol, endpoint: string): boolean {
  try {
    return SCHEMES[protocol].includes(new URL(endpoint).protocol);
  } catch {
    return false;
  }
}

/** The schemes `protocol` accepts, for messages. */
export function schemesOf(protocol: RemoteProtocol): string {
  return SCHEMES[protocol].join(" or ");
}

/**
 * Remove what identifies the connection from text surfaced to operators: the endpoint (it can carry
 * a key in its path or query), its host and path, its query values, every header value and every
 * value inside the lease (non-strings are stringified).
 */
export function scrubConnection(
  text: string,
  connection: RemoteConnection & { lease?: unknown },
): string {
  const secrets = [
    connection.endpoint,
    ...Object.values(connection.headers ?? {}),
    ...leaseSecrets(connection.lease),
  ];
  try {
    const url = new URL(connection.endpoint);
    // Drivers echo the endpoint without its query; the host and a path that acts as a key stay hidden.
    secrets.push(
      url.password,
      ...url.searchParams.values(),
      decodeURIComponent(url.search),
      `${url.protocol}//${url.host}${url.pathname}`,
      url.host,
      url.pathname,
    );
  } catch {
    // An unparsable endpoint is scrubbed whole above.
  }
  let scrubbed = text;
  // Longest first: the endpoint goes before the fragments it contains.
  for (const secret of secrets
    .filter((value) => value.length >= 4)
    .toSorted((a, b) => b.length - a.length)) {
    scrubbed = scrubbed.replaceAll(secret, "[redacted]");
  }
  return scrubbed;
}

/** Every value of a lease, as text: a string whole, anything else stringified, objects walked. */
function leaseSecrets(lease: unknown, depth = 0): string[] {
  if (lease === undefined || lease === null) {
    return [];
  }
  if (typeof lease === "object") {
    return depth > 3 ? [] : Object.values(lease).flatMap((value) => leaseSecrets(value, depth + 1));
  }
  return typeof lease === "string" || typeof lease === "number" || typeof lease === "boolean"
    ? [String(lease)]
    : [];
}

function checkKnownKeys(options: RemoteOptions, where: string): void {
  for (const key of Object.keys(options)) {
    if (!KNOWN.has(key)) {
      const moved = MOVED[key];
      throw new Error(
        moved === undefined
          ? `${where}: unknown option "${key}"`
          : `${where}: option "${key}" is gone in 0.8: ${moved}`,
      );
    }
  }
}

function checkOptions(options: RemoteOptions, { label }: RemoteSupport): void {
  const where = `${label} "${options.name}"`;
  checkKnownKeys(options, where);
  if (!TARGET_NAME_PATTERN.test(options.name)) {
    throw new Error(
      `${label}: name "${options.name}" must be lowercase letters, digits and hyphens, start with a letter or digit and be at most 32 characters`,
    );
  }
  checkSessions(options.sessions, where);
  checkNumbers(options, where);
  if (options.release !== undefined && typeof options.connect !== "function") {
    throw new Error(`${where}: release needs a function connect (a fixed connection has no lease)`);
  }
}

function checkSessions(sessions: RemoteOptions["sessions"], where: string): void {
  const value = typeof sessions === "function" ? sessions() : sessions;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${where}: sessions must be a positive integer`);
  }
}

function checkNumbers(options: RemoteOptions, where: string): void {
  const entries: [string, number | undefined][] = [
    ["retry.attempts", options.retry?.attempts],
    ["timeouts.acquireMs", options.timeouts?.acquireMs],
    ["timeouts.connectMs", options.timeouts?.connectMs],
    ["timeouts.releaseMs", options.timeouts?.releaseMs],
    ["retry.backoffMs", options.retry?.backoffMs],
  ];
  for (const [name, value] of entries) {
    const allowed = name === "retry.attempts" || name === "retry.backoffMs" ? 0 : 1;
    if (value !== undefined && (!Number.isInteger(value) || value < allowed)) {
      throw new Error(`${where}: ${name} must be an integer of at least ${allowed}`);
    }
  }
}

function checkEngines(options: RemoteOptions, support: RemoteSupport): void {
  const where = `${support.label} "${options.name}"`;
  if (options.engines.length === 0) {
    throw new Error(`${where}: engines must list at least one engine`);
  }
  for (const [index, engine] of options.engines.entries()) {
    if (!isBrowserName(engine)) {
      throw new Error(`${where}: unknown engine "${String(engine)}"`);
    }
    if (!support.engines.includes(engine)) {
      throw new Error(
        `${where}: this runner cannot drive "${engine}" (it drives ${support.engines.join(", ")})`,
      );
    }
    if (options.engines.indexOf(engine) !== index) {
      throw new Error(`${where}: engine "${engine}" is listed twice`);
    }
  }
}

function checkProtocol(options: RemoteOptions, support: RemoteSupport): void {
  const where = `${support.label} "${options.name}"`;
  checkDeclared(options, support, where);
  if (options.protocol === "cdp") {
    checkCdp(options, where);
  }
  if (typeof options.connect !== "function") {
    checkFixedConnection(options.connect, options.protocol, where);
  }
}

function checkDeclared(options: RemoteOptions, support: RemoteSupport, where: string): void {
  if (options.protocol === undefined || options.reach === undefined) {
    throw new Error(
      `${where}: "protocol" and "reach" are required in 0.8 (declare how the runner talks to the service and whether its browser can reach this host)`,
    );
  }
  if (!support.protocols.includes(options.protocol)) {
    throw new Error(
      `${where}: protocol "${options.protocol}" is not supported by this runner (it speaks ${support.protocols.join(", ")})`,
    );
  }
  if (options.reach !== "loopback" && options.reach !== "url") {
    throw new Error(`${where}: reach must be "loopback" or "url"`);
  }
}

function checkCdp(options: RemoteOptions, where: string): void {
  const bad = options.engines.find((engine) => !CDP_ENGINES.has(engine));
  if (bad !== undefined) {
    throw new Error(`${where}: the CDP protocol drives Chromium only, not "${bad}"`);
  }
  if (options.reach === "loopback") {
    throw new Error(`${where}: reach "loopback" needs the "playwright" protocol`);
  }
}

function checkFixedConnection(
  connection: RemoteConnection,
  protocol: RemoteProtocol,
  where: string,
): void {
  const extra = Object.keys(connection).filter((key) => key !== "endpoint" && key !== "headers");
  if (extra.length > 0) {
    throw new Error(`${where}: connect has unknown field(s) ${extra.join(", ")}`);
  }
  if (!hasSchemeFor(protocol, connection.endpoint)) {
    throw new Error(`${where}: the endpoint must be a ${schemesOf(protocol)} URL`);
  }
}
