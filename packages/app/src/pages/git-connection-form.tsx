/**
 * System → Git → Add connection (ADR 0054, decision 1): the three ways to add a server-wide git
 * connection, as one `OptionFields` form on its own page (Connect GitHub leaves the app, ADR 0012
 * decision 10). Field names are unique per option, so no two inputs share an id.
 */
import type { HtmlEscapedString } from "hono/utils/html";
import { csrfField } from "../shell/csrf-field.tsx";
import type { RenderedContent } from "../shell/document.tsx";
import { FormPage } from "../shell/form-page.tsx";
import {
  Alert,
  Button,
  CheckField,
  Field,
  FormActions,
  Meta,
  OptionFields,
  TextareaField,
  VStack,
} from "../ui/components.tsx";

/** The options of the form, in order. */
export const CONNECTION_KINDS = ["github-manifest", "github-app", "gitlab-token"] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

/** What the form shows: the chosen option, typed values (never a key or token) and errors. */
export interface GitConnectionFormData {
  kind: ConnectionKind;
  values: Readonly<Record<string, string>>;
  /** Field name → message; `form` for a message about the whole form. */
  errors: Readonly<Record<string, string>>;
  /** The confirmed public origin; Connect GitHub refuses to start without it. */
  origin: string | null;
  /** GitLab's prefilled form for a group access token, once a host and group are known. */
  gitlabTokenUrl?: string | undefined;
}

type FieldProps = { data: GitConnectionFormData };

const value = (data: GitConnectionFormData, name: string, fallback = ""): string =>
  data.values[name] ?? fallback;

/** A checkbox that keeps its state on a re-render; unchecked boxes are not posted. */
const checked = (data: GitConnectionFormData, name: string, fallback: boolean): boolean =>
  data.values[name] === undefined ? fallback : data.values[name] === "on";

/** The optional permissions of a GitHub App: the comment and plain statuses (decision 10). */
function PostChecks(props: {
  data: GitConnectionFormData;
  prefix: "gh" | "app";
  labels: { comment: string; statuses: string };
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { data, prefix, labels } = props;
  return (
    <>
      <CheckField
        name={`${prefix}_comment`}
        id={`${prefix}_comment`}
        label={labels.comment}
        checked={checked(data, `${prefix}_comment`, true)}
      />
      <CheckField
        name={`${prefix}_statuses`}
        id={`${prefix}_statuses`}
        label={labels.statuses}
        checked={checked(data, `${prefix}_statuses`, false)}
      />
    </>
  );
}

/** What Connect GitHub does, or why it cannot start. */
function ManifestIntro(props: FieldProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  return props.data.origin === null ? (
    <Alert tone="warning" title="No public origin">
      GitHub returns to this server's public address. Confirm it on the System page first.
    </Alert>
  ) : (
    <Meta>
      GitHub creates a private App with Checks write and Contents read (compare only), returns here,
      and you confirm. Nobody copies a key. Then install the App on the repositories you choose.
    </Meta>
  );
}

function ManifestFields(props: FieldProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { data } = props;
  return (
    <>
      <VStack>
        <ManifestIntro data={data} />
        <Field
          label="App name"
          name="gh_name"
          value={value(data, "gh_name", "StoryShelf")}
          error={data.errors["gh_name"]}
          hint="Unique on GitHub; GitHub asks for another one if it is taken."
        />
      </VStack>
      <Field
        label="Organization"
        name="gh_org"
        value={value(data, "gh_org")}
        error={data.errors["gh_org"]}
        hint="Leave empty to create the App on your own account."
      />
      <Field
        label="GitHub Enterprise Server API URL"
        name="gh_api"
        type="url"
        value={value(data, "gh_api")}
        error={data.errors["gh_api"]}
        placeholder="https://ghes.example.com/api/v3"
        hint="Leave empty for github.com."
      />
      <PostChecks
        data={data}
        prefix="gh"
        labels={{
          comment: "Pull requests: write, for the pull-request comment",
          statuses: "Commit statuses: write, to post plain statuses instead of check runs",
        }}
      />
    </>
  );
}

function ExistingAppFields(props: FieldProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { data } = props;
  return (
    <>
      <Meta>
        For an App you manage yourself. It needs Checks write and Contents read; tick what else it
        was granted.
      </Meta>
      <Field
        label="Name"
        name="app_name"
        value={value(data, "app_name", "GitHub App")}
        error={data.errors["app_name"]}
      />
      <Field
        label="App ID"
        name="app_id"
        value={value(data, "app_id")}
        error={data.errors["app_id"]}
        pattern="[0-9]+"
        required
      />
      <TextareaField
        label="Private key"
        name="app_key"
        rows={6}
        monospace
        error={data.errors["app_key"]}
        hint="The PEM file GitHub generated. It is stored encrypted and never shown again."
        placeholder="-----BEGIN RSA PRIVATE KEY-----"
      />
      <Field
        label="GitHub Enterprise Server API URL"
        name="app_api"
        type="url"
        value={value(data, "app_api")}
        error={data.errors["app_api"]}
        hint="Leave empty for github.com."
      />
      <PostChecks
        data={data}
        prefix="app"
        labels={{
          comment: "The App has Pull requests: write (the comment)",
          statuses: "The App has Commit statuses: write (plain statuses)",
        }}
      />
    </>
  );
}

/** GitLab's own form, prefilled with the name and the `api` scope, or how to find it. */
function GitLabTokenLink(props: FieldProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const url = props.data.gitlabTokenUrl;
  return url ? (
    <Meta>
      <a href={url} target="_blank" rel="noreferrer">
        Create the token on GitLab
      </a>{" "}
      (a group access token named StoryShelf with the <code>api</code> scope), then paste it below.
    </Meta>
  ) : (
    <Meta>
      Enter the group, then Prepare GitLab's form for a prefilled link. Use a group or project
      access token with the <code>api</code> scope, never a personal token.
    </Meta>
  );
}

/** Where the token is for, and GitLab's prefilled form for it. */
function GitLabTarget(props: FieldProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { data } = props;
  return (
    <>
      <Field
        label="GitLab URL"
        name="gl_host"
        type="url"
        value={value(data, "gl_host", "https://gitlab.com")}
        error={data.errors["gl_host"]}
      />
      <Field
        label="Group"
        name="gl_group"
        value={value(data, "gl_group")}
        error={data.errors["gl_group"]}
        placeholder="acme/web"
      />
      <VStack gap="sm" align="start">
        <Button type="submit" variant="secondary" size="sm" name="intent" value="prepare">
          Prepare GitLab's form
        </Button>
        <GitLabTokenLink data={data} />
      </VStack>
    </>
  );
}

function GitLabFields(props: FieldProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { data } = props;
  return (
    <>
      <GitLabTarget data={data} />
      <Field label="Name" name="gl_name" value={value(data, "gl_name", "GitLab")} />
      <Field
        label="Token"
        name="gl_token"
        type="password"
        autocomplete="off"
        error={data.errors["gl_token"]}
        hint="Stored encrypted and never shown again."
      />
      <Field
        label="Expires on"
        name="gl_expires"
        type="date"
        value={value(data, "gl_expires")}
        error={data.errors["gl_expires"]}
        hint="Site admins are warned 30 days before."
      />
      <CheckField
        name="gl_comment"
        id="gl_comment"
        label="Allow the merge-request comment"
        checked={checked(data, "gl_comment", true)}
        hint="The api scope allows everything, so the ceiling for comments is set here."
      />
    </>
  );
}

/** The form: one option per way to connect, then Continue. */
function ConnectionForm(props: FieldProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { data } = props;
  return (
    <form
      method="post"
      action="/admin/git/connections"
      hx-post="/admin/git/connections"
      hx-target="body"
    >
      {csrfField()}
      <OptionFields
        name="kind"
        label="How to connect"
        variant="cards"
        selected={data.kind}
        options={[
          {
            value: "github-manifest",
            label: "Connect GitHub",
            children: <ManifestFields data={data} />,
          },
          {
            value: "github-app",
            label: "Existing GitHub App",
            children: <ExistingAppFields data={data} />,
          },
          {
            value: "gitlab-token",
            label: "GitLab token",
            children: <GitLabFields data={data} />,
          },
        ]}
      />
      <FormActions>
        <Button type="submit" name="intent" value="save">
          Continue
        </Button>
        <Button variant="secondary" href="/admin/git">
          Cancel
        </Button>
      </FormActions>
    </form>
  );
}

/** The add-connection page; a failed post re-renders it with the errors (422). */
export function renderGitConnectionForm(data: GitConnectionFormData): RenderedContent {
  return (
    <FormPage
      title="Add a git connection"
      description="One connection serves every project the server links to its repositories."
      nav={{
        active: "admin",
        trail: [
          { label: "System", href: "/admin" },
          { label: "Git", href: "/admin/git" },
          { label: "Add connection" },
        ],
      }}
      notice={
        data.errors["form"] ? (
          <Alert tone="danger" role="alert">
            {data.errors["form"]}
          </Alert>
        ) : null
      }
    >
      <ConnectionForm data={data} />
    </FormPage>
  );
}
