import { expect, it } from "vitest";
import { mailpitPreset } from "./mailpit.ts";

it("builds an SMTP sender for local Mailpit", async () => {
  expect((await mailpitPreset()).metadata.kind).toBe("email-smtp");
});
