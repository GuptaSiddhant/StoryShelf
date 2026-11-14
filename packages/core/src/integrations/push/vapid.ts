import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { fromBase64Url, toBase64Url } from "./base64url.ts";
import type { VapidConfig } from "./types.ts";

/** A VAPID token lives at most 24 hours (RFC 8292, section 2). */
const TOKEN_SECONDS = 12 * 60 * 60;

/** A cached token is reused this long (well inside its own lifetime), then signed again. */
const CACHE_MS = 3 * 60 * 60 * 1000;

/** Origins whose token is cached at once; endpoints are user-registered, so the map is bounded. */
const CACHE_LIMIT = 64;

/**
 * One server-wide VAPID identity. The private key lives only inside a `KeyObject` built once, so it
 * is not an enumerable property that a log call, an error or a serializer could pick up.
 */
export interface Vapid {
  /** Uncompressed P-256 public key, base64url. Safe to expose. */
  readonly publicKey: string;
  /** Contact for the push service: a `mailto:` or `https:` URL. */
  readonly subject: string;
  /** The `Authorization` header value of RFC 8292, section 3, for a push endpoint. */
  authorization(endpoint: string, nowMs?: number): string;
}

/** Private key object from a raw scalar and its uncompressed public key. */
function vapidPrivateKey(config: Pick<VapidConfig, "publicKey" | "privateKey">): KeyObject {
  const point = fromBase64Url(config.publicKey);
  if (point.length !== 65 || point[0] !== 4) {
    throw new Error("VAPID public key must be an uncompressed P-256 point");
  }
  return createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      d: config.privateKey,
      x: toBase64Url(point.subarray(1, 33)),
      y: toBase64Url(point.subarray(33, 65)),
    },
  });
}

/** ES256 JWT for a push service origin (RFC 8292, section 2). */
export function signVapidJwt(
  key: KeyObject,
  subject: string,
  audience: string,
  nowMs = Date.now(),
): string {
  const header = toBase64Url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = toBase64Url(
    Buffer.from(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(nowMs / 1000) + TOKEN_SECONDS,
        sub: subject,
      }),
    ),
  );
  const input = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
  return `${input}.${toBase64Url(signature)}`;
}

/** Whether `jwt` carries a valid ES256 signature by `publicKey` (base64url, uncompressed). */
export function verifyVapidJwt(jwt: string, publicKey: string): boolean {
  const [header, claims, signature] = jwt.split(".");
  if (!header || !claims || !signature) {
    return false;
  }
  const point = fromBase64Url(publicKey);
  const keyX = toBase64Url(point.subarray(1, 33));
  const keyY = toBase64Url(point.subarray(33, 65));
  const key = createPublicKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      x: keyX,
      y: keyY,
    },
  });
  return verify(
    "sha256",
    Buffer.from(`${header}.${claims}`),
    { key, dsaEncoding: "ieee-p1363" },
    fromBase64Url(signature),
  );
}

/** The boot error for a key pair that cannot sign; the reason never carries key material. */
function pairError(reason: string): Error {
  return new Error(
    `SHELF_VAPID_PRIVATE_KEY and SHELF_VAPID_PUBLIC_KEY are not a usable pair: ${reason}`,
  );
}

/** The key object of `config`, after proving it signs tokens its public key verifies. */
function checkedKey(config: VapidConfig): KeyObject {
  if (!/^(?:mailto:|https:\/\/)\S+$/u.test(config.subject)) {
    throw new Error("SHELF_VAPID_SUBJECT must be a mailto: or https: URL");
  }
  let key: KeyObject;
  try {
    key = vapidPrivateKey(config);
  } catch {
    throw pairError("the keys are not base64url P-256 keys");
  }
  if (
    !verifyVapidJwt(signVapidJwt(key, config.subject, "https://push.invalid"), config.publicKey)
  ) {
    throw pairError("the private key does not belong to the public key");
  }
  return key;
}

/**
 * Build the server's VAPID identity, once, at boot.
 *
 * @throws {Error} when the subject is not a `mailto:` or `https:` URL, or the keys are garbage or
 *   do not form a pair (a mismatched pair signs fine and then every push service answers 403). The
 *   message never contains key material.
 */
export function createVapid(config: VapidConfig): Vapid {
  const key = checkedKey(config);
  const tokens = new Map<string, { jwt: string; signedAt: number }>();
  return {
    publicKey: config.publicKey,
    subject: config.subject,
    authorization(endpoint, nowMs = Date.now()): string {
      const audience = new URL(endpoint).origin;
      let entry = tokens.get(audience);
      if (entry === undefined || nowMs - entry.signedAt >= CACHE_MS || nowMs < entry.signedAt) {
        entry = { jwt: signVapidJwt(key, config.subject, audience, nowMs), signedAt: nowMs };
        if (tokens.size >= CACHE_LIMIT) {
          tokens.clear();
        }
        tokens.set(audience, entry);
      }
      return `vapid t=${entry.jwt}, k=${config.publicKey}`;
    },
  };
}
