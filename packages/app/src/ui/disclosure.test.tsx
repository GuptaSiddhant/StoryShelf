import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { DefinitionList, Disclosure } from "./disclosure.tsx";

async function render(node: unknown): Promise<string> {
  const app = new Hono();
  app.get("/", (c) => c.html(node as never));
  return await (await app.request("/")).text();
}

describe("Disclosure", () => {
  it("is collapsed unless open is set", async () => {
    const closed = await render(<Disclosure title="Details">body</Disclosure>);
    expect(closed).not.toContain(" open");
    expect(
      await render(
        <Disclosure title="Details" open>
          body
        </Disclosure>,
      ),
    ).toContain("open");
  });

  it("shows the hint only when given", async () => {
    expect(
      await render(
        <Disclosure title="Details" hint="11 snapshots">
          x
        </Disclosure>,
      ),
    ).toContain("11 snapshots");
    expect(await render(<Disclosure title="Details">x</Disclosure>)).not.toContain("snapshots");
  });
});

describe("DefinitionList", () => {
  it("renders numeric values and optional notes", async () => {
    const html = await render(
      <DefinitionList
        items={[
          { label: "Snapshots", value: 11 },
          { label: "Findings", value: 0, note: "Information only." },
        ]}
      />,
    );
    expect(html).toContain("Snapshots</dt>");
    expect(html).toContain("11");
    expect(html).toContain("Information only.");
  });
});
