import { describe, expect, it } from "vite-plus/test";
import * as engine from "../engine.ts";
import * as pkg from "../index.ts";
import { ENGINE_PROVIDER_ID } from "./types.ts";

describe("engine types", () => {
  it("mints the better-auth provider id", () => {
    expect(ENGINE_PROVIDER_ID).toBe("better-auth");
  });

  it("keeps the public surface: engine.ts and the package index export the id and the factory", () => {
    expect(engine.ENGINE_PROVIDER_ID).toBe(ENGINE_PROVIDER_ID);
    expect(pkg.ENGINE_PROVIDER_ID).toBe(ENGINE_PROVIDER_ID);
    expect(pkg.createShelfAuth).toBe(engine.createShelfAuth);
    // Only the id and the factory are values; everything else in engine.ts is a type.
    expect(Object.keys(engine).toSorted()).toEqual(["ENGINE_PROVIDER_ID", "createShelfAuth"]);
  });
});
