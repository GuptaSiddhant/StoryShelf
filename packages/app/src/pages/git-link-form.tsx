/**
 * The repository-link form (ADR 0054, decisions 2 and 10): opened in the dialog from the Git
 * section, or on a page of its own for a pasted link or a browser without script.
 */
import type { StateOutputs } from "@storyshelf/core/adapter/notifier";
import type { Project } from "@storyshelf/core/schema";
import { createUrlBuilder } from "@storyshelf/core/urls";
import type { HtmlEscapedString } from "hono/utils/html";
import { csrfField } from "../shell/csrf-field.tsx";
import { DocumentLayout, type RenderedContent } from "../shell/document.tsx";
import {
  Alert,
  Button,
  Card,
  CheckField,
  Field,
  FormActions,
  OptionFields,
  SectionTitle,
  SelectField,
  Form,
} from "../ui/components.tsx";
import type { GitLinkFormState, RepositoryPicker, SettingsGitData } from "./settings-git.tsx";
import type { SettingsGitLink } from "./settings-git.tsx";

const COMMENT_MODES = [
  { value: "always", label: "Always" },
  { value: "on-changes", label: "Only when stories changed" },
  { value: "off", label: "Never" },
];

/** What a link posts besides the gate; options above the connection's ceiling are unavailable. */
export function OutputFields(props: {
  outputs: StateOutputs;
  commentAllowed: boolean;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { outputs, commentAllowed } = props;
  return (
    <>
      <CheckField
        label="Storybook status"
        name="storybook"
        checked={outputs.storybook}
        hint="Posts the Storybook link as its own status."
      />
      <SelectField
        label="Pull-request comment"
        name="comment"
        value={commentAllowed ? outputs.comment : "off"}
        options={commentAllowed ? COMMENT_MODES : [{ value: "off", label: "Never" }]}
        disabled={!commentAllowed}
        hint={
          commentAllowed
            ? undefined
            : "Unavailable: this connection may not write pull-request comments. A site admin can allow it."
        }
      />
      <CheckField
        label="Annotations"
        name="annotations"
        checked={outputs.annotations}
        hint="Lists each changed snapshot on the check run."
      />
    </>
  );
}

type FormProps = {
  project: Project;
  data: SettingsGitData;
  link?: SettingsGitLink | undefined;
  state?: GitLinkFormState | undefined;
};

type Rendered = HtmlEscapedString | Promise<HtmlEscapedString>;

/** The typed-URL field: the only way to name a repository while the operator switch is off. */
function RepositoryField(props: FormProps): Rendered {
  const { link, state } = props;
  return (
    <Field
      label="Repository"
      name="repository"
      required
      placeholder="https://github.com/acme/widgets"
      value={state?.values?.repository ?? (link ? link.url : "")}
      error={state?.errors?.["repository"]}
      hint="The repository's URL or owner/name."
    />
  );
}

/** Pick from the covered repositories, or type a URL. A cut-short list says so. */
function PickerFields(
  props: FormProps & { picker: Extract<RepositoryPicker, { listed: true }> },
): Rendered {
  const { picker, link, state } = props;
  const choosing =
    picker.repositories.length > 0 && !link && state?.values?.repository === undefined;
  return (
    <OptionFields
      name="source"
      label="Repository"
      selected={choosing ? "pick" : "type"}
      options={[
        {
          value: "pick",
          label: "Choose from the list",
          children: (
            <SelectField
              label="Covered repository"
              name="picked"
              options={picker.repositories.map(({ url, label }) => ({ value: url, label }))}
              hint={
                picker.truncated
                  ? "This list was cut short. Type the URL for a repository that is not here."
                  : undefined
              }
            />
          ),
        },
        { value: "type", label: "Type a URL", children: <RepositoryField {...props} /> },
      ]}
    />
  );
}

/** Repository and prefix, then (for an existing link) its outputs and the approval notice. */
function LinkFields(props: FormProps): Rendered {
  const { data, link, state } = props;
  const errors = state?.errors ?? {};
  const picker = data.picker?.listed === true ? data.picker : undefined;
  return (
    <>
      {data.picker?.listed === false ? (
        <Alert tone="info" role="none">
          The repositories this server covers could not be listed. Type the repository's URL.
        </Alert>
      ) : null}
      {picker ? <PickerFields {...props} picker={picker} /> : <RepositoryField {...props} />}
      <Field
        label="Status prefix"
        name="prefix"
        value={state?.values?.prefix ?? link?.prefix ?? data.proposedPrefix}
        error={errors["prefix"]}
        hint="Checks are named <prefix>/testing. Projects sharing a repository need their own prefix."
      />
      {link ? (
        <>
          <OutputFields outputs={link.outputs} commentAllowed={link.commentAllowed} />
          <Alert tone="warning" role="none">
            Changing the repository or prefix sends the link back to a site admin for approval.
          </Alert>
        </>
      ) : null}
    </>
  );
}

/**
 * The link form, shared by the dialog and its page: repository and prefix; with `link` it also
 * carries the outputs. A project admin is never told whether a repository exists or is covered.
 */
export function GitLinkForm(props: FormProps & { inDialog?: boolean }): Rendered {
  const { project, link, inDialog = false } = props;
  const base = createUrlBuilder("/").settingsTab(project.slug, "git");
  const action = link ? `${base}/${link.id}` : base;
  return (
    <Form
      id="git-link-form"
      method="post"
      action={action}
      {...(inDialog
        ? { "hx-post": action, "hx-target": "#git-dialog-body", "hx-swap": "innerHTML" }
        : {})}
    >
      {csrfField()}
      <LinkFields {...props} />
      <FormActions>
        <Button type="submit">{link ? "Save" : "Request link"}</Button>
      </FormActions>
    </Form>
  );
}

/** The form on a page of its own: what a pasted link, or a browser without script, opens. */
export function renderGitLinkPage(props: FormProps): RenderedContent {
  const { project } = props;
  return (
    <DocumentLayout
      title={`${project.name} · Repository link`}
      nav={{
        active: "settings",
        projectSlug: project.slug,
        projectName: project.name,
        trail: [
          {
            label: "Review & notifications",
            href: `/projects/${project.slug}/settings/review#git`,
          },
          { label: props.link ? "Edit link" : "Link a repository" },
        ],
      }}
    >
      <Card>
        <SectionTitle>{props.link ? "Edit repository link" : "Link a repository"}</SectionTitle>
        <GitLinkForm {...props} />
      </Card>
    </DocumentLayout>
  );
}

/** The dialog body: the form alone (HTMX swaps it in). */
export function renderGitLinkFragment(props: FormProps): Rendered {
  return <GitLinkForm {...props} inDialog />;
}
