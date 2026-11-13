import { describe, expect, it } from "vitest";
import { createRdsIamDatabase } from "./rds-iam.ts";

// Live AWS: set the RDS_IAM_* variables on an instance with IAM auth enabled and a database user
// granted `rds_iam`. Needs the AWS credential chain and the `@aws-sdk/rds-signer` peer.
const host = process.env["RDS_IAM_HOST"];
const live = process.env["LIVE_CLOUD"] === "1" && host !== undefined;

describe.skipIf(!live)("createRdsIamDatabase (live)", () => {
  it("connects with an IAM token and answers health", async () => {
    const db = createRdsIamDatabase({
      host: host ?? "",
      database: process.env["RDS_IAM_DATABASE"] ?? "postgres",
      user: process.env["RDS_IAM_USER"] ?? "",
      region: process.env["RDS_IAM_REGION"] ?? process.env["AWS_REGION"] ?? "",
      ca: process.env["RDS_IAM_CA"],
    });
    try {
      expect(await db.lifecycle?.health()).toEqual({ ok: true });
    } finally {
      await db.lifecycle?.teardown();
    }
  });
});
