import type { FC } from "hono/jsx";
import { css } from "./css.ts";
import { Icon } from "./icons/icon.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

const referenceRoot = css`
  /* design-reference */
  display: grid;
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  .reference__label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: 0.35rem 0.6rem;
    background: var(--surface-subtle);
    border-bottom: 1px solid var(--border);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .reference__img {
    display: block;
    max-width: 100%;
    max-height: 60vh;
    margin: 0 auto;
    object-fit: contain;
  }
`;

const previewImg = css`
  /* design-preview */
  display: block;
  width: 16rem;
  max-width: 100%;
  max-height: 14rem;
  margin: 0.25rem auto;
  object-fit: contain;
  border-radius: var(--radius-sm);
  background: repeating-conic-gradient(var(--surface-muted) 0% 25%, var(--surface-subtle) 0% 50%) 0
    0 / 16px 16px;
`;

const previewCaption = css`
  /* design-preview-caption */
  padding: 0 0.6rem 0.25rem;
  color: var(--text-secondary);
  font-size: var(--text-xs);
`;

/** Cached Figma render shown as a reference pane under the diff stage. */
export const DesignReference: FC<{ src: string; name?: string | null; href: string }> = ({
  src,
  name,
  href,
}) => (
  <figure class={referenceRoot}>
    <figcaption class="reference__label">
      <span>Figma reference{name ? ` · ${name}` : ""}</span>
      <a href={href} target="_blank" rel="noopener noreferrer">
        <Icon name="external-link" size="sm" /> Open in Figma
      </a>
    </figcaption>
    <img
      class="reference__img"
      src={src}
      alt={name ? `Figma design: ${name}` : "Figma design"}
      loading="lazy"
    />
  </figure>
);

/** Small cached render for popovers, with an optional caption (the design name). */
export const DesignPreview: FC<{ src: string; name?: string | null }> = ({ src, name }) => (
  <>
    <img
      class={previewImg}
      src={src}
      alt={name ? `Figma design: ${name}` : "Figma design"}
      loading="lazy"
    />
    {name ? <div class={previewCaption}>{name}</div> : null}
  </>
);
