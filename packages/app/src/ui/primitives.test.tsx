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
  statusTone,
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

  it("takes role=status for a polite message, and role=none to leave the attribute off", async () => {
    const polite = await render(<Alert role="status">Heads up</Alert>);
    expect(polite).toContain('role="status"');
    expect(polite).not.toContain('role="alert"');
    const owned = await render(<Alert role="none">Inside a live region</Alert>);
    expect(owned).not.toContain("role=");
    expect(owned).toContain("Inside a live region");
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
      <Table dense label="Rows">
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

  it("is a focusable region named by its label", async () => {
    const html = await render(
      <Table label="API tokens">
        <table />
      </Table>,
    );
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="API tokens"');
    expect(html).toContain('tabindex="0"');
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

  it("offers up to 400% zoom with a draggable wipe handle", async () => {
    const html = await render(stage);
    expect(html).toContain('data-view-value="400"');
    expect(html).toContain("data-compare-knob");
    // Pixel-level inspection: zoomed images are not smoothed.
    expect(html).toMatch(/image-rendering:pixelated/u);
    expect(html).toMatch(/zoom:4/u);
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
    expect(html).toContain('alt="Current for X"');
    expect(html).not.toContain('alt="Diff for X"');
    expect(html).not.toContain("data-compare-mode");
    expect(html).toContain('href="/d.png"');
  });
});

/** The two scaled SVGs of a rendered stage (baseline first). */
function scaledSvgs(html: string): string[] {
  return [...html.matchAll(/<svg class="stage__img"[^>]*>[\s\S]*?<\/svg>/gu)].map(
    (match) => match[0],
  );
}

/** A 100×100 baseline beside a 120×100 current, both sizes known. */
const sized = (
  <CompareStage
    baselineSrc="/b.png"
    currentSrc="/c.png"
    diffSrc={null}
    subject="Card"
    baselineSize={{ width: 100, height: 100 }}
    currentSize={{ width: 120, height: 100 }}
  />
);

describe("CompareStage scale", () => {
  it("draws both images against the wider width, at natural size, with no style values", async () => {
    const html = await render(sized);
    const [baseline = "", current = ""] = scaledSvgs(html);
    // One box for both (120 wide): a shared scale min(1, pane / 120).
    expect(baseline).toContain('viewBox="0 0 120 100"');
    expect(current).toContain('viewBox="0 0 120 100"');
    expect(baseline).toContain('width="120"');
    // Each image keeps its own natural size inside that box, so the drawn ratio is 100:120.
    expect(baseline).toMatch(/<image href="\/b\.png" width="100" height="100"/u);
    expect(current).toMatch(/<image href="\/c\.png" width="120" height="100"/u);
    expect(html).not.toContain("style=");
  });

  it("names each scaled image like the plain one", async () => {
    const svgs = scaledSvgs(await render(sized));
    expect(svgs).toHaveLength(2);
    expect(svgs[0]).toContain('role="img" aria-label="Baseline for Card"');
  });

  it("never upscales in Fit, and shows each size in its pane label", async () => {
    const html = await render(sized);
    // Capped at the pane, never stretched past natural width (the old rule was width: 100%).
    expect(html).toMatch(/\.stage__img\{display:block;max-width:100%;height:auto;/u);
    expect(html).toContain("<span>100×100</span>");
    expect(html).toContain("<span>120×100</span>");
  });
});

describe("CompareStage layout", () => {
  it("falls back to plain images when a size is unknown", async () => {
    const html = await render(
      <CompareStage
        baselineSrc="/b.png"
        currentSrc="/c.png"
        diffSrc={null}
        subject="Card"
        currentSize={{ width: 120, height: 100 }}
      />,
    );
    expect(html).not.toContain('<svg class="stage__img"');
    expect(html).toContain('alt="Baseline for Card"');
  });

  it("is two columns, with the diff only in the diff mode", async () => {
    const html = await render(sized);
    expect(html).toMatch(
      /\.stage__grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/u,
    );
    expect(html).toMatch(
      /:not\(\[data-view="diff"\]\) \.stage__pane\[data-pane="diff"\]\{display:none/u,
    );
  });
});

describe("CompareStage panes", () => {
  it("makes a pane with an image a named, keyboard-focusable group, and leaves an empty pane alone", async () => {
    const html = await render(
      <CompareStage
        baselineSrc="/b.png"
        currentSrc="/c.png"
        diffSrc={null}
        subject="Button / Primary"
        diffEmpty="No diff yet"
      />,
    );
    expect(html).toContain('aria-label="Baseline screenshot"');
    expect(html).toContain('aria-label="Current screenshot"');
    expect(html).toMatch(
      /<div class="stage__pane" data-pane="baseline" tabindex="0" role="group"/u,
    );
    // Swipe clips and onion fades the current pane, and its outline with it: the ring is drawn on the grid.
    expect(html).toMatch(/\[data-view="swipe"\] \.stage__grid:has\(\.stage__pane:focus-visible\)/u);
    // The diff pane has no image here: nothing to scroll, so no tab stop and no name.
    expect(html).toMatch(/<div class="stage__pane" data-pane="diff">/u);
    expect(html).not.toContain("Diff screenshot");
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

  it("makes a scrolling snippet keyboard-focusable", async () => {
    const html = await render(<CodeBlock code="npx storyshelf upload" />);
    expect(html).toContain('<pre tabindex="0">');
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

describe("statusTone", () => {
  it("shows a cancelled build neutral: neither a failure nor a success", () => {
    expect(statusTone("cancelled")).toBe("neutral");
    expect(statusTone("failed")).toBe("danger");
    expect(statusTone("approved")).toBe("quiet");
  });
});
