import { describe, expect, it, vi } from "vitest";
import type { StateNotifierProvider } from "../adapters/notifier/provider.ts";
import { gitLogNotifier } from "../integrations/git/log.ts";
import { BuildModel } from "../models/build.ts";
import { NotificationChannelModel } from "../models/notification-channel.ts";
import { ProjectModel } from "../models/project.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { defaultBranchStanding, settleBranchStanding } from "./branch-standing.ts";

const SECRET = "s3cret-s3cret-s3cret";

/** A `state` provider whose host answers `commitOnBranch` with `answer`. */
function hostSaying(
  kind: string,
  answer: () => Promise<boolean>,
): { provider: StateNotifierProvider; asked: ReturnType<typeof vi.fn> } {
  const asked = vi.fn(answer);
  const provider: StateNotifierProvider = {
    metadata: { ...gitLogNotifier.metadata, kind },
    create: () => ({
      metadata: { ...gitLogNotifier.metadata, kind },
      setState: async () => {
        await Promise.resolve();
      },
      commitOnBranch: asked,
    }),
  };
  return { provider, asked };
}

const yes = async (): Promise<boolean> => await Promise.resolve(true);
const no = async (): Promise<boolean> => await Promise.resolve(false);
const down = async (): Promise<boolean> => {
  await Promise.resolve();
  throw new Error("HTTP 502");
};

async function world(options: {
  branch?: string;
  sha?: string;
  require?: boolean;
  channels?: { provider: string; enabled?: boolean }[];
}) {
  const { db } = makeDatabase();
  const project = await new ProjectModel(db).create({
    name: "Claims",
    gitDefaultBranch: "main",
    ...(options.require === undefined ? {} : { requireVerifiedDefault: options.require }),
  });
  const channels = new NotificationChannelModel(db, undefined, SECRET);
  for (const channel of options.channels ?? []) {
    // oxlint-disable-next-line no-await-in-loop -- a few rows, in order
    await channels.create({
      projectId: project.id,
      provider: channel.provider,
      config: {},
      secret: "token",
      enabled: channel.enabled ?? true,
    });
  }
  const build = await new BuildModel(db).create(project.id, {
    gitSha: options.sha ?? "abc123",
    gitBranch: options.branch ?? "main",
    isDefault: (options.branch ?? "main") === "main",
  });
  return { db, project, build };
}

describe("defaultBranchStanding", () => {
  it("asks no host for a build that does not name the default branch", async () => {
    const host = hostSaying("github", yes);
    const { db, project, build } = await world({
      branch: "feature/x",
      channels: [{ provider: "github" }],
    });
    const standing = await defaultBranchStanding(
      { db, notifiers: [host.provider], secret: SECRET },
      { build, project },
    );
    expect(standing).toEqual({ isDefault: false, verification: null });
    expect(host.asked).not.toHaveBeenCalled();
  });

  it("counts a claim the git host confirms, asking about the commit and the default branch", async () => {
    const host = hostSaying("github", yes);
    const { db, project, build } = await world({ channels: [{ provider: "github" }] });
    const standing = await defaultBranchStanding(
      { db, notifiers: [host.provider], secret: SECRET },
      { build, project },
    );
    expect(standing).toEqual({ isDefault: true, verification: "verified" });
    expect(host.asked).toHaveBeenCalledWith({ sha: "abc123", branch: "main" });
  });

  it("refuses a claim the git host says is not on the branch", async () => {
    const host = hostSaying("github", no);
    const { db, project, build } = await world({ channels: [{ provider: "github" }] });
    expect(
      await defaultBranchStanding(
        { db, notifiers: [host.provider], secret: SECRET },
        { build, project },
      ),
    ).toEqual({ isDefault: false, verification: "refused" });
  });

  it("fails closed when the git host cannot answer, and logs why without the token", async () => {
    const host = hostSaying("github", down);
    const warn = vi.fn();
    const logger = { warn, info: vi.fn() } as unknown as import("../logger.ts").Logger;
    const { db, project, build } = await world({ channels: [{ provider: "github" }] });
    expect(
      await defaultBranchStanding(
        { db, notifiers: [host.provider], secret: SECRET, logger },
        { build, project },
      ),
    ).toEqual({ isDefault: false, verification: "unreachable" });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ buildId: build.id }),
      "git host could not confirm the default-branch claim",
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("token");
  });

  it("verifies when one channel confirms even though another host is down", async () => {
    const github = hostSaying("github", yes);
    const gitlab = hostSaying("gitlab", down);
    const { db, project, build } = await world({
      channels: [{ provider: "gitlab" }, { provider: "github" }],
    });
    expect(
      await defaultBranchStanding(
        { db, notifiers: [github.provider, gitlab.provider], secret: SECRET },
        { build, project },
      ),
    ).toEqual({ isDefault: true, verification: "verified" });
  });

  it("refuses when one host says no and the other is down", async () => {
    const github = hostSaying("github", no);
    const gitlab = hostSaying("gitlab", down);
    const { db, project, build } = await world({
      channels: [{ provider: "gitlab" }, { provider: "github" }],
    });
    expect(
      await defaultBranchStanding(
        { db, notifiers: [github.provider, gitlab.provider], secret: SECRET },
        { build, project },
      ),
    ).toEqual({ isDefault: false, verification: "refused" });
  });

  it("leaves the claim unverified, and not default, with no git channel by default", async () => {
    const { db, project, build } = await world({});
    expect(
      await defaultBranchStanding({ db, notifiers: [], secret: SECRET }, { build, project }),
    ).toEqual({ isDefault: false, verification: "unverified" });
  });

  it("counts an unverified claim when the project turned verification off", async () => {
    const { db, project, build } = await world({ require: false });
    expect(await defaultBranchStanding({ db }, { build, project })).toEqual({
      isDefault: true,
      verification: "unverified",
    });
  });

  it("does not ask a disabled channel, nor a provider that cannot check", async () => {
    const host = hostSaying("github", yes);
    const { db, project, build } = await world({
      channels: [{ provider: "github", enabled: false }, { provider: "git-log" }],
    });
    expect(
      await defaultBranchStanding(
        { db, notifiers: [host.provider, gitLogNotifier], secret: SECRET },
        { build, project },
      ),
    ).toEqual({ isDefault: false, verification: "unverified" });
    expect(host.asked).not.toHaveBeenCalled();
  });

  it("asks no host about a local commit identity or a missing commit", async () => {
    const host = hostSaying("github", yes);
    for (const sha of ["", "local-abcdef"]) {
      // oxlint-disable-next-line no-await-in-loop -- two cases, in order
      const { db, project, build } = await world({ sha, channels: [{ provider: "github" }] });
      // oxlint-disable-next-line no-await-in-loop -- two cases, in order
      const standing = await defaultBranchStanding(
        { db, notifiers: [host.provider], secret: SECRET },
        { build, project },
      );
      expect(standing.verification).toBe("unverified");
    }
    expect(host.asked).not.toHaveBeenCalled();
  });

  it("cannot read channel secrets without the server secret, so the claim is unverified", async () => {
    const host = hostSaying("github", yes);
    const { db, project, build } = await world({ channels: [{ provider: "github" }] });
    expect(
      await defaultBranchStanding({ db, notifiers: [host.provider] }, { build, project }),
    ).toEqual({ isDefault: false, verification: "unverified" });
  });
});

describe("settleBranchStanding", () => {
  it("writes the standing to the build, replacing the uploader's claim", async () => {
    const host = hostSaying("github", no);
    const { db, project, build } = await world({ channels: [{ provider: "github" }] });
    const builds = new BuildModel(db);
    const settled = await settleBranchStanding(
      { db, notifiers: [host.provider], secret: SECRET, builds },
      { build, project },
    );
    expect(settled).toMatchObject({ isDefault: false, branchVerified: "refused" });
    expect(await builds.get(build.id)).toMatchObject({
      isDefault: false,
      branchVerified: "refused",
    });
  });

  it("leaves a feature-branch build untouched", async () => {
    const { db, project, build } = await world({ branch: "feature/x" });
    const builds = { setBranchStanding: vi.fn() };
    expect(await settleBranchStanding({ db, builds }, { build, project })).toBe(build);
    expect(builds.setBranchStanding).not.toHaveBeenCalled();
  });

  it("clears a stale standing when the project's default branch changed", async () => {
    const { db, project, build } = await world({ require: false });
    const builds = new BuildModel(db);
    await builds.setBranchStanding(build.id, { isDefault: true, verification: "unverified" });
    const renamed = { ...project, gitDefaultBranch: "trunk" };
    const stale = (await builds.get(build.id)) ?? build;
    expect(
      await settleBranchStanding({ db, builds }, { build: stale, project: renamed }),
    ).toMatchObject({ isDefault: false, branchVerified: null });
  });
});
