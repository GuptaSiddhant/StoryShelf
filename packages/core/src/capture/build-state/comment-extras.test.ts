import { describe, expect, it } from "vitest";
import { BuildReviewModel } from "../../models/build-review.ts";
import { CaptureAttemptModel } from "../../models/capture-attempt.ts";
import { SnapshotModel } from "../../models/snapshot.ts";
import { UserModel } from "../../models/user.ts";
import { a11yCountOf, failedTestsOf, failureReasonOf, publicNameOf } from "./comment-extras.ts";
import { deliverBuildState } from "./deliver.ts";
import { world } from "./test-world.ts";

type World = Awaited<ReturnType<typeof world>>;

/** The comment text the channel last received. */
async function commentOf(w: World): Promise<string> {
  await deliverBuildState(w.deps, { buildId: w.build.id, channelId: w.channelId });
  const comments = w.git.calls.flatMap((entry) =>
    entry.target.kind === "comment" ? [entry.target.markdown] : [],
  );
  return comments.at(-1) ?? "";
}

describe("failureReasonOf", () => {
  it("maps an error class to a fixed phrase", () => {
    expect(failureReasonOf("TargetLaunchError: chromium refused")).toBe(
      "a browser failed to start",
    );
    expect(failureReasonOf("JobAbortedError: deadline\n    at x")).toBe("timed out");
    expect(failureReasonOf("ZipLimitError: too big")).toBe("the Storybook could not be published");
  });

  it("gives no reason for any other error, and cannot be forged by a message", () => {
    expect(failureReasonOf("Error: TargetLaunchError: x")).toBeUndefined();
    expect(failureReasonOf("Error: boom")).toBeUndefined();
    expect(failureReasonOf(null)).toBeUndefined();
  });
});

describe("a11yCountOf and failedTestsOf", () => {
  it("counts findings, the overflow line as its N, and never a note", () => {
    const list = JSON.stringify(["a", "b", "…and 3 more", "axe unavailable: no axe"]);
    expect(a11yCountOf([{ a11yViolations: list }, { a11yViolations: null }])).toBe(5);
  });

  it("names the failing tests only", () => {
    const testResults = JSON.stringify([
      {
        id: "a:x",
        title: "Button",
        name: "clicks",
        parentId: null,
        status: "failed",
        durationMs: 1,
      },
      {
        id: "a:y",
        title: "Button",
        name: "renders",
        parentId: null,
        status: "passed",
        durationMs: 1,
      },
    ]);
    expect(failedTestsOf({ testResults })).toEqual(["Button / clicks"]);
  });
});

describe("publicNameOf", () => {
  const user = { email: "Ada@Corp.example", name: "Ada L", displayNameOverride: null };

  it("prefers the display name, then the profile name", () => {
    expect(publicNameOf({ ...user, displayNameOverride: "Ada Lovelace" })).toBe("Ada Lovelace");
    expect(publicNameOf(user)).toBe("Ada L");
  });

  it("never returns an address: a name equal to the email, or with an @, is left out", () => {
    expect(publicNameOf({ ...user, name: "ada@corp.example" })).toBeUndefined();
    expect(publicNameOf({ ...user, name: "someone@else.example" })).toBeUndefined();
    expect(publicNameOf({ ...user, name: "ada@corp.example", displayNameOverride: "Ada" })).toBe(
      "Ada",
    );
  });
});

describe("the comment's extra facts", () => {
  it("names the approver by display name, never by email", async () => {
    const w = await world();
    await new UserModel(w.db).upsert({
      id: "u1",
      email: "ada@corp.example",
      name: "Ada L",
      role: "member",
    });
    await new BuildReviewModel(w.db).add(w.build.id, "u1", "approved");
    await w.builds.setStatus(w.build.id, "approved");
    const body = await commentOf(w);
    expect(body).toContain("Approved by `@Ada L`");
    expect(body).not.toContain("corp.example");
  });

  it("posts no name for a user whose name is their email address", async () => {
    const w = await world();
    await new UserModel(w.db).upsert({
      id: "u2",
      email: "bob@corp.example",
      name: "bob@corp.example",
      role: "member",
    });
    await new BuildReviewModel(w.db).add(w.build.id, "u2", "approved");
    await w.builds.setStatus(w.build.id, "approved");
    const body = await commentOf(w);
    expect(body).toContain("Approved");
    expect(body).not.toContain("corp.example");
    expect(body).not.toContain("bob");
  });

  it("gives a failed capture a class phrase and never the error text", async () => {
    const w = await world();
    const attempts = new CaptureAttemptModel(w.db);
    const attempt = await attempts.startAttempt(w.project.id, w.build.id);
    await attempts.markFinished(
      attempt.id,
      "failed",
      "TargetLaunchError: ws://10.0.0.7:9222/devtools secret-host.internal /srv/app/key.pem",
    );
    await w.builds.setStatus(w.build.id, "failed");
    const body = await commentOf(w);
    expect(body).toContain("Capture failed (a browser failed to start)");
    for (const leak of ["10.0.0.7", "secret-host", "key.pem", "devtools"]) {
      expect(body).not.toContain(leak);
    }
  });

  it("shows no reason for an unknown error class", async () => {
    const w = await world();
    const attempts = new CaptureAttemptModel(w.db);
    const attempt = await attempts.startAttempt(w.project.id, w.build.id);
    await attempts.markFinished(attempt.id, "failed", "Error: connect ECONNREFUSED 10.1.2.3:5432");
    await w.builds.setStatus(w.build.id, "failed");
    const body = await commentOf(w);
    expect(body).toContain("Capture failed");
    expect(body).not.toContain("10.1.2.3");
  });

  it("lists failing tests and counts a11y findings without moving the headline", async () => {
    const w = await world();
    await w.builds.setTestResults(w.build.id, [
      {
        id: "a:x",
        title: "Form",
        name: "submits",
        parentId: null,
        status: "failed",
        durationMs: 1,
      },
    ]);
    await new SnapshotModel(w.db).create(w.project.id, w.build.id, {
      storyId: "form--basic",
      storyName: "Basic",
      storyTitle: "Form",
      storyImportPath: "./form.stories.tsx",
      viewportName: "desktop",
      viewportWidth: 1280,
      viewportHeight: 720,
      screenshotPath: "s.png",
      status: "unchanged",
      a11yViolations: JSON.stringify(["color-contrast (serious): x", "label (critical): y"]),
    });
    await w.builds.updateCounts(w.build.id);
    await w.builds.setStatus(w.build.id, "reviewing");
    const body = await commentOf(w);
    expect(body).toContain("Form / submits");
    expect(body).toContain("2 a11y findings");
    expect(body).not.toContain("a11y findings need");
  });
});
