/**
 * The signed Storybook URL of a render (ADR 0007, decision 5): minted at the moment a pass starts,
 * only for a target whose browser cannot reach this host (`reach: "url"`). The URL is the build's
 * Storybook root, `<publicOrigin>/_s/<token>/`; it carries the token and is never logged. Its
 * lifetime comes from the pass's render budget unless the project sets one (`storybookUrlTtl`).
 */
import type { CaptureRunner, CaptureTarget } from "../adapters/capture-runner.ts";
import type { Build } from "../schema/build.ts";
import type { Project } from "../schema/project.ts";
import type { SecretInput } from "../utils/encrypt.ts";
import {
  signStorybookToken,
  storybookTokenPath,
  storybookUrlTtl,
} from "../utils/storybook-token.ts";

/** What a pass tells the source: how long it may run, which sizes the token's lifetime. */
export interface StorybookUrlPass {
  /** The render budget of the pass in ms (`renderBudgetMs`); unset when the pass has none. */
  budgetMs?: number | undefined;
}

/** Gives the URL a target's browser opens, or `undefined` when it needs none (or none can be made). */
export type StorybookUrlSource = (
  target: CaptureTarget,
  pass?: StorybookUrlPass,
) => Promise<string | undefined>;

/** What minting needs of a capture job. */
export interface StorybookUrlOptions {
  runner: Pick<CaptureRunner, "metadata">;
  secret?: SecretInput;
  publicOrigin?: (() => Promise<string | undefined>) | undefined;
}

/**
 * A source of signed URLs for one build. Every call mints a fresh token, so a shard that waited in
 * the queue or a retried pass is never handed a token minted before it started.
 */
export function storybookUrlSource(
  options: StorybookUrlOptions,
  subject: {
    build: Pick<Build, "id" | "projectId">;
    project: Pick<Project, "storybookUrlTtlSeconds">;
  },
): StorybookUrlSource {
  return async (target, pass = {}) => {
    const origin = needsUrl(options.runner, target) ? await options.publicOrigin?.() : undefined;
    return origin !== undefined && options.secret
      ? `${origin}${mint(options.secret, subject, pass)}`
      : undefined;
  };
}

/** The path of a fresh token for one pass of the build. */
function mint(
  secret: SecretInput,
  subject: Parameters<typeof storybookUrlSource>[1],
  pass: StorybookUrlPass,
): string {
  const ttlSeconds = storybookUrlTtl({
    override: subject.project.storybookUrlTtlSeconds,
    budgetMs: pass.budgetMs ?? 0,
  });
  const { id: buildId, projectId } = subject.build;
  return storybookTokenPath(signStorybookToken({ secret, projectId, buildId, ttlSeconds }));
}

function needsUrl(runner: Pick<CaptureRunner, "metadata">, target: CaptureTarget): boolean {
  return runner.metadata.targets?.some((t) => t.target === target && t.reach === "url") ?? false;
}
