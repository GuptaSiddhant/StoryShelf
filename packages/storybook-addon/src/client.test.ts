import { describe, expect, it } from "vitest";
import { fetchStoryStatus, type Fetcher } from "./client.ts";

const location = { slug: "gate", buildId: "b1" };
const body = {
  build: { status: "reviewing", reviewPath: "/projects/gate/builds/b1/diff" },
  stories: { "a--one": { status: "changed" } },
};

function fake(routes: Record<string, Response | Error>): { fetcher: Fetcher; calls: string[] } {
  const calls: string[] = [];
  const fetcher: Fetcher = async (input, init) => {
    calls.push(`${input} ${init.credentials}`);
    const route = routes[input];
    if (route instanceof Error) throw route;
    return await Promise.resolve(route ?? new Response("nope", { status: 404 }));
  };
  return { fetcher, calls };
}

const STATUS = "/api/v1/projects/gate/builds/b1/story-status";

describe("fetchStoryStatus", () => {
  it("reads health, then the status, with the session cookie and nothing else", async () => {
    const { fetcher, calls } = fake({
      "/api/v1/health": Response.json({ testing: true }),
      [STATUS]: Response.json(body),
    });
    expect(await fetchStoryStatus(fetcher, location)).toEqual(body);
    expect(calls).toEqual(["/api/v1/health same-origin", `${STATUS} same-origin`]);
  });

  it("stays inert when testing is off, without asking for the status", async () => {
    const { fetcher, calls } = fake({ "/api/v1/health": Response.json({ testing: false }) });
    expect(await fetchStoryStatus(fetcher, location)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("stays inert when health does not answer", async () => {
    const { fetcher } = fake({ "/api/v1/health": new Response("", { status: 500 }) });
    expect(await fetchStoryStatus(fetcher, location)).toBeNull();
  });

  it("shows nothing for a viewer the server answers 404", async () => {
    const { fetcher } = fake({
      "/api/v1/health": Response.json({ testing: true }),
      [STATUS]: new Response("{}", { status: 404 }),
    });
    expect(await fetchStoryStatus(fetcher, location)).toBeNull();
  });

  it("shows nothing for a malformed answer", async () => {
    const { fetcher } = fake({
      "/api/v1/health": Response.json({ testing: true }),
      [STATUS]: Response.json({ stories: 1 }),
    });
    expect(await fetchStoryStatus(fetcher, location)).toBeNull();
  });

  it("shows nothing when a request fails", async () => {
    const { fetcher } = fake({ "/api/v1/health": new Error("offline") });
    expect(await fetchStoryStatus(fetcher, location)).toBeNull();
  });

  it("treats a health body that is not an object as testing off", async () => {
    const { fetcher } = fake({ "/api/v1/health": Response.json("yes") });
    expect(await fetchStoryStatus(fetcher, location)).toBeNull();
  });
});
