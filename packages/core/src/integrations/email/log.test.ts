import { describe, expect, it, vi } from "vitest";
import { logPreset } from "./log.ts";

describe("logPreset", () => {
  it("records sends on the logger without delivering", async () => {
    const info = vi.fn();
    const sender = logPreset({ logger: { info, child: () => ({ info }) } as never });
    await sender.send({ to: "a@example.com", subject: "s", text: "t" });
    expect(info).toHaveBeenCalledOnce();
  });
});
