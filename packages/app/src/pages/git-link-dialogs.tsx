/**
 * The dialogs of System → Git's requests (ADR 0054, decision 2; ADR 0012, decision 10): approve a
 * link after seeing whether its connection covers the repository, or refuse it with a reason. An
 * HTMX request gets the body alone, swapped into the page's dialog; a plain request (a pasted URL,
 * no script) gets the same body on a page of its own.
 */
import type { HtmlEscapedString } from "hono/utils/html";
import { csrfField } from "../shell/csrf-field.tsx";
import { DocumentLayout, type RenderedContent } from "../shell/document.tsx";
import {
  Alert,
  Button,
  Card,
  DefinitionList,
  FormActions,
  PageHeader,
  TextareaField,
  VStack,
} from "../ui/components.tsx";
import type { GitLinkRequestView } from "./admin-git.tsx";

/** What the connection's own credentials say about the repository. */
export type GitCoverageView =
  | { kind: "covered"; repositoryId: string; installationId: string | null }
  | { kind: "not-covered"; installUrl?: string | undefined }
  | { kind: "unreachable"; detail: string }
  | { kind: "no-connection" };

function LinkFacts(props: {
  link: GitLinkRequestView;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { link } = props;
  return (
    <DefinitionList
      items={[
        { label: "Repository", value: link.repository },
        { label: "Project", value: link.project?.name ?? "Removed" },
        { label: "Connection", value: link.connectionName },
        { label: "Status prefix", value: link.prefix || "storyshelf (default)" },
      ]}
    />
  );
}

/** The coverage answer, as an alert the site admin reads before approving. */
function CoverageNotice(props: {
  coverage: GitCoverageView;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { coverage } = props;
  if (coverage.kind === "covered") {
    const installation = coverage.installationId ? `, installation ${coverage.installationId}` : "";
    return (
      <Alert tone="success" title="Covered">
        The connection reaches this repository (id {coverage.repositoryId}
        {installation}). Approving pins that id, so a repository re-created under the same name is
        not reached.
      </Alert>
    );
  }
  if (coverage.kind === "not-covered") {
    return (
      <Alert tone="warning" title="Not covered">
        The connection does not reach this repository, so it cannot be approved.{" "}
        {coverage.installUrl ? (
          <a href={coverage.installUrl} rel="noreferrer">
            Install the App on it
          </a>
        ) : (
          "Give the token access to it"
        )}
        , then try again.
      </Alert>
    );
  }
  return (
    <Alert tone="danger" title="Cannot check coverage">
      {coverage.kind === "no-connection"
        ? "The link's connection is gone. The project admin links the repository again through another connection."
        : `The git host did not answer (${coverage.detail}). Try again later.`}
    </Alert>
  );
}

const formId = (link: GitLinkRequestView, action: string): string =>
  `git-link-${action}-${link.id}`;

/** The approve dialog's body: facts, coverage, and Approve when it is covered. */
export function ApproveLinkBody(props: {
  link: GitLinkRequestView;
  coverage: GitCoverageView;
  /** Where an answer is swapped: the dialog's body, or the whole page outside a dialog. */
  target: string;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { link, coverage, target } = props;
  const path = `/admin/git/links/${link.id}/approve`;
  return (
    <VStack>
      <LinkFacts link={link} />
      <CoverageNotice coverage={coverage} />
      <form
        id={formId(link, "approve")}
        method="post"
        action={path}
        hx-post={path}
        hx-target={target}
      >
        {csrfField()}
        <FormActions>
          <Button variant="secondary" data-dialog-close>
            Cancel
          </Button>
          <Button type="submit" disabled={coverage.kind !== "covered"}>
            {link.state === "broken" ? "Reconnect" : "Approve"}
          </Button>
        </FormActions>
      </form>
    </VStack>
  );
}

/** The refuse dialog's body: an optional reason the project sees. */
export function RefuseLinkBody(props: {
  link: GitLinkRequestView;
  target: string;
  error?: string | undefined;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { link, target, error } = props;
  const path = `/admin/git/links/${link.id}/refuse`;
  return (
    <VStack>
      <LinkFacts link={link} />
      <form
        id={formId(link, "refuse")}
        method="post"
        action={path}
        hx-post={path}
        hx-target={target}
      >
        {csrfField()}
        <TextareaField
          label="Reason"
          name="reason"
          rows={3}
          error={error}
          hint="Shown to the project's admins. The refused link keeps its record."
        />
        <FormActions>
          <Button variant="secondary" data-dialog-close>
            Cancel
          </Button>
          <Button type="submit" variant="danger">
            Refuse
          </Button>
        </FormActions>
      </form>
    </VStack>
  );
}

/** A dialog body on a page of its own, for a request without HTMX. */
export function renderLinkDialogPage(title: string, body: unknown): RenderedContent {
  return (
    <DocumentLayout
      title={title}
      nav={{
        active: "admin",
        trail: [
          { label: "System", href: "/admin" },
          { label: "Git", href: "/admin/git" },
          { label: title },
        ],
      }}
    >
      <PageHeader
        title={title}
        actions={
          <Button variant="secondary" size="sm" href="/admin/git">
            Back
          </Button>
        }
      />
      <Card>{body}</Card>
    </DocumentLayout>
  );
}
