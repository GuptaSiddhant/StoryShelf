/**
 * The GitHub App manifest flow's own pages (ADR 0054, decisions 1 and 5): the step that posts the
 * manifest to GitHub, and the confirm page GitHub's return lands on. The return `GET` writes
 * nothing: the site admin confirms with a CSRF-protected post. Neither page puts the state or the
 * code anywhere but the form that spends them.
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
  Meta,
  PageHeader,
} from "../ui/components.tsx";

const TRAIL = [
  { label: "System", href: "/admin" },
  { label: "Git", href: "/admin/git" },
  { label: "Connect GitHub" },
];

/** What the site admin chose for the App, shown before and after GitHub. */
export interface GitHubAppChoice {
  name: string;
  /** Organization login, or empty for the admin's own account. */
  organization: string;
  /** API base of a GitHub Enterprise Server, or empty for github.com. */
  apiUrl: string;
  /** Permissions the App asks for, in words. */
  permissions: readonly string[];
}

function ChoiceList(props: {
  choice: GitHubAppChoice;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { choice } = props;
  return (
    <DefinitionList
      items={[
        { label: "Name", value: choice.name },
        { label: "Owner", value: choice.organization || "Your own account" },
        { label: "Host", value: choice.apiUrl || "github.com" },
        { label: "Permissions", value: choice.permissions.join(", ") },
      ]}
    />
  );
}

/** The frame of every step: the shell, the trail and the step's own header. */
function FlowPage(props: {
  title: string;
  description?: string;
  children?: unknown;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  return (
    <DocumentLayout title={props.title} nav={{ active: "admin", trail: TRAIL }}>
      <PageHeader title={props.title} description={props.description} />
      {props.children}
    </DocumentLayout>
  );
}

/** The manifest, ready to post to GitHub's form; a plain form, so it works without a script. */
export function renderGitHubContinuePage(data: {
  formUrl: string;
  manifest: string;
  choice: GitHubAppChoice;
}): RenderedContent {
  return (
    <FlowPage
      title="Continue on GitHub"
      description="GitHub shows the App it is about to create. Create it there, and GitHub brings you back here to confirm."
    >
      <Card>
        <ChoiceList choice={data.choice} />
        <Meta>This step expires in ten minutes.</Meta>
        <form method="post" action={data.formUrl}>
          <input type="hidden" name="manifest" value={data.manifest} />
          <FormActions>
            <Button variant="secondary" href="/admin/git">
              Cancel
            </Button>
            <Button type="submit">Continue on GitHub</Button>
          </FormActions>
        </form>
      </Card>
    </FlowPage>
  );
}

/** GitHub came back with a code: confirm before anything is exchanged or stored. */
export function renderGitHubConfirmPage(data: {
  state: string;
  code: string;
  choice: GitHubAppChoice;
}): RenderedContent {
  return (
    <FlowPage
      title="Confirm the GitHub App"
      description="StoryShelf asks GitHub for the new App's id and private key, stores the key encrypted, and adds the connection."
    >
      <Card>
        <ChoiceList choice={data.choice} />
        <form
          method="post"
          action="/admin/git/github/confirm"
          hx-post="/admin/git/github/confirm"
          hx-target="body"
        >
          {csrfField()}
          <input type="hidden" name="state" value={data.state} />
          <input type="hidden" name="code" value={data.code} />
          <FormActions>
            <Button variant="secondary" href="/admin/git">
              Cancel
            </Button>
            <Button type="submit">Add the connection</Button>
          </FormActions>
        </form>
      </Card>
    </FlowPage>
  );
}

/** Why a return cannot be confirmed: expired, used, another session's, or cancelled on GitHub. */
export function renderGitHubFlowEnded(data: { message: string }): RenderedContent {
  return (
    <FlowPage title="Connect GitHub">
      <Alert tone="warning" title="This setup cannot be finished">
        {data.message}
      </Alert>

      <Button variant="secondary" href="/admin/git/connections/new">
        Start again
      </Button>
    </FlowPage>
  );
}
