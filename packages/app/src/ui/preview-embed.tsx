import type { FC } from "hono/jsx";
import { Button } from "./buttons.tsx";
import { css } from "./css.ts";
import { Alert, Meta } from "./feedback.tsx";
import { HStack, VStack } from "./stacks.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

/**
 * Sandbox of the embedded story frame (ADR 0006, decision 9). Scripts only: no `allow-same-origin`,
 * so a customer's Storybook never runs with the app's origin and its cookies, and no top navigation,
 * forms or popups.
 */
export const PREVIEW_SANDBOX = "allow-scripts";

const previewWrap = css`
  /* preview-embed-wrap */
  display: grid;
  gap: 0.5rem;
  min-width: 0;
`;

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

/** "40 minutes", from the refresh interval: whole minutes, at least one. */
function everyLabel(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? "minute" : `${String(minutes)} minutes`;
}

/**
 * What a signed preview says about itself, under the box: a line telling that the frame reloads
 * itself to stay signed in, and (hidden until the script shows it, once the last retry of a
 * renewal failed) a notice with a button to reload it now. The two never show together. They sit
 * in a polite live region so showing the notice is announced.
 */
const SignedNotes: FC<{ seconds: number }> = ({ seconds }) => (
  <div role="status" aria-live="polite">
    <div data-preview-disclosure>
      <Meta as="span">
        {`Signed preview: it reloads itself every ${everyLabel(seconds)} to stay signed in.`}
      </Meta>
    </div>
    <div data-preview-notice hidden>
      <Alert tone="warning" title="Preview couldn't be renewed" role="none">
        <VStack gap="sm">
          <span>
            StoryShelf couldn&apos;t get a new signed link, so this preview will stop loading when
            the current one expires. Reload it to try again.
          </span>
          <HStack>
            <Button variant="secondary" size="sm" data-preview-reload>
              Reload preview
            </Button>
          </HStack>
          <span data-preview-again hidden>
            <Meta as="span">Still can&apos;t reach the server. Try again in a moment.</Meta>
          </span>
        </VStack>
      </Alert>
    </div>
  </div>
);

/**
 * A published story in a sandboxed frame that loads on click. The frame is inert markup (a
 * `<template>`) until the visitor asks for it, so opening a page never runs the customer's
 * Storybook; the shell script moves the frame in on click and, for a signed URL, re-points it
 * to a fresh token before the current one expires. A signed preview tells so under the box, and
 * says when a renewal could not be made, with a way to reload it.
 */
export const PreviewEmbed: FC<{
  src: string;
  title: string;
  /** For a frame under a signed URL: where to ask for a fresh root, the path after it, how often. */
  refresh?: { url: string; path: string; seconds: number };
}> = ({ src, title, refresh }) => (
  <div class={previewWrap} data-preview-wrap>
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
    {refresh ? <SignedNotes seconds={refresh.seconds} /> : null}
  </div>
);
