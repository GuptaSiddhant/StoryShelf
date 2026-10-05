import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { initials } from "./avatar.tsx";
import {
  Alert,
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Dropdown,
  DropdownDivider,
  DropdownItem,
  Icon,
  Kbd,
  Segmented,
  Table,
  Thumbnail,
} from "./components.tsx";
import { Style } from "./css.ts";
import { iconSpriteHref } from "./icons/sprite.ts";

async function render(node: unknown): Promise<string> {
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

describe("Icon", () => {
  it("references the cached sprite and is hidden from assistive tech by default", async () => {
    const html = await render(<Icon name="check" />);
    expect(html).toContain(`href="${iconSpriteHref}#i-check"`);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("role=");
  });

  it("exposes a label when the icon is the only content", async () => {
    const html = await render(<Icon name="search" label="Search" />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Search"');
    expect(html).not.toContain("aria-hidden");
  });
});

describe("Button", () => {
  it("renders a leading icon in buttons and links", async () => {
    const html = await render(
      <>
        <Button icon="plus">New</Button>
        <Button href="/x" icon="arrow-right" variant="secondary">
          Go
        </Button>
      </>,
    );
    expect(html).toContain("#i-plus");
    expect(html).toContain("#i-arrow-right");
    expect(html).toContain('<a class="');
  });
});

describe("Badge and Alert", () => {
  it("adds a status glyph to badges only on request", async () => {
    const plain = await render(<Badge tone="success">ok</Badge>);
    const withIcon = await render(
      <Badge tone="success" icon>
        ok
      </Badge>,
    );
    expect(plain).not.toContain("#i-check-circle");
    expect(withIcon).toContain("#i-check-circle");
  });

  it("pairs every alert tone with an icon and keeps role=alert", async () => {
    const html = await render(
      <Alert tone="danger" title="Nope">
        Failed
      </Alert>,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("#i-x-circle");
    expect(html).toContain("Nope");
  });
});

describe("Avatar", () => {
  it("derives initials from names and emails", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("grace.hopper@navy.mil")).toBe("GH");
    expect(initials("plato")).toBe("PL");
    expect(initials("  ")).toBe("");
  });

  it("renders an image when given a source, otherwise labeled initials", async () => {
    const withImg = await render(<Avatar name="Ada" src="/a.png" />);
    const fallback = await render(
      <AvatarGroup>
        <Avatar name="Ada Lovelace" />
      </AvatarGroup>,
    );
    expect(withImg).toContain('src="/a.png"');
    expect(fallback).toContain('aria-label="Ada Lovelace"');
    expect(fallback).toContain(">AL<");
  });
});

describe("Segmented", () => {
  it("renders toggle buttons with aria-pressed and passes root attributes through", async () => {
    const html = await render(
      <Segmented
        label="View"
        data-view-switch
        items={[
          { label: "Split", value: "split", active: true },
          { label: "Diff", value: "diff" },
        ]}
      />,
    );
    expect(html).toContain('role="group"');
    expect(html).toContain("data-view-switch");
    expect(html).toContain('data-view-value="split"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
  });

  it("renders links with aria-current for navigation filters", async () => {
    const html = await render(
      <Segmented
        label="Status"
        items={[
          { label: "All", value: "", href: "/b", active: true },
          { label: "Failed", value: "failed", href: "/b?status=failed" },
        ]}
      />,
    );
    expect(html).toContain('href="/b?status=failed"');
    expect(html).toContain('aria-current="page"');
  });
});

describe("Dropdown", () => {
  it("renders a native details menu with items and a divider", async () => {
    const html = await render(
      <Dropdown label="Project" align="end">
        <DropdownItem href="/p/a" current>
          A
        </DropdownItem>
        <DropdownDivider />
        <DropdownItem icon="log-out">Sign out</DropdownItem>
      </Dropdown>,
    );
    expect(html).toContain("<details");
    expect(html).toContain("data-dropdown");
    expect(html).toContain('role="menuitem"');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('role="separator"');
    expect(html).toContain("#i-log-out");
  });
});

describe("Table, Thumbnail, Kbd", () => {
  it("wraps native table markup in the table surface", async () => {
    const html = await render(
      <Table dense>
        <table>
          <tbody>
            <tr>
              <td>x</td>
            </tr>
          </tbody>
        </table>
      </Table>,
    );
    expect(html).toContain("ss-table-dense-");
    expect(html).toContain("<td>x</td>");
  });

  it("lazy-loads the image or falls back to a placeholder", async () => {
    const withSrc = await render(<Thumbnail src="/s.png" alt="Story" />);
    const without = await render(<Thumbnail alt="Story" placeholder="Nothing" />);
    expect(withSrc).toContain('loading="lazy"');
    expect(without).toContain("Nothing");
    expect(without).not.toContain("<img");
  });

  it("renders one chip per key", async () => {
    const html = await render(<Kbd keys={["g", "b"]} />);
    expect(html.match(/<kbd/gu)?.length).toBe(2);
  });
});
