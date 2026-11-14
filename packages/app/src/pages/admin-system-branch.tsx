import type { HtmlEscapedString } from "hono/utils/html";
import { Alert } from "../ui/components.tsx";

/** A project whose default-branch builds count without the git host's confirmation. */
export interface UnverifiedDefaultProject {
  name: string;
  slug: string;
}

/**
 * Projects that turned default-branch verification off (ADR 0009, amendment 2026-11-13): any
 * upload token of theirs can move the default-branch baselines, so the site admin sees them here.
 */
export function UnverifiedDefaultNotice(props: {
  projects: readonly UnverifiedDefaultProject[] | undefined;
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  const { projects } = props;
  if (projects === undefined || projects.length === 0) {
    return null;
  }
  return (
    <div class="mt-1">
      <Alert tone="warning" title="Default-branch builds counted unverified">
        {projects.length === 1 ? "One project counts" : `${String(projects.length)} projects count`}{" "}
        builds that name its default branch without a git host confirming the commit is on it:{" "}
        {projects.map((project, index): HtmlEscapedString | Promise<HtmlEscapedString> => (
          <span key={project.slug}>
            {index > 0 ? ", " : ""}
            <a href={`/projects/${project.slug}/settings/tests`}>{project.name}</a>
          </span>
        ))}
        . Any upload token of those projects can move their default-branch baselines. Connect a git
        channel and turn verification back on in the project's Tests settings.
      </Alert>
    </div>
  );
}
