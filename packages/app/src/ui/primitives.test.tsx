import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { initials } from "./avatar.tsx";
import {
  Alert,
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Card,
  CodeBlock,
  CompareStage,
  Dropdown,
  DropdownDivider,
  DropdownItem,
  FilterInput,
  Icon,
  Kbd,
  Progress,
  RelativeTime,
  Segmented,
  SubNavLayout,
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

describe("Progress", () => {
  it("exposes a determinate progressbar and clamps to the max", async () => {
    const half = await render(<Progress value={1} max={4} label="Review" />);
    expect(half).toContain('role="progressbar"');
    expect(half).toContain('aria-valuenow="1"');
    expect(half).toContain("width:25%");
    const over = await render(<Progress value={9} max={4} label="Review" />);
    expect(over).toContain('aria-valuenow="4"');
    expect(over).toContain("width:100%");
  });

  it("renders an empty bar (not NaN) when there is nothing to do", async () => {
    const html = await render(<Progress value={0} max={0} label="Review" />);
    expect(html).toContain("width:0%");
    expect(html).not.toContain("NaN");
  });
});

describe("CompareStage", () => {
  const stage = (
    <CompareStage
      baselineSrc="/b.png"
      currentSrc="/c.png"
      diffSrc={null}
      subject="Button / Primary"
      diffEmpty="No diff yet"
    />
  );

  it("starts side by side, fit, with all three panes and mode/zoom controls", async () => {
    const html = await render(stage);
    expect(html).toContain('data-view="split"');
    expect(html).toContain('data-zoom="fit"');
    for (const pane of ["baseline", "current", "diff"]) {
      expect(html).toContain(`data-pane="${pane}"`);
    }
    for (const mode of ["split", "swipe", "onion", "diff", "flip"]) {
      expect(html).toContain(`data-view-value="${mode}"`);
    }
    expect(html).toContain("data-compare-swipe");
    expect(html).toContain("data-compare-onion");
  });

  it("describes images for assistive tech and shows an empty state without a diff", async () => {
    const html = await render(stage);
    expect(html).toContain('alt="Baseline for Button / Primary"');
    expect(html).toContain('alt="Current for Button / Primary"');
    expect(html).toContain("No diff yet");
    expect(html).not.toContain('alt="Diff for');
  });

  it("falls back to a first-capture message when there is no baseline", async () => {
    const html = await render(
      <CompareStage baselineSrc={null} currentSrc="/c.png" diffSrc="/d.png" subject="X" />,
    );
    expect(html).toContain("no baseline yet");
    expect(html).toContain('alt="Diff for X"');
  });
});

describe("RelativeTime", () => {
  it("renders a machine-readable <time> with the exact timestamp on hover", async () => {
    const html = await render(<RelativeTime value="2020-01-02T03:04:05.000Z" />);
    expect(html).toContain('datetime="2020-01-02T03:04:05.000Z"');
    expect(html).toContain("title=");
    expect(html).toContain("2020-01-02");
  });

  it("does not throw on invalid input", async () => {
    const html = await render(<RelativeTime value="not a date" />);
    expect(html).toContain("unknown");
  });
});

describe("CodeBlock and FilterInput", () => {
  it("exposes the snippet through a copy button", async () => {
    const html = await render(<CodeBlock code="npx storyshelf upload" />);
    expect(html).toContain("<code>npx storyshelf upload</code>");
    expect(html).toContain('data-copy="npx storyshelf upload"');
    expect(html).toContain("#i-copy");
  });

  it("renders a labeled search input the shell script can find", async () => {
    const html = await render(<FilterInput label="Filter projects" />);
    expect(html).toContain("data-filter-input");
    expect(html).toContain('aria-label="Filter projects"');
    expect(html).toContain('type="search"');
  });
});

describe("SubNavLayout", () => {
  it("renders a labeled nav with icons, marks the active page, and wraps content", async () => {
    const html = await render(
      <SubNavLayout
        label="Settings sections"
        items={[
          { label: "General", href: "/s", icon: "settings", active: true },
          { label: "Tokens", href: "/s/tokens", icon: "key" },
        ]}
      >
        <p>Body</p>
      </SubNavLayout>,
    );
    expect(html).toContain('aria-label="Settings sections"');
    expect(html).toContain('aria-current="page"');
    expect(html.match(/aria-current="page"/gu)?.length).toBe(1);
    expect(html).toContain("#i-settings");
    expect(html).toContain("#i-key");
    expect(html).toContain("<p>Body</p>");
  });
});

describe("alignment guards", () => {
  it("top-aligns buttons so a button inside a form is not taller than its siblings", async () => {
    const html = await render(<Button>Go</Button>);
    expect(html).toMatch(/vertical-align:top/u);
  });

  it("lets a card fill its grid cell as a flex column", async () => {
    const html = await render(<Card fill>Body</Card>);
    expect(html).toContain("ss-card-column-");
    expect(html).toMatch(/flex-direction:column/u);
  });
});
