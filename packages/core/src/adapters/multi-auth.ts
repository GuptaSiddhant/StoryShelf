import { createHmac, timingSafeEqual } from "node:crypto";
import {
  SESSION_COOKIE,
  type AuthCallback,
  type AuthUser,
  type MultiAuth,
  type MultiAuthMethod,
  type MultiAuthOptions,
} from "./auth.ts";

declare const __PKG_VERSION__: string | undefined;

/** Package version injected at build via __PKG_VERSION__. */
function packageVersion(): string {
  return (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0";
}

/** Session lifetime: 7 days, matching the single-method adapters. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Signed session payload. `providerId` records which method minted it. */
interface CompositeSessionPayload {
  userId: string;
  email: string;
  name: string;
  avatarUrl?: string;
  role: AuthUser["role"];
  groups?: string[];
  providerId?: string;
  expiresAt: number;
}

function hmacHex(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function equalStrings(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function encodePayload(payload: CompositeSessionPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodePayload(body: string): CompositeSessionPayload | null {
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as CompositeSessionPayload;
  } catch {
    return null;
  }
}

function signPayload(secret: string, payload: CompositeSessionPayload): string {
  const body = encodePayload(payload);
  return `${body}.${hmacHex(secret, body)}`;
}

function verifyPayload(secret: string, token: string): CompositeSessionPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot === -1) {
    return null;
  }
  const body = token.slice(0, dot);
  if (!equalStrings(hmacHex(secret, body), token.slice(dot + 1))) {
    return null;
  }
  return decodePayload(body);
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return undefined;
}

function toUser(payload: CompositeSessionPayload): AuthUser {
  return {
    id: payload.userId,
    email: payload.email,
    name: payload.name,
    avatarUrl: payload.avatarUrl,
    role: payload.role,
    groups: payload.groups,
    providerId: payload.providerId,
  };
}

function toPayload(user: AuthUser): CompositeSessionPayload {
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role: user.role,
    groups: user.groups,
    providerId: user.providerId,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
}

function tagProvider(user: AuthUser, providerId: string): AuthUser {
  return { ...user, providerId: user.providerId ?? providerId };
}

async function checkMembers(
  methods: MultiAuthMethod[],
  request: Request,
): Promise<AuthUser | null> {
  for (const method of methods) {
    // Sequential: first match wins; parallel would mint ambiguous sessions.
    // eslint-disable-next-line no-await-in-loop -- sequential check is intentional
    const user = await method.adapter.check(request);
    if (user) {
      return tagProvider(user, method.id);
    }
  }
  return null;
}

/** Route a callback to its method; fall back to the sole callback-capable method. */
function routeCallback(
  entries: MultiAuthMethod[],
  providerId: string | undefined,
): MultiAuthMethod | null {
  if (providerId !== undefined) {
    return entries.find((entry) => entry.id === providerId) ?? null;
  }
  const capable = entries.filter((entry) => entry.adapter.handleCallback !== undefined);
  return capable.length === 1 ? (capable.at(0) ?? null) : null;
}

/** Fail fast on empty or duplicate method ids (also re-run in `setup`). */
function assertMethods(entries: MultiAuthMethod[]): void {
  if (entries.length === 0) {
    throw new Error("Multi auth requires at least one method");
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.id === "" || seen.has(entry.id)) {
      throw new Error(`Multi auth method ids must be unique and non-empty (got "${entry.id}")`);
    }
    seen.add(entry.id);
  }
}

function buildCheck(secret: string, entries: MultiAuthMethod[]) {
  return async (request: Request): Promise<AuthUser | null> => {
    const token = readCookie(request, SESSION_COOKIE);
    if (token) {
      const payload = verifyPayload(secret, token);
      if (payload && payload.expiresAt > Date.now()) {
        return toUser(payload);
      }
    }
    return await checkMembers(entries, request);
  };
}

function buildCreateSession(secret: string) {
  // oxlint-disable-next-line typescript/promise-function-async -- AuthAdapter interface is async though signing is sync
  return (user: AuthUser): Promise<string> => Promise.resolve(signPayload(secret, toPayload(user)));
}

function buildDestroySession(entries: MultiAuthMethod[]) {
  return async (sessionId: string): Promise<void> => {
    await Promise.all(
      entries.map(
        // oxlint-disable-next-line typescript/promise-function-async -- map returns promise directly
        (method) => method.adapter.destroySession(sessionId),
      ),
    );
  };
}

function buildHandleCallback(entries: MultiAuthMethod[]) {
  return async (callback: AuthCallback): Promise<AuthUser | null> => {
    const method = routeCallback(entries, callback.providerId);
    if (!method?.adapter.handleCallback) {
      return null;
    }
    const user = await method.adapter.handleCallback(callback);
    return user ? tagProvider(user, method.id) : null;
  };
}

function buildLifecycle(secret: string, entries: MultiAuthMethod[]): MultiAuth["lifecycle"] {
  return {
    setup: async (ctx) => {
      assertMethods(entries);
      if (secret === "") {
        throw new Error("Multi auth requires a non-empty secret");
      }
      await Promise.all(
        entries.map(
          // oxlint-disable-next-line typescript/promise-function-async -- map returns promise directly
          (method) => method.adapter.lifecycle?.setup(ctx) ?? Promise.resolve(),
        ),
      );
    },
    teardown: async () => {
      await Promise.all(
        entries.map(
          // oxlint-disable-next-line typescript/promise-function-async -- map returns promise directly
          (method) => method.adapter.lifecycle?.teardown() ?? Promise.resolve(),
        ),
      );
    },
    health: async () => {
      const results = await Promise.all(
        entries.map(async (method) => ({
          id: method.id,
          ok: (await method.adapter.lifecycle?.health())?.ok ?? true,
        })),
      );
      const failures = results.filter((result) => !result.ok).map((result) => result.id);
      return failures.length === 0
        ? { ok: true }
        : { ok: false, detail: `unhealthy auth methods: ${failures.join(", ")}` };
    },
  };
}

/**
 * Create a composite auth adapter fan-out over several login methods.
 *
 * Sessions are signed once with the composite `secret` (member secrets are
 * never consulted for composite cookies). Member `check` fallbacks stay so
 * cookies minted before the upgrade keep working until re-login.
 */
export function createMultiAuth(options: MultiAuthOptions): MultiAuth {
  const { secret } = options;
  const entries: MultiAuthMethod[] = options.methods.map((method) => ({ ...method }));
  assertMethods(entries);
  return {
    metadata: {
      name: "Multi Auth",
      version: packageVersion(),
      description: "Composite auth adapter over several login methods",
      kind: "multi",
      category: "auth",
    },
    lifecycle: buildLifecycle(secret, entries),
    check: buildCheck(secret, entries),
    createSession: buildCreateSession(secret),
    destroySession: buildDestroySession(entries),
    handleCallback: buildHandleCallback(entries),
    methods: () => [...entries],
  };
}
