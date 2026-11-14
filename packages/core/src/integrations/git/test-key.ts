/** Test helper: a throwaway RSA key pair standing in for a GitHub App's private key. */
import { generateKeyPairSync } from "node:crypto";

const pair = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

/** PEM private key. */
export const TEST_PRIVATE_KEY = pair.privateKey;
/** PEM public key that verifies a JWT signed with {@link TEST_PRIVATE_KEY}. */
export const TEST_PUBLIC_KEY = pair.publicKey;
