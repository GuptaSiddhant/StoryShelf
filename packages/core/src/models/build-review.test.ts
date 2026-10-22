import { describe, expect, it } from "vitest";
import { createTestBuild, createTestProject } from "../test-helpers/create-project.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { BuildReviewModel } from "./build-review.ts";

async function setup() {
  const { db } = makeDatabase();
  const project = await createTestProject(db, db.tables);
  const first = await createTestBuild(db, db.tables, project.id, { gitSha: "a" });
  const second = await createTestBuild(db, db.tables, project.id, { gitSha: "b" });
  return { model: new BuildReviewModel(db), first, second };
}

describe("BuildReviewModel", () => {
  it("records a verdict with an optional body", async () => {
    const { model, first } = await setup();
    const withBody = await model.add(first.id, "u1", "approved", "Looks good");
    const bare = await model.add(first.id, "u2", "rejected", "");
    expect(withBody).toMatchObject({ buildId: first.id, userId: "u1", body: "Looks good" });
    expect(bare.body).toBeNull();
  });

  it("lists a build's verdicts oldest first, never mixing builds", async () => {
    const { model, first, second } = await setup();
    await model.add(first.id, "u1", "rejected");
    await model.add(first.id, "u1", "approved");
    await model.add(second.id, "u1", "rejected");
    expect((await model.listByBuild(first.id)).map((row) => row.verdict)).toEqual([
      "rejected",
      "approved",
    ]);
    expect(await model.listByBuild(second.id)).toHaveLength(1);
  });

  it("keeps createdAt strictly increasing, so a rewrite in the same millisecond wins", async () => {
    const { model, first } = await setup();
    for (let round = 0; round < 5; round += 1) {
      // eslint-disable-next-line no-await-in-loop -- each rewrite must follow the previous one
      await model.add(first.id, "u1", round % 2 === 0 ? "rejected" : "approved");
    }
    const stamps = (await model.listByBuild(first.id)).map((row) => row.createdAt);
    expect(stamps.every((stamp, index) => index === 0 || stamp > (stamps[index - 1] ?? ""))).toBe(
      true,
    );
    expect((await model.latestByBuild(first.id)).map((row) => row.verdict)).toEqual(["rejected"]);
  });

  it("returns each reviewer's latest verdict, anonymous writers counting as one", async () => {
    const { model, first } = await setup();
    await model.add(first.id, "u1", "rejected");
    await model.add(first.id, "u2", "approved");
    await model.add(first.id, "u1", "approved");
    await model.add(first.id, null, "rejected");
    await model.add(first.id, null, "approved");
    const latest = await model.latestByBuild(first.id);
    expect(latest).toHaveLength(3);
    expect(latest.every((row) => row.verdict === "approved")).toBe(true);
  });
});
