// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { HStack, Meta as MetaText, VStack } from "./components.tsx";
import { css } from "./css.ts";

const meta: Meta = { title: "UI/Tokens" };
export default meta;

const swatchFrame = css`
  /* swatch-frame */
  display: inline-block;
  width: 2.5rem;
  height: 2.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
`;

const swatch_accent = css`
  /* swatch-accent */
  ${swatchFrame}
  background: var(--accent);
`;

const swatch_accent_contrast = css`
  /* swatch-accent-contrast */
  ${swatchFrame}
  background: var(--accent-contrast);
`;

const swatch_surface_base = css`
  /* swatch-surface-base */
  ${swatchFrame}
  background: var(--surface-base);
`;

const swatch_surface_card = css`
  /* swatch-surface-card */
  ${swatchFrame}
  background: var(--surface-card);
`;

const swatch_surface_muted = css`
  /* swatch-surface-muted */
  ${swatchFrame}
  background: var(--surface-muted);
`;

const swatch_surface_subtle = css`
  /* swatch-surface-subtle */
  ${swatchFrame}
  background: var(--surface-subtle);
`;

const swatch_text_primary = css`
  /* swatch-text-primary */
  ${swatchFrame}
  background: var(--text-primary);
`;

const swatch_text_secondary = css`
  /* swatch-text-secondary */
  ${swatchFrame}
  background: var(--text-secondary);
`;

const swatch_text_muted = css`
  /* swatch-text-muted */
  ${swatchFrame}
  background: var(--text-muted);
`;

const swatch_border = css`
  /* swatch-border */
  ${swatchFrame}
  background: var(--border);
`;

const swatch_border_subtle = css`
  /* swatch-border-subtle */
  ${swatchFrame}
  background: var(--border-subtle);
`;

const swatch_status_approved = css`
  /* swatch-status-approved */
  ${swatchFrame}
  background: var(--status-approved);
`;

const swatch_status_new = css`
  /* swatch-status-new */
  ${swatchFrame}
  background: var(--status-new);
`;

const swatch_status_rejected = css`
  /* swatch-status-rejected */
  ${swatchFrame}
  background: var(--status-rejected);
`;

const swatch_status_info = css`
  /* swatch-status-info */
  ${swatchFrame}
  background: var(--status-info);
`;

const swatches = [
  ["--accent", swatch_accent],
  ["--accent-contrast", swatch_accent_contrast],
  ["--surface-base", swatch_surface_base],
  ["--surface-card", swatch_surface_card],
  ["--surface-muted", swatch_surface_muted],
  ["--surface-subtle", swatch_surface_subtle],
  ["--text-primary", swatch_text_primary],
  ["--text-secondary", swatch_text_secondary],
  ["--text-muted", swatch_text_muted],
  ["--border", swatch_border],
  ["--border-subtle", swatch_border_subtle],
  ["--status-approved", swatch_status_approved],
  ["--status-new", swatch_status_new],
  ["--status-rejected", swatch_status_rejected],
  ["--status-info", swatch_status_info],
] as const;

/** The brand colour tokens of the active theme: switch Light/Dark in the toolbar to compare. */
export const Colours = jsxStory(() => (
  <div class="grid grid--3">
    {swatches.map(([name, swatch]) => (
      <HStack key={name}>
        <span class={swatch} role="img" aria-label={name} />
        <MetaText as="code">{name}</MetaText>
      </HStack>
    ))}
  </div>
));

export const Typography = jsxStory(() => (
  <VStack>
    <h1>Heading 1: Design coverage</h1>
    <h2>Heading 2: No design link</h2>
    <h3>Heading 3: Comments</h3>
    <p>Body text: Components of the latest accepted build.</p>
    <MetaText>Muted text: Captured 2 d ago.</MetaText>
    <MetaText as="code">mono: src/Button.stories.tsx</MetaText>
  </VStack>
));
