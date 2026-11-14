import { X509Certificate } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RDS_CA_BUNDLE, RDS_GOV_CA_BUNDLE, caBundleFor } from "./rds-ca-bundle.ts";

const CERTIFICATE = /-----BEGIN CERTIFICATE-----\n[A-Za-z0-9+/=\n]+?-----END CERTIFICATE-----\n/gu;

describe.each([
  ["RDS_CA_BUNDLE", RDS_CA_BUNDLE, 10],
  ["RDS_GOV_CA_BUNDLE", RDS_GOV_CA_BUNDLE, 3],
])("%s", (_name, bundle, minimum) => {
  const certificates = bundle.match(CERTIFICATE) ?? [];

  it("is nothing but well-formed certificates", () => {
    expect(certificates.length).toBeGreaterThan(minimum - 1);
    expect(certificates.join("")).toBe(bundle);
  });

  it("holds Amazon RDS certificate authorities only, none a private key", () => {
    expect(bundle).not.toContain("PRIVATE KEY");
    for (const pem of certificates) {
      const certificate = new X509Certificate(pem);
      expect(certificate.ca).toBe(true);
      expect(certificate.subject).toContain("Amazon RDS");
    }
  });
});

/** Subject names of every certificate in a PEM bundle. */
const names = (bundle: string): string[] =>
  (bundle.match(CERTIFICATE) ?? []).map((pem) => new X509Certificate(pem).subject);

describe("caBundleFor", () => {
  it("picks GovCloud's roots for us-gov regions and the commercial roots elsewhere", () => {
    expect(caBundleFor("us-gov-west-1")).toBe(RDS_GOV_CA_BUNDLE);
    expect(caBundleFor("us-gov-east-1")).toBe(RDS_GOV_CA_BUNDLE);
    expect(caBundleFor("eu-west-1")).toBe(RDS_CA_BUNDLE);
    expect(caBundleFor("us-east-1")).toBe(RDS_CA_BUNDLE);
  });

  it("names a us-gov root in the GovCloud bundle and none in the commercial one", () => {
    expect(names(RDS_GOV_CA_BUNDLE).every((name) => name.includes("us-gov-"))).toBe(true);
    expect(names(RDS_CA_BUNDLE).some((name) => name.includes("us-gov-"))).toBe(false);
  });
});
