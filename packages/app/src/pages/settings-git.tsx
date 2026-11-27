/**
 * Project → Settings → Git (ADR 0054, decisions 2 and 10): the repositories a project links
 * through the server's git connections, each with its state and, once connected, the required
 * check, the last delivery and what the link posts besides the gate.
 */
import type { StateOutputs } from "@storyshelf/core/adapter/notifier";
import type { Project } from "@storyshelf/core/schema";
import { createUrlBuilder } from "@storyshelf/core/urls";
import { csrfField } from "../shell/csrf-field.tsx";
import {
  Alert,
  Button,
  Card,
  Dialog,
  HStack,
  Meta,
  SectionTitle,
  SummaryList,
  formatRelative,
  type SummaryItem,
} from "../ui/components.tsx";

/** Where a link stands, as the project sees it. */
export type SettingsGitLinkState = "pending" | "approved" | "refused" | "broken";

/** One repository link of the project. */
export interface SettingsGitLink {
  id: string;
  /** `owner/repo`. */
  repository: string;
  /** The repository's web URL on its connection's host: what the edit form prefills. */
  url: string;
  /** The status prefix in effect (`storyshelf` by default). */
  prefix: string;
  connectionName: string;
  state: SettingsGitLinkState;
  /** Declared in configuration: shown, never edited here. */
  managed: boolean;
  /** Why a link is refused or broken. */
  reason: string | null;
  lastDeliveredAt: string | null;
  outputs: StateOutputs;
  /** Whether the connection may post the pull-request comment (its ceiling). */
  commentAllowed: boolean;
}

/** What the Git section renders. */
export interface SettingsGitData {
  links: SettingsGitLink[];
  /** The prefix the link form proposes. */
  proposedPrefix: string;
}

/** Form values and errors of a refused link form. */
export interface GitLinkFormState {
  errors?: Record<string, string>;
  values?: { repository?: string; prefix?: string };
}

/** The state badge of a link; a configured link that works reads "Managed by configuration". */
export function linkBadge(link: SettingsGitLink): NonNullable<SummaryItem["state"]> {
  if (link.state === "pending") {
    return { label: "Waiting for approval", tone: "warning" };
  }
  if (link.state === "refused") {
    return { label: "Refused", tone: "danger" };
  }
  if (link.state === "broken") {
    return { label: "Broken", tone: "danger" };
  }
  return link.managed
    ? { label: "Managed by configuration", tone: "info" }
    : { label: "Connected", tone: "success" };
}

/** The required-check name branch protection asks for. */
export function requiredCheckOf(link: Pick<SettingsGitLink, "prefix">): string {
  return `${link.prefix}/testing`;
}

/** The attributes that open `git-dialog` on a link's form: a real link, fetched into the dialog. */
function opener(href: string): Record<string, string> {
  return {
    href,
    "hx-get": href,
    "hx-target": "#git-dialog-body",
    "hx-swap": "innerHTML",
    "hx-push-url": "false",
    "data-dialog-open": "git-dialog",
  };
}

/** The line under a link's name: what it needs from the site admin, or what it posts. */
export function linkDetails(link: SettingsGitLink): string {
  const base = `${link.connectionName} · required check ${requiredCheckOf(link)}`;
  if (link.state === "pending") {
    return `${base}. Nothing is posted until a site admin approves it.`;
  }
  if (link.state === "refused") {
    return `${base}. ${link.reason ?? "A site admin refused this link."}`;
  }
  if (link.state === "broken") {
    return `${base}. ${link.reason ?? "The host no longer reaches this repository."} Ask a site admin to reconnect it.`;
  }
  // No timestamp, no claim: links record no delivery time yet, so silence is not "nothing delivered".
  return link.lastDeliveredAt === null
    ? base
    : `${base} · last delivery ${formatRelative(link.lastDeliveredAt)}`;
}

function linkActions(project: Project, link: SettingsGitLink, isAdmin: boolean): unknown {
  if (!isAdmin || link.managed) {
    return null;
  }
  const base = createUrlBuilder("/").settingsTab(project.slug, "git");
  return (
    <HStack>
      <Button variant="secondary" size="sm" {...opener(`${base}/${link.id}/edit`)}>
        Edit
      </Button>
      <form
        method="post"
        action={`${base}/${link.id}/delete`}
        hx-post={`${base}/${link.id}/delete`}
        hx-target="body"
        hx-confirm="Remove this link? Builds stop posting to the repository."
      >
        {csrfField()}
        <Button variant="danger-secondary" size="sm" type="submit">
          Remove
        </Button>
      </form>
    </HStack>
  );
}

function itemOf(project: Project, link: SettingsGitLink, isAdmin: boolean): SummaryItem {
  return {
    id: link.id,
    name: link.repository,
    state: linkBadge(link),
    details: linkDetails(link),
    actions: linkActions(project, link, isAdmin),
  };
}

/** The Git section of the project settings. */
export function renderSettingsGit(
  project: Project,
  data: SettingsGitData,
  isAdmin: boolean,
  formState?: { globalError?: string },
): unknown {
  const base = createUrlBuilder("/").settingsTab(project.slug, "git");
  const add = (primary: boolean): unknown =>
    isAdmin ? (
      <Button
        variant={primary ? "primary" : "secondary"}
        size={primary ? "md" : "sm"}
        {...opener(`${base}/new`)}
      >
        Link a repository
      </Button>
    ) : null;
  return (
    <div class="grid max-w-form">
      {formState?.globalError ? <Alert tone="danger">{formState.globalError}</Alert> : null}
      <Card>
        <SectionTitle actions={data.links.length > 0 ? add(false) : null}>Git</SectionTitle>
        <Meta>
          Post this project's builds to a repository as the required check. A new link waits for a
          site admin before anything is posted.
        </Meta>
        <SummaryList
          label="Linked repositories"
          items={data.links.map((link) => itemOf(project, link, isAdmin))}
          emptyTitle="No repository linked"
          emptyDescription="Link a repository to show build status on its commits and pull requests."
          add={add(true)}
        />
      </Card>
      <Dialog id="git-dialog" title="Repository link" />
    </div>
  );
}

/** The one line a site admin sees where the Git section would be: the server has no connection. */
export function renderGitNotConnected(): unknown {
  return (
    <Alert tone="info">
      Repository links are not offered to projects on this server: no git connection is set up. Add
      one under <a href="/admin#git">System › Git</a>.
    </Alert>
  );
}
