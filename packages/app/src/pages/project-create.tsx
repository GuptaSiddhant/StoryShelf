import { csrfField } from "../shell/csrf-field.tsx";
import type { RenderedContent } from "../shell/document.tsx";
import { FormPage } from "../shell/form-page.tsx";
import { Alert, Button, Field, HStack } from "../ui/components.tsx";

/** Form state for the project creation page (values and validation errors). */
export interface ProjectCreateFormState {
  values?: { name?: string; gitRepository?: string; gitDefaultBranch?: string };
  errors?: Record<string, string>;
  globalError?: string;
}

/** Submit and cancel buttons of the creation form. */
function ProjectCreateActions(): ReturnType<typeof HStack> {
  return (
    <HStack>
      <Button variant="primary" type="submit">
        Create project
      </Button>
      <Button variant="secondary" href="/projects">
        Cancel
      </Button>
    </HStack>
  );
}

/** The creation form: name, git repository, default branch. */
function ProjectCreateForm(props: {
  values: NonNullable<ProjectCreateFormState["values"]>;
  errors: Record<string, string>;
}): ReturnType<typeof HStack> {
  const { values, errors } = props;
  return (
    <form
      method="post"
      action="/projects/new"
      hx-post="/projects/new"
      hx-target="body"
      hx-swap="outerHTML"
      novalidate
    >
      {csrfField()}
      <Field
        label="Name"
        name="name"
        required
        autofocus
        value={values.name ?? ""}
        placeholder="Design System"
        error={errors["name"]}
        hint="Human readable name. A URL-friendly slug is generated automatically."
        autocomplete="off"
      />

      <Field
        label="Git repository"
        name="gitRepository"
        value={values.gitRepository ?? ""}
        placeholder="acme/design-system"
        error={errors["gitRepository"]}
        hint="Optional owner/repo for status checks and links."
      />

      <Field
        label="Default branch"
        name="gitDefaultBranch"
        value={values.gitDefaultBranch ?? "main"}
        placeholder="main"
        hint="Baselines fall back to this branch when no branch-specific baseline exists."
      />

      <ProjectCreateActions />
    </form>
  );
}

/** New-project form page (one project corresponds to one Storybook). */
export function renderProjectCreatePage(state: ProjectCreateFormState = {}): RenderedContent {
  const values = state.values ?? {};
  const errors = state.errors ?? {};
  return (
    <FormPage
      title="Create project"
      description="A project corresponds to one Storybook. You can have multiple projects per repository."
      nav={{ active: "projects", trail: [{ label: "Create project" }] }}
      notice={
        state.globalError ? (
          <Alert tone="danger" title="Could not create project">
            {state.globalError}
          </Alert>
        ) : null
      }
    >
      <ProjectCreateForm values={values} errors={errors} />
    </FormPage>
  );
}
