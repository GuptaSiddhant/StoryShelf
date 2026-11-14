import { describe, expect, it } from "vitest";
import type { StoryEntry, Viewport } from "./adapter.ts";
import { MAX_SESSION_STORIES, planSwitchSessions, type SessionJob } from "./switch-sessions.ts";

const desktop: Viewport = { name: "desktop", width: 1280, height: 720 };
const mobile: Viewport = { name: "mobile", width: 375, height: 667 };
const dark: Viewport = {
  name: "desktop-dark",
  width: 1280,
  height: 720,
  globals: { theme: "dark" },
};

const story = (id: string, extra: Partial<StoryEntry> = {}): StoryEntry => ({
  id,
  title: "T",
  name: id,
  type: "story",
  ...extra,
});

const job = (entry: StoryEntry, viewport: Viewport = desktop): SessionJob => ({
  story: entry,
  viewport,
});

const everyPair = (jobs: SessionJob[]) => ({
  baselined: jobs.map((one) => ({ storyId: one.story.id, viewportName: one.viewport.name })),
});

const ids = (sessions: ReturnType<typeof planSwitchSessions>) =>
  sessions.map((session) => session.jobs.map((one) => `${one.story.id}@${one.viewport.name}`));

describe("planSwitchSessions", () => {
  it("puts every job in a session of its own without a request", () => {
    const jobs = [job(story("a")), job(story("b"))];
    expect(ids(planSwitchSessions(jobs, {}))).toEqual([["a@desktop"], ["b@desktop"]]);
  });

  it("chains baselined jobs that share a viewport and globals, in order", () => {
    const jobs = [job(story("a")), job(story("b")), job(story("c")), job(story("a"), mobile)];
    expect(ids(planSwitchSessions(jobs, { request: everyPair(jobs) }))).toEqual([
      ["a@desktop", "b@desktop", "c@desktop"],
      ["a@mobile"],
    ]);
  });

  it("keeps a mode (other globals) out of the plain viewport's session", () => {
    const jobs = [job(story("a")), job(story("a"), dark), job(story("b")), job(story("b"), dark)];
    expect(ids(planSwitchSessions(jobs, { request: everyPair(jobs) }))).toEqual([
      ["a@desktop", "b@desktop"],
      ["a@desktop-dark", "b@desktop-dark"],
    ]);
  });

  it("never switches to a job without a baseline: it starts a fresh session", () => {
    const jobs = [job(story("a")), job(story("new")), job(story("b"))];
    const request = everyPair([jobs[0] as SessionJob, jobs[2] as SessionJob]);
    expect(ids(planSwitchSessions(jobs, { request }))).toEqual([
      ["a@desktop"],
      ["new@desktop", "b@desktop"],
    ]);
  });

  it("isolates play functions, `isolate`, paused animations, tests and docs", () => {
    const jobs = [
      job(story("a")),
      job(story("play", { tags: ["play-fn"] })),
      job(story("iso", { parameters: { isolate: true } })),
      job(story("paused", { parameters: { pauseAnimationAtEnd: true } })),
      job(story("test", { parentId: "a" })),
      job(story("docs", { type: "docs" })),
      job(story("b")),
    ];
    expect(ids(planSwitchSessions(jobs, { request: everyPair(jobs) }))).toEqual([
      ["play@desktop"],
      ["iso@desktop"],
      ["paused@desktop"],
      ["test@desktop"],
      ["docs@desktop"],
      ["a@desktop", "b@desktop"],
    ]);
  });

  it("splits a group across lanes so every page has work", () => {
    const jobs = ["a", "b", "c", "d", "e"].map((id) => job(story(id)));
    expect(ids(planSwitchSessions(jobs, { request: everyPair(jobs), lanes: 2 }))).toEqual([
      ["a@desktop", "b@desktop", "c@desktop"],
      ["d@desktop", "e@desktop"],
    ]);
  });

  it("caps a session's length", () => {
    const jobs = Array.from({ length: MAX_SESSION_STORIES + 2 }, (_, at) => job(story(`s${at}`)));
    const sessions = planSwitchSessions(jobs, { request: everyPair(jobs) });
    expect(sessions.map((session) => session.jobs.length)).toEqual([MAX_SESSION_STORIES, 2]);
    expect(
      planSwitchSessions(jobs.slice(0, 3), { request: everyPair(jobs), maxStories: 2 }),
    ).toHaveLength(2);
  });

  it("does not switch when play functions run and no story declares one", () => {
    const jobs = [job(story("a")), job(story("b"))];
    expect(planSwitchSessions(jobs, { request: everyPair(jobs), executePlay: true })).toHaveLength(
      2,
    );
    const tagged = [...jobs, job(story("p", { tags: ["play-fn"] }))];
    expect(
      ids(planSwitchSessions(tagged, { request: everyPair(tagged), executePlay: true })),
    ).toEqual([["p@desktop"], ["a@desktop", "b@desktop"]]);
  });
});
