import { expect, it, vi } from "vitest";

it("importing the integrations index does not load nodemailer", async () => {
  vi.resetModules();
  vi.doMock("nodemailer", () => {
    throw new Error("nodemailer must not be loaded on import");
  });
  const integrations = await import("../index.ts");
  const email = await import("./index.ts");
  expect(integrations.BUILT_IN_INTEGRATIONS.notifiers.length).toBeGreaterThan(0);
  expect(typeof email.smtpPreset).toBe("function");
  vi.doUnmock("nodemailer");
});
