import { describe, expect, it } from "vitest";
import type { Answers } from "./answers.ts";
import { generateServer } from "./codegen.ts";

function answers(overrides: Partial<Answers> = {}): Answers {
  return {
    name: "my-server",
    dir: "./my-server",
    database: "sqlite",
    storage: "local",
    auth: "none",
    git: "none",
    docker: false,
    ...overrides,
  };
}

function server(overrides: Partial<Answers> = {}): string {
  return generateServer(answers(overrides));
}

describe("generateServer", () => {
  it("keeps the default output lean: no notifications, no observability, no auth", () => {
    const code = server();
    expect(code).not.toContain("notify-");
    expect(code).not.toContain("observability");
    expect(code).not.toContain("createShelfLogger");
    expect(code).not.toContain("const logger");
    expect(code).not.toContain("@storyshelf/auth");
    expect(code).not.toContain("design-figma");
    expect(code).toContain("testing: { runner: captureRunner },");
  });

  it("always declares dataDir: it is the capture scratch directory", () => {
    const code = server({ database: "postgres", storage: "s3" });
    expect(code).toContain('const dataDir = process.env.DATA_DIR || "./data";');
    expect(code).toContain("scratchDir: dataDir,");
  });

  it("ends with the listener and the shutdown hooks", () => {
    const code = server();
    expect(code).toContain("await app.lifecycle.setup();");
    expect(code).toContain('for (const signal of ["SIGINT", "SIGTERM"] as const) {');
    expect(code.endsWith("}\n")).toBe(true);
  });

  it("merges imports that share a module into one line", () => {
    const code = server({ auth: "oauth", notifications: true });
    expect(code.match(/from "@storyshelf\/auth"/gu)).toHaveLength(1);
    expect(code.match(/from "@storyshelf\/app"/gu)).toHaveLength(1);
  });

  it("wires the git notifiers from @storyshelf/notify-git, never gitHosts", () => {
    const code = server({ git: "git" });
    expect(code).toContain('import { gitNotifiers } from "@storyshelf/notify-git";');
    expect(code).toContain("notifications: { notifiers: [...gitNotifiers] },");
    expect(code).not.toContain("gitHosts");
  });

  it("puts chat, email and git notifiers in one list", () => {
    expect(server({ git: "git", notifications: true })).toContain(
      "notifications: { notifiers: [...chatNotifiers, ...emailNotifiers, ...gitNotifiers] },",
    );
  });

  it("leaves git out when not chosen", () => {
    expect(server({ git: "none" })).not.toContain("notify-git");
  });

  it("wires notifications and the auth hook when enabled", () => {
    const code = server({ auth: "password", notifications: true });
    expect(code).toContain("chatNotifiers");
    expect(code).toContain("smtpPresetFromEnv");
    expect(code).toContain("onAuthSystemEvent: createAuthSystemHook()");
  });

  it("imports no auth hook for notifications without auth", () => {
    const code = server({ notifications: true });
    expect(code).toContain("smtpPresetFromEnv");
    expect(code).not.toContain("createAuthSystemHook");
  });

  it("omits notifications when disabled", () => {
    const code = server({ auth: "password", notifications: false });
    expect(code).not.toContain("chatNotifiers");
    expect(code).not.toContain("smtpPresetFromEnv");
  });

  it("wires OpenTelemetry only when observability is chosen", () => {
    const code = server({ observability: true });
    expect(code).toContain("initObservabilityFromEnv");
    expect(code).toContain("logger: shelfLogger,");
  });

  it("wires the Figma design provider when asked, and not by default", () => {
    const code = server({ design: true });
    expect(code).toContain(
      'import { createFigmaDesign, figmaOAuthFromEnv } from "@storyshelf/design-figma";',
    );
    expect(code).toContain("design: [createFigmaDesign({ oauth: figmaOAuthFromEnv() })],");
  });

  it("provisions the env-driven admin for password auth", () => {
    const code = server({ auth: "password" });
    expect(code).toContain(
      'import { createShelfAuth, ensurePasswordAdmin } from "@storyshelf/auth";',
    );
    expect(code).toContain("await ensurePasswordAdmin(database, {");
  });

  it("emits OIDC wiring for oauth on non-AWS targets", () => {
    const code = server({ auth: "oauth", deployTarget: "local" });
    expect(code).toContain("createShelfAuth");
    expect(code).toContain("keycloakPreset");
    expect(code).toContain("OIDC_ISSUER");
    expect(code).not.toContain("cognitoPreset");
  });

  it("emits the Cognito preset for oauth on AWS", () => {
    const code = server({ auth: "oauth", deployTarget: "aws" });
    expect(code).toContain("cognitoPreset");
    expect(code).toContain("COGNITO_USER_POOL_ID");
    expect(code).not.toContain("keycloakPreset");
  });

  it("puts the D1 binding stub before the database", () => {
    const code = server({ database: "d1" });
    expect(code.indexOf("function getD1Binding()")).toBeGreaterThan(-1);
    expect(code.indexOf("function getD1Binding()")).toBeLessThan(code.indexOf("const database ="));
  });
});
