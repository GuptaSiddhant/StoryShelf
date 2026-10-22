/**
 * The signed Storybook URL of a render (ADR 0007, decision 5): minted at the moment a pass starts,
 * only for a target whose browser cannot reach this host (`reach: "url"`). The URL is the build's
 * Storybook root, `<publicOrigin>/s/<token>/`; it carries the token and is never logged.
 */
import type { CaptureRunner, CaptureTarget } from "../adapters/capture-runner.ts";
import type { Build } from "../schema/build.ts";
import type { SecretInput } from "../utils/encrypt.ts";
import { signStorybookToken } from "../utils/storybook-token.ts";

/** Gives the URL a target's browser opens, or `undefined` when it needs none (or none can be made). */
export type StorybookUrlSource = (target: CaptureTarget) => Promise<string | undefined>;

/** What minting needs of a capture job. */
export interface StorybookUrlOptions {
  runner: Pick<CaptureRunner, "metadata">;
  secret?: SecretInput;
  publicOrigin?: (() => Promise<string | undefined>) | undefined;
  /** Token lifetime in seconds (default 2 hours). */
  storybookUrlTtl?: number | undefined;
}

/**
 * A source of signed URLs for one build. Every call mints a fresh token, so a shard that waited in
 * the queue or a retried pass is never handed a token minted before it started.
 */
export function storybookUrlSource(
  options: StorybookUrlOptions,
  build: Pick<Build, "id" | "projectId">,
): StorybookUrlSource {
  return async (target) => {
    const origin = needsUrl(options.runner, target) ? await options.publicOrigin?.() : undefined;
    const secret = typeof options.secret === "object" ? options.secret.current : options.secret;
    return origin !== undefined && secret
      ? `${origin}/s/${tokenFor(secret, build, options.storybookUrlTtl)}/`
      : undefined;
  };
}

function tokenFor(
  secret: string,
  build: Pick<Build, "id" | "projectId">,
  ttlSeconds: number | undefined,
): string {
  return signStorybookToken({ secret, projectId: build.projectId, buildId: build.id, ttlSeconds });
}

function needsUrl(runner: Pick<CaptureRunner, "metadata">, target: CaptureTarget): boolean {
  return runner.metadata.targets?.some((t) => t.target === target && t.reach === "url") ?? false;
}
