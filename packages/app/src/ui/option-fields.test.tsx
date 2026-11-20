import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MAX_OPTIONS, OptionFields, parseOptionFields } from "./option-fields.tsx";

async function render(node: unknown): Promise<string> {
  const app = new Hono();
  app.get("/", (c) => c.html(node as never));
  return await (await app.request("/")).text();
}

const options = [
  { value: "a", label: "A", children: <input name="x" /> },
  { value: "b", label: "B", children: <input name="y" /> },
];

describe("OptionFields", () => {
  it("renders a radio per option and disables the unselected group", async () => {
    const html = await render(
      <OptionFields name="k" label="Kind" options={options} selected="b" />,
    );
    expect(html.match(/type="radio"/gu)).toHaveLength(2);
    expect(html).toMatch(/value="b"[^>]*checked/u);
    expect(html).toMatch(/data-option-group="a"[^>]*disabled/u);
    expect(html).not.toMatch(/data-option-group="b"[^>]*disabled/u);
  });

  it("shows the checked option's group through a selector that matches the radio", async () => {
    const html = await render(<OptionFields name="k" label="Kind" options={options} />);
    expect(html).toContain("input[type=radio]:nth-of-type(2):checked");
    expect(html).not.toMatch(/type=\\?"\\?\\"radio/u);
  });

  it("selects the first option by default and supports cards", async () => {
    const html = await render(
      <OptionFields name="k" label="Kind" variant="cards" options={options} />,
    );
    expect(html).toMatch(/value="a"[^>]*checked/u);
  });

  it("refuses more options than the CSS covers", () => {
    const many = Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => ({
      value: `${i}`,
      label: `${i}`,
    }));
    expect(() => OptionFields({ name: "k", label: "Kind", options: many })).toThrow(/at most/u);
  });
});

describe("parseOptionFields", () => {
  const schemas = { a: z.object({ x: z.string().min(1) }), b: z.object({ y: z.string().min(1) }) };

  it("reads only the selected option", () => {
    expect(parseOptionFields({ k: "a", x: "1" }, "k", schemas)).toEqual({
      ok: true,
      value: { k: "a", x: "1" },
    });
  });

  it("validates the selected option's fields", () => {
    expect(parseOptionFields({ k: "a", x: "" }, "k", schemas).ok).toBe(false);
  });

  it("refuses fields of another option", () => {
    const result = parseOptionFields({ k: "a", x: "1", y: "2" }, "k", schemas);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("y");
  });

  it("refuses a missing or unknown choice", () => {
    expect(parseOptionFields({ x: "1" }, "k", schemas).ok).toBe(false);
    expect(parseOptionFields({ k: "z" }, "k", schemas).ok).toBe(false);
  });
});
