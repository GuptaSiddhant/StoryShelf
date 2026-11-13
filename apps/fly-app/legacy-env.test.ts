import { describe, expect, it } from "vitest";
import { refuseLegacyVariables } from "./legacy-env.ts";

describe("refuseLegacyVariables", () => {
  it("accepts an environment with no SS_* variable", () => {
    expect(() => refuseLegacyVariables({ SHELF_BRAND_NAME: "Acme", PATH: "/bin" })).not.toThrow();
  });

  it("names each old variable with its new name, and never the value", () => {
    const env = { SS_AI_MODEL: "secret-model-value", SS_BRAND_NAME: "Acme Brand" };
    let message = "";
    try {
      refuseLegacyVariables(env);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("SS_AI_MODEL -> SHELF_AI_MODEL");
    expect(message).toContain("SS_BRAND_NAME -> SHELF_BRAND_NAME");
    expect(message).not.toContain("secret-model-value");
    expect(message).not.toContain("Acme Brand");
  });

  it("refuses an empty SS_* variable, since it is still set", () => {
    expect(() => refuseLegacyVariables({ SS_AI_DAILY_TOKENS: "" })).toThrow(
      "SS_AI_DAILY_TOKENS -> SHELF_AI_DAILY_TOKENS",
    );
  });

  it("refuses any SS_* name, not only the known ones", () => {
    expect(() => refuseLegacyVariables({ SS_SOMETHING_NEW: "1" })).toThrow(
      "SS_SOMETHING_NEW -> SHELF_SOMETHING_NEW",
    );
  });
});
