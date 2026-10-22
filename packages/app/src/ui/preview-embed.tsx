import type { FC } from "hono/jsx";
import { Button } from "./buttons.tsx";
import { css } from "./css.ts";
import { Meta } from "./feedback.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

/**
 * Sandbox of the embedded story frame (ADR 0006, decision 9). Scripts only: no `allow-same-origin`,
 * so a customer's Storybook never runs with the app's origin and its cookies, and no top navigation,
 * forms or popups.
 */
export const PREVIEW_SANDBOX = "allow-scripts";

const previewHost = css`
  /* preview-embed */
  display: grid;
  min-height: 12rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  background: var(--surface-muted);
  overflow: hidden;
`;

const previewIdle = css`
  /* preview-embed-idle */
  display: grid;
  gap: 0.5rem;
  place-items: center;
  align-content: center;
  padding: 2rem 1rem;
  text-align: center;
`;

const previewFrame = css`
  /* preview-embed-frame */
  display: block;
  width: 100%;
  height: 28rem;
  border: 0;
  background: var(--surface-card);
`;

/**
 * A published story in a sandboxed frame that loads on click. The frame is inert markup (a
 * `<template>`) until the visitor asks for it, so opening a page never runs the customer's
 * Storybook; the shell script moves the frame in on click and, for a signed URL, re-points it
 * to a fresh token before the current one expires.
 */
export const PreviewEmbed: FC<{
  src: string;
  title: string;
  /** For a frame under a signed URL: where to ask for a fresh root, the path after it, how often. */
  refresh?: { url: string; path: string; seconds: number };
}> = ({ src, title, refresh }) => (
  <div
    class={previewHost}
    data-preview-embed
    {...(refresh
      ? {
          "data-preview-refresh-url": refresh.url,
          "data-preview-path": refresh.path,
          "data-preview-refresh-seconds": String(refresh.seconds),
        }
      : {})}
  >
    <div class={previewIdle} data-preview-idle>
      <Button variant="secondary" size="sm" icon="image" data-preview-load>
        Load preview
      </Button>
      <Meta as="span">Runs the published story in a sandboxed frame, only when you ask.</Meta>
    </div>
    <template data-preview-template>
      <iframe
        class={previewFrame}
        src={src}
        title={title}
        sandbox={PREVIEW_SANDBOX}
        referrerpolicy="no-referrer"
      />
    </template>
  </div>
);
