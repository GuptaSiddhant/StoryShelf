import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { SummaryList } from "./summary-list.tsx";

async function render(node: unknown): Promise<string> {
  const app = new Hono();
  app.get("/", (c) => c.html(node as never));
  return await (await app.request("/")).text();
}

describe("SummaryList", () => {
  it("renders a row per item with state, details and actions", async () => {
    const html = await render(
      <SummaryList
        label="Things"
        emptyTitle="None"
        items={[
          {
            id: "1",
            name: "One",
            state: { label: "On", tone: "success" },
            details: "d",
            actions: <a href="#e">Edit</a>,
          },
        ]}
      />,
    );
    expect(html).toContain('aria-label="Things"');
    expect(html).toContain("One");
    expect(html).toContain("On");
    expect(html).toContain(">Edit<");
  });

  it("renders the empty state with the add action", async () => {
    const html = await render(
      <SummaryList label="Things" items={[]} emptyTitle="None yet" add={<a href="#a">Add</a>} />,
    );
    expect(html).toContain("None yet");
    expect(html).toContain(">Add<");
    expect(html).not.toContain("<ul");
  });
});
