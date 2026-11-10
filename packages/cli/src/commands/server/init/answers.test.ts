import { describe, expect, it } from "vite-plus/test";
import {
  needsCompose,
  resolveDeployTarget,
  wantsDesign,
  wantsGit,
  wantsNotifications,
  wantsObservability,
  type Answers,
} from "./answers.ts";

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

describe("resolveDeployTarget", () => {
  it("keeps an explicit target", () => {
    expect(resolveDeployTarget(answers({ deployTarget: "aws", docker: false }))).toBe("aws");
    expect(resolveDeployTarget(answers({ deployTarget: "local", docker: true }))).toBe("local");
  });

  it("derives the target from the docker flag for answers that predate targets", () => {
    expect(resolveDeployTarget(answers({ docker: true }))).toBe("docker");
    expect(resolveDeployTarget(answers({ docker: false }))).toBe("local");
  });
});

describe("opt-in predicates", () => {
  it("are off when the answer is absent", () => {
    const bare = answers();
    expect(wantsNotifications(bare)).toBe(false);
    expect(wantsDesign(bare)).toBe(false);
    expect(wantsObservability(bare)).toBe(false);
    expect(wantsGit(bare)).toBe(false);
  });

  it("follow the answer", () => {
    const all = answers({ notifications: true, design: true, observability: true, git: "git" });
    expect(wantsNotifications(all)).toBe(true);
    expect(wantsDesign(all)).toBe(true);
    expect(wantsObservability(all)).toBe(true);
    expect(wantsGit(all)).toBe(true);
    expect(wantsNotifications(answers({ notifications: false }))).toBe(false);
  });
});

describe("needsCompose", () => {
  it("is true only for postgres, the one choice with a second service", () => {
    expect(needsCompose(answers({ database: "postgres" }))).toBe(true);
    for (const database of ["sqlite", "pg", "mysql", "pglite"] as const) {
      expect(needsCompose(answers({ database }))).toBe(false);
    }
  });
});
