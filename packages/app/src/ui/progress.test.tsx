import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { Progress } from "./components.tsx";
import { Style } from "./css.ts";

async function render(value: number, max: number): Promise<string> {
  const app = new Hono();
  app.get(
    "/",
    async (c) =>
      await c.html(
        <>
          <Progress value={value} max={max} label="Captured" />
          <Style />
        </>,
      ),
  );
  return await (await app.request("/")).text();
}

describe("Progress", () => {
  it("sets the fill width through a class, never an inline style", async () => {
    const html = await render(18, 40);
    expect(html).not.toContain("style=");
    expect(html).toMatch(/width:\s*45%/u);
    expect(html).toContain('aria-valuenow="18"');
  });

  it("clamps the fill to 0 to 100 percent", async () => {
    expect(await render(5, 0)).toMatch(/width:\s*0%/u);
    expect(await render(99, 40)).toMatch(/width:\s*100%/u);
  });
});
