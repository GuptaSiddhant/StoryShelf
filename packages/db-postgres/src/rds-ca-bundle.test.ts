import { X509Certificate } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RDS_CA_BUNDLE } from "./rds-ca-bundle.ts";

const CERTIFICATE = /-----BEGIN CERTIFICATE-----\n[A-Za-z0-9+/=\n]+?-----END CERTIFICATE-----\n/gu;

describe("RDS_CA_BUNDLE", () => {
  const certificates = RDS_CA_BUNDLE.match(CERTIFICATE) ?? [];

  it("is nothing but well-formed certificates", () => {
    expect(certificates.length).toBeGreaterThan(10);
    expect(certificates.join("")).toBe(RDS_CA_BUNDLE);
  });

  it("holds Amazon RDS certificate authorities only, none a private key", () => {
    expect(RDS_CA_BUNDLE).not.toContain("PRIVATE KEY");
    for (const pem of certificates) {
      const certificate = new X509Certificate(pem);
      expect(certificate.ca).toBe(true);
      expect(certificate.subject).toContain("Amazon RDS");
    }
  });
});
