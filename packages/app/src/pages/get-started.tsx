import type { Project } from "@storyshelf/core/schema";
import type { FC } from "hono/jsx";
import { csrfField } from "../shell/csrf-field.tsx";
import { Alert, Button, Card, CodeBlock, Icon, Meta, VStack } from "../ui/components.tsx";
import { css } from "../ui/css.ts";

const wrap = css`
  /* get-started */
  max-width: 720px;
`;

const header = css`
  /* get-started-header */
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-3);
  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }
`;

const step = css`
  /* get-started-step */
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: var(--space-3);
  align-items: start;
`;

const markerBase = css`
  /* get-started-marker */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  font-size: var(--text-sm);
  font-weight: 650;
  border: 2px solid var(--border);
  color: var(--text-secondary);
`;

const markerCurrent = css`
  /* get-started-marker-current */
  ${markerBase}
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-fg);
`;

const markerDone = css`
  /* get-started-marker-done */
  ${markerBase}
  background: var(--status-approved);
  border-color: var(--status-approved);
  color: var(--accent-fg);
`;

type StepState = "pending" | "current" | "done";

const Marker: FC<{ n: number; state: StepState }> = ({ n, state }) => (
  <span
    class={state === "done" ? markerDone : state === "current" ? markerCurrent : markerBase}
    aria-hidden="true"
  >
    {state === "done" ? <Icon name="check" /> : n}
  </span>
);

/** Placeholder shown for the server URL while no public origin is confirmed. */
export const ORIGIN_PLACEHOLDER = "<your-storyshelf-url>";

/** The upload command: `--url` is the confirmed public origin, never the request's Host. */
export function uploadCommand(input: {
  slug: string;
  origin: string | undefined;
  token: string | undefined;
}): string {
  return [
    `STORYSHELF_TOKEN=${input.token ?? "<token>"} npx storyshelf upload`,
    `  --url ${input.origin ?? ORIGIN_PLACEHOLDER}`,
    `  --slug ${input.slug}`,
  ].join(" \\\n");
}

export interface GetStartedProps {
  project: Project;
  /** The confirmed public origin (`Store.publicOrigin.url()`), or undefined when none is confirmed. */
  origin: string | undefined;
  /** The new token's name and one-time value, once step 1 is done. */
  created?: { name: string; value: string };
  error?: string;
}

const TokenStep: FC<{ base: string; created: GetStartedProps["created"] }> = ({
  base,
  created,
}) => (
  <div class={step}>
    <Marker n={1} state={created ? "done" : "current"} />
    <VStack>
      <strong>Token</strong>
      {created ? (
        <>
          <Meta>Created “{created.name}” — shown once, copy it now.</Meta>
          <CodeBlock code={created.value} />
        </>
      ) : (
        <form
          method="post"
          action={`${base}/token`}
          hx-post={`${base}/token`}
          hx-target="#get-started"
          hx-swap="outerHTML"
        >
          {csrfField()}
          <Button variant="primary" type="submit" icon="plus">
            Create a token
          </Button>
        </form>
      )}
    </VStack>
  </div>
);

const UploadStep: FC<GetStartedProps> = ({ project, origin, created }) => (
  <div class={step}>
    <Marker n={2} state={created ? "current" : "pending"} />
    <VStack>
      <strong>Upload</strong>
      <CodeBlock code={uploadCommand({ slug: project.slug, origin, token: created?.value })} />
      {origin ? null : (
        <Meta>
          No public URL is confirmed yet, so replace {ORIGIN_PLACEHOLDER} with the address of this
          server (an admin can set it under Admin → System).
        </Meta>
      )}
    </VStack>
  </div>
);

const WaitStep: FC<{ base: string }> = ({ base }) => (
  <div
    class={step}
    hx-get={`${base}/status`}
    hx-trigger="every 5s"
    hx-swap="none"
    aria-live="polite"
  >
    <Marker n={3} state="pending" />
    <VStack>
      <strong>Waiting for the first build…</strong>
      <Meta>This page checks every 5 seconds and moves on when a build arrives.</Meta>
    </VStack>
  </div>
);

/** First-run card for a project with no builds: create a token, upload, wait for the first build. */
export const GetStarted: FC<GetStartedProps> = (props) => {
  const base = `/projects/${props.project.slug}/get-started`;
  return (
    <div id="get-started" class={wrap}>
      <Card>
        <VStack gap="lg">
          <div class={header}>
            <h2>Get your first build</h2>
            <Meta>Step {props.created ? 2 : 1} of 3</Meta>
          </div>
          {props.error ? <Alert tone="danger">{props.error}</Alert> : null}
          <TokenStep base={base} created={props.created} />
          <UploadStep {...props} />
          <WaitStep base={base} />
        </VStack>
      </Card>
    </div>
  );
};
