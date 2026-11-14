import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { fromBase64Url, toBase64Url } from "./base64url.ts";
import type { VapidConfig } from "./types.ts";

/** A VAPID token lives at most 24 hours (RFC 8292, section 2). */
const TOKEN_SECONDS = 12 * 60 * 60;

/** Private key object from a raw scalar and its uncompressed public key. */
export function vapidPrivateKey(config: Pick<VapidConfig, "publicKey" | "privateKey">): KeyObject {
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
export function signVapidJwt(config: VapidConfig, audience: string, nowMs = Date.now()): string {
  const header = toBase64Url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = toBase64Url(
    Buffer.from(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(nowMs / 1000) + TOKEN_SECONDS,
        sub: config.subject,
      }),
    ),
  );
  const input = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(input), {
    key: vapidPrivateKey(config),
    dsaEncoding: "ieee-p1363",
  });
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

/** The `Authorization` header value of RFC 8292, section 3. */
export function vapidAuthorization(config: VapidConfig, endpoint: string): string {
  const jwt = signVapidJwt(config, new URL(endpoint).origin);
  return `vapid t=${jwt}, k=${config.publicKey}`;
}
