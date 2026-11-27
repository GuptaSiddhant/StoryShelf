/**
 * System → Git (ADR 0054, decisions 1, 2, 5, 9 and 10): the server's git connections, the
 * repository links waiting for a site admin, and the operator switch. Presentational: the router
 * hands it views that never hold a private key or a token.
 */
import type { HtmlEscapedString } from "hono/utils/html";
import { csrfField } from "../shell/csrf-field.tsx";
import { DocumentLayout, type RenderedContent } from "../shell/document.tsx";
import {
  Alert,
  Badge,
  Button,
  Card,
  CheckField,
  Dialog,
  DialogLink,
  FormActions,
  HStack,
  Meta,
  PageHeader,
  SectionTitle,
  SummaryList,
  type SummaryItem,
  Form,
  formatAbsolute,
} from "../ui/components.tsx";

/** Where a connection's health probe stands. */
export type GitHealthState = "ok" | "warning" | "failed" | "unknown";

/** One connection as site admins see it: never its secret. */
export interface GitConnectionView {
  id: string;
  name: string;
  /** "GitHub App" or "GitLab token". */
  providerLabel: string;
  /** The account, organization, group or host it belongs to. */
  account: string;
  /** What it may post, the ceiling of every link through it (decision 10). */
  posts: readonly string[];
  /** Approved repository links through it. */
  linked: number;
  health: { state: GitHealthState; detail: string };
  /** A GitLab token's expiry (`YYYY-MM-DD`). */
  expiresOn?: string | undefined;
  managed: boolean;
  ignored: boolean;
  /** Where the site admin installs a GitHub App on repositories. */
  installUrl?: string | undefined;
}

/** A link a site admin decides on: `pending`, or `broken` and waiting for a reconnect. */
export interface GitLinkRequestView {
  id: string;
  state: "pending" | "broken";
  /** `owner/repo` on the connection's host. */
  repository: string;
  prefix: string;
  project: { name: string; href: string } | null;
  connectionName: string;
  reason: string | null;
  requestedAt: string;
  /** The row's last change: the approve dialog posts it back, so a link edited meanwhile is refused. */
  updatedAt: string;
}

/** Data of the System → Git page. */
export interface AdminGitData {
  connections: readonly GitConnectionView[];
  requests: readonly GitLinkRequestView[];
  /** The operator switch: project admins may link any repository a connection covers. */
  anyRepository: boolean;
  /** The confirmed public origin; without one, Connect GitHub cannot start. */
  origin: string | null;
}

/** The dialog the request actions open into. */
export const LINK_DIALOG_ID = "git-link";

const HEALTH_TONES = {
  ok: "success",
  warning: "warning",
  failed: "danger",
  unknown: "neutral",
} as const;

/** The badge of a connection: its health, or why it is not used. */
function connectionState(connection: GitConnectionView): SummaryItem["state"] {
  if (connection.ignored) {
    return { label: "Ignored", tone: "warning" };
  }
  const labels = { ok: "Healthy", warning: "Attention", failed: "Failing", unknown: "Unknown" };
  return { label: labels[connection.health.state], tone: HEALTH_TONES[connection.health.state] };
}

/** The token's expiry, unless the health line already names it (a warning within 30 days). */
function expiryNote(connection: GitConnectionView): string {
  const { expiresOn, health } = connection;
  return expiresOn && !health.detail.includes(expiresOn)
    ? `Token expires ${formatAbsolute(expiresOn, "date")}`
    : "";
}

/** The health line names the expiry as an ISO date; show it the way every other date reads. */
function isoDatesAsText(text: string): string {
  return text.replaceAll(/\d{4}-\d{2}-\d{2}/gu, (day) => formatAbsolute(day, "date"));
}

/** One line of facts: provider, account, coverage, health, expiry, what it posts and who manages it. */
function connectionDetails(connection: GitConnectionView): string {
  const parts = [
    `${connection.providerLabel} · ${connection.account}`,
    `${connection.linked} linked ${connection.linked === 1 ? "repository" : "repositories"}`,
    isoDatesAsText(connection.health.detail),
    expiryNote(connection),
    `Posts ${connection.posts.join(", ")}`,
    connection.managed ? "Managed by configuration" : "",
    connection.ignored ? "Configuration declares the same id, so this stored one is not used" : "",
  ];
  return parts.filter((part) => part !== "").join(" · ");
}

/** The Add connection button: primary in the empty state, a small secondary in the title row. */
function addConnection(primary: boolean): unknown {
  return (
    <Button
      variant={primary ? "primary" : "secondary"}
      size={primary ? "md" : "sm"}
      href="/admin/git/connections/new"
    >
      Add connection
    </Button>
  );
}

/** Install and Remove; a configured connection is changed in configuration only. */
function ConnectionActions(props: {
  connection: GitConnectionView;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { connection } = props;
  return (
    <HStack gap="sm" wrap={false}>
      {connection.installUrl ? (
        <Button variant="secondary" size="sm" href={connection.installUrl} rel="noreferrer">
          Install on GitHub
        </Button>
      ) : null}
      {connection.managed ? null : (
        <form
          method="post"
          action={`/admin/git/connections/${connection.id}/remove`}
          hx-post={`/admin/git/connections/${connection.id}/remove`}
          hx-target="body"
          hx-confirm={`Remove ${connection.name}? Links through it stop posting.`}
        >
          {csrfField()}
          <Button type="submit" variant="danger-secondary" size="sm">
            Remove
          </Button>
        </form>
      )}
    </HStack>
  );
}

function ConnectionsCard(props: {
  data: AdminGitData;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const items = props.data.connections.map((connection) => ({
    id: connection.id,
    name: connection.name,
    state: connectionState(connection),
    details: connectionDetails(connection),
    actions: <ConnectionActions connection={connection} />,
  }));
  return (
    <Card>
      <SectionTitle actions={items.length > 0 ? addConnection(false) : null}>
        Connections
      </SectionTitle>
      <Meta>
        One GitHub App or GitLab token serves every project. StoryShelf reads which pull request
        holds a commit, its own comments, the repository's id and whether a commit is on the default
        branch; it never reads code.
      </Meta>
      <SummaryList
        label="Git connections"
        items={items}
        emptyTitle="No git connections"
        emptyDescription="Connect GitHub or GitLab once, and projects can post merge gates and comments."
        add={addConnection(true)}
      />
    </Card>
  );
}

/** Approve (or reconnect) and Refuse, each opening the request dialog. */
function RequestActions(props: {
  request: GitLinkRequestView;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { request } = props;
  return (
    <HStack gap="sm" wrap={false}>
      <DialogLink
        dialogId={LINK_DIALOG_ID}
        href={`/admin/git/links/${request.id}/approve`}
        variant="secondary"
        size="sm"
      >
        {request.state === "broken" ? "Reconnect" : "Review and approve"}
      </DialogLink>
      {request.state === "pending" ? (
        <DialogLink
          dialogId={LINK_DIALOG_ID}
          href={`/admin/git/links/${request.id}/refuse`}
          variant="danger-secondary"
          size="sm"
        >
          Refuse
        </DialogLink>
      ) : null}
    </HStack>
  );
}

function requestDetails(request: GitLinkRequestView): string {
  return [
    request.project ? `For ${request.project.name}` : "Project removed",
    `through ${request.connectionName}`,
    request.prefix ? `prefix ${request.prefix}` : "",
    request.reason ?? "",
  ]
    .filter((part) => part !== "")
    .join(" · ");
}

function RequestsCard(props: {
  requests: readonly GitLinkRequestView[];
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { requests } = props;
  const items = requests.map((request) => ({
    id: request.id,
    name: request.repository,
    state:
      request.state === "broken"
        ? { label: "Broken", tone: "danger" as const }
        : { label: "Pending", tone: "info" as const },
    details: requestDetails(request),
    actions: <RequestActions request={request} />,
  }));
  return (
    <Card>
      <HStack>
        <SectionTitle>Requests</SectionTitle>
        {requests.length > 0 ? <Badge tone="info">{String(requests.length)}</Badge> : null}
      </HStack>
      <Meta>
        A repository link posts nothing until a site admin approves it. Approving checks that the
        connection covers the repository and pins its id.
      </Meta>
      <SummaryList
        label="Repository link requests"
        items={items}
        emptyTitle="No requests"
        emptyDescription="Links that project admins request, and links that broke, appear here."
      />
      <Dialog id={LINK_DIALOG_ID} title="Repository link" />
    </Card>
  );
}

/** The operator switch (decision 2): one checkbox, saved on its own. */
function SwitchCard(props: { on: boolean }): HtmlEscapedString | Promise<HtmlEscapedString> {
  return (
    <Card>
      <SectionTitle>Who may link repositories</SectionTitle>
      <Form
        method="post"
        action="/admin/git/settings"
        hx-post="/admin/git/settings"
        hx-target="body"
      >
        {csrfField()}
        <CheckField
          name="anyRepository"
          label="Project admins may link any repository a connection covers"
          checked={props.on}
          hint="On: a link a project admin asks for is approved at once when the connection covers it. Off: a site admin approves each one. Turning it off keeps existing links."
        />

        <FormActions>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </FormActions>
      </Form>
    </Card>
  );
}

/** Without a confirmed public origin, GitHub has nowhere to return to. */
function OriginNotice(props: {
  origin: string | null;
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  return props.origin === null ? (
    <Alert tone="warning" title="Connect GitHub needs a public origin">
      GitHub returns to this server's public address, and none is confirmed yet. Confirm it on the{" "}
      <a href="/admin">System page</a>, or set <code>SHELF_PUBLIC_BASE_URL</code>. An existing App
      and a GitLab token can still be added.
    </Alert>
  ) : null;
}

/** Site-admin System → Git page. */
export function renderAdminGitPage(data: AdminGitData): RenderedContent {
  return (
    <DocumentLayout
      title="Git"
      nav={{ active: "admin", trail: [{ label: "System", href: "/admin" }, { label: "Git" }] }}
    >
      <PageHeader
        title="Git"
        description="Connect GitHub or GitLab once for the server, and decide which repositories projects post to."
      />
      <OriginNotice origin={data.origin} />
      <ConnectionsCard data={data} />

      <RequestsCard requests={data.requests} />

      <SwitchCard on={data.anyRepository} />
    </DocumentLayout>
  );
}
