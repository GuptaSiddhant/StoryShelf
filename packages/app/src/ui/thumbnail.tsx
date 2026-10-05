import type { FC } from "hono/jsx";
import { css } from "./css.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

const thumbFrame = css`
  /* thumbnail */
  position: relative;
  display: block;
  overflow: hidden;
  aspect-ratio: 16 / 10;
  background: var(--surface-muted);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  & img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top center;
  }
`;

const thumbEmpty = css`
  /* thumbnail-empty */
  ${thumbFrame}
  display: grid;
  place-items: center;
  color: var(--text-secondary);
  font-size: var(--text-xs);
`;

/** Fixed-ratio, lazy-loaded screenshot preview with a muted placeholder. */
export const Thumbnail: FC<{ src?: string | null; alt: string; placeholder?: string }> = ({
  src,
  alt,
  placeholder = "No preview",
}) => {
  if (!src) {
    return <span class={thumbEmpty}>{placeholder}</span>;
  }
  return (
    <span class={thumbFrame}>
      <img src={src} alt={alt} loading="lazy" decoding="async" />
    </span>
  );
};
