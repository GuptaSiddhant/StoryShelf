import { UserModel } from "@storyshelf/core/models";
import { makeDatabase } from "@storyshelf/core/test-helpers";
import { describe, expect, it, vi } from "vitest";
import type { LifecycleCell } from "./lifecycle.ts";
import {
  warnMissingReadOnlyAccounts,
  warnMissingReadOnlyAccountsAfterSetup,
} from "./read-only-accounts.ts";

function recorder() {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never as {
    warn: ReturnType<typeof vi.fn>;
  };
}

const accounts = (...emails: string[]) => ({ readOnlyAccounts: () => emails });

describe("warnMissingReadOnlyAccounts", () => {
  it("warns once per account with no user, by position and never by address", async () => {
    const { db } = makeDatabase();
    await new UserModel(db).upsert({
      id: "u_demo",
      email: "demo@example.test",
      name: "Demo",
      role: "member",
    });
    const logger = recorder();
    const missing = await warnMissingReadOnlyAccounts(
      accounts("demo@example.test", "typo@example.test"),
      db,
      logger as never,
    );
    expect(missing).toBe(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toEqual({ position: 2, configured: 2 });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("typo@");
  });

  it("does nothing without read-only accounts", async () => {
    const { db } = makeDatabase();
    const logger = recorder();
    expect(await warnMissingReadOnlyAccounts(undefined, db, logger as never)).toBe(0);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

/** A lifecycle cell whose adapters are ready (`ok`) or failed. */
function cell(ok: boolean): LifecycleCell {
  return { ready: Promise.resolve({ ok, failures: [] }), settled: null };
}

describe("warnMissingReadOnlyAccountsAfterSetup", () => {
  it("checks once the adapters are ready", async () => {
    const { db } = makeDatabase();
    const logger = recorder();
    const ready = cell(true);
    warnMissingReadOnlyAccountsAfterSetup(
      ready,
      accounts("nobody@example.test"),
      db,
      logger as never,
    );
    await Promise.all(ready.background ?? []);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("skips a failed setup and an instance without accounts", async () => {
    const { db } = makeDatabase();
    const logger = recorder();
    const failed = cell(false);
    warnMissingReadOnlyAccountsAfterSetup(
      failed,
      accounts("nobody@example.test"),
      db,
      logger as never,
    );
    const none = cell(true);
    warnMissingReadOnlyAccountsAfterSetup(none, accounts(), db, logger as never);
    await Promise.all([...(failed.background ?? []), ...(none.background ?? [])]);
    expect(none.background).toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
