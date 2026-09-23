import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { Style } from "./css.ts";
import { HStack, VStack } from "./stacks.tsx";

async function renderShell(node: unknown): Promise<string> {
  const app = new Hono();
  app.get("/", async (c) => {
    return await c.html(
      <html>
        <head>
          <Style />
        </head>
        <body>{node as string}</body>
      </html>,
    );
  });
  return await (await app.request("/")).text();
}

function collectedCss(html: string): string {
  const match = /<style id="storyshelf-css">(?<css>[\s\S]*)<\/style>/u.exec(html);
  return match?.groups?.["css"] ?? "";
}

describe("HStack/VStack", () => {
  it("renders readable hashed classes with default gaps", async () => {
    const html = await renderShell(
      <>
        <HStack>
          <span>a</span>
        </HStack>
        <VStack>
          <span>b</span>
        </VStack>
      </>,
    );
    expect(html).toContain("ss-hstack-");
    expect(html).toContain("ss-vstack-");
    const css = collectedCss(html);
    expect(css).toContain("display:flex");
    expect(css).toContain("gap:0.5rem");
    expect(css).toContain("display:grid");
    expect(css).toContain("gap:0.75rem");
  });

  it("maps justify, align, and wrap props to declarations", async () => {
    const html = await renderShell(
      <HStack justify="between" align="start" wrap={false} gap="lg">
        <span>a</span>
      </HStack>,
    );
    const css = collectedCss(html);
    expect(css).toContain("justify-content:space-between");
    expect(css).toContain("align-items:flex-start");
    expect(css).toContain("flex-wrap:nowrap");
    expect(css).toContain("gap:1rem");
  });
});
