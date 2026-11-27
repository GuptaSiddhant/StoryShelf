import { beforeEach, describe, expect, it, vi } from "vitest";
import { cliCreateAvailable, leadWithCreateProject } from "./cli-create.ts";

const store = vi.hoisted(() => ({ authEnabled: false, config: {} as { adminToken?: string } }));

vi.mock("../store.ts", () => ({ getStore: () => store }));

function setStore(authEnabled: boolean, adminToken?: string): void {
  store.authEnabled = authEnabled;
  store.config = adminToken === undefined ? {} : { adminToken };
}

describe("cliCreateAvailable", () => {
  beforeEach(() => setStore(false));

  it("is true while sign-in is off", () => {
    expect(cliCreateAvailable()).toBe(true);
  });

  it("is false with sign-in on and no admin token", () => {
    setStore(true);
    expect(cliCreateAvailable()).toBe(false);
  });

  it("is true with sign-in on and an admin token", () => {
    setStore(true, "secret");
    expect(cliCreateAvailable()).toBe(true);
  });
});

describe("leadWithCreateProject", () => {
  it("follows sign-in, not the admin token", () => {
    setStore(false);
    expect(leadWithCreateProject()).toBe(false);
    setStore(true, "secret");
    expect(leadWithCreateProject()).toBe(true);
  });
});
