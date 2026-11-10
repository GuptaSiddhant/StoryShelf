import { Hono } from "hono";
import { describe, expect, it } from "vite-plus/test";
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

/** The width declared by the rule of the class the fill `<span>` carries, not by any rule in the sheet. */
function fillWidth(html: string): string | undefined {
  // A generated class name is `ss-<label>-<hash>`: letters, digits and hyphens only.
  const fillClass = /<span class="([\w-]+)"/u.exec(html)?.[1];
  if (!fillClass) return undefined;
  const declarations = new RegExp(String.raw`\.${fillClass}\s*\{([^}]*)\}`, "u").exec(html)?.[1];
  return /width:\s*(\d+%)/u.exec(declarations ?? "")?.[1];
}

describe("Progress", () => {
  it("sets the fill width through a class, never an inline style", async () => {
    const html = await render(18, 40);
    expect(html).not.toContain("style=");
    expect(fillWidth(html)).toBe("45%");
    expect(html).toContain('aria-valuenow="18"');
  });

  it("clamps the fill to 0 to 100 percent", async () => {
    expect(fillWidth(await render(5, 0))).toBe("0%");
    expect(fillWidth(await render(0, 40))).toBe("0%");
    expect(fillWidth(await render(40, 40))).toBe("100%");
    expect(fillWidth(await render(99, 40))).toBe("100%");
  });
});
