import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import type { HealthBadge } from "../insights/health-panel.ts";
import {
  Badge,
  Button,
  Card,
  Meta,
  RelativeTime,
  Thumbnail,
  statusTone,
} from "../ui/components.tsx";
import { css } from "../ui/css.ts";
import { healthTone } from "./health-panel.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

const thumbStrip = css`
  /* project-thumbs */
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--accent-wash);
  border-bottom: 1px solid var(--border-subtle);
`;

const cardBody = css`
  /* project-body */
  flex: 1;
  display: grid;
  align-content: start;
  gap: var(--space-2);
  padding: var(--space-4);
`;

const cardTitleRow = css`
  /* project-title-row */
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
  justify-content: space-between;
`;

const cardTitle = css`
  /* project-title */
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 650;
  letter-spacing: -0.01em;
  & a {
    color: var(--text-primary);
  }
  & a:hover {
    color: var(--accent-fg);
  }
`;

const latestRow = css`
  /* project-latest */
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  color: var(--text-secondary);
  font-size: var(--text-sm);
`;

const cardFooter = css`
  /* project-footer */
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--border-subtle);
`;

/** What the overview shows about a project's most recent build. */
export interface ProjectSummary {
  project: Project;
  latest: Build | null;
  /** Up to three screenshots of the latest build. */
  previews: Snapshot[];
  /** Snapshots in the latest build still waiting for a decision. */
  pending: number;
  /** AI health digest (last 30 days) when one has finished. */
  health?: HealthBadge | null;
}

function PendingBadge({
  pending,
  href,
}: {
  pending: number;
  href: string;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  if (pending === 0) {
    return (
      <Badge tone="success" icon>
        All clear
      </Badge>
    );
  }
  return (
    <a href={href}>
      <Badge tone="warning" icon>
        {pending} to review
      </Badge>
    </a>
  );
}

function LatestBuild({
  latest,
}: {
  latest: Build | null;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  if (!latest) {
    return <Meta>No builds yet — upload one from CI.</Meta>;
  }
  return (
    <div class={latestRow}>
      <Meta as="span" mono>
        {latest.gitBranch} · {latest.gitSha.slice(0, 7)}
      </Meta>
      <Badge tone={statusTone(latest.status)}>{latest.status}</Badge>
      <RelativeTime value={latest.createdAt} />
    </div>
  );
}

function Previews({
  project,
  latest,
  previews,
}: Pick<ProjectSummary, "project" | "latest" | "previews">):
  | HtmlEscapedString
  | Promise<HtmlEscapedString> {
  return (
    <div class={thumbStrip}>
      {[0, 1, 2].map((slot): HtmlEscapedString | Promise<HtmlEscapedString> => {
        const snap = previews[slot];
        return (
          <Thumbnail
            key={String(slot)}
            src={
              snap && latest
                ? `/api/v1/projects/${project.slug}/builds/${latest.id}/snapshots/${snap.id}/image`
                : null
            }
            alt={snap ? `${snap.storyTitle} / ${snap.storyName}` : ""}
            placeholder=""
          />
        );
      })}
    </div>
  );
}

/** One project in the overview grid: previews, latest build, review state, actions. */
export function ProjectCard(props: {
  summary: ProjectSummary;
  urls: { library: string; settings: string; storybook: string; review: string };
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { summary, urls } = props;
  const { project, latest, previews, pending } = summary;
  return (
    <Card
      fill
      data-filter-item
      data-filter-text={`${project.name} ${project.slug} ${project.gitRepository ?? ""}`}
    >
      {previews.length > 0 ? (
        <Previews project={project} latest={latest} previews={previews} />
      ) : null}
      <div class={cardBody}>
        <div class={cardTitleRow}>
          <h2 class={cardTitle}>
            <a href={urls.library}>{project.name}</a>
          </h2>
          {latest ? <PendingBadge pending={pending} href={urls.review} /> : null}
        </div>
        <Meta>
          {project.gitRepository ?? project.slug} · default{" "}
          <Badge tone="neutral">{project.gitDefaultBranch}</Badge>
        </Meta>
        <LatestBuild latest={latest} />
        {summary.health ? (
          <a href={urls.library}>
            <Badge tone={healthTone(summary.health.verdict)} icon>
              health: {summary.health.verdict}
              {summary.health.score === null ? "" : ` · ${Math.round(summary.health.score)}`}
            </Badge>
          </a>
        ) : null}
      </div>
      <div class={cardFooter}>
        <Button variant="secondary" size="sm" icon="image" href={urls.library}>
          Library
        </Button>
        <Button variant="ghost" size="sm" icon="external-link" href={urls.storybook}>
          Storybook
        </Button>
        <Button variant="ghost" size="sm" icon="settings" href={urls.settings}>
          Settings
        </Button>
      </div>
    </Card>
  );
}
