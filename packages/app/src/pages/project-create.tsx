import { Alert, Button, Card, Field, HStack, PageHeader } from "../ui/components.tsx";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";

/** Form state for the project creation page (values and validation errors). */
export interface ProjectCreateFormState {
  values?: { name?: string; gitRepository?: string; gitDefaultBranch?: string };
  errors?: Record<string, string>;
  globalError?: string;
}

/** New-project form page (one project corresponds to one Storybook). */
export function renderProjectCreatePage(state: ProjectCreateFormState = {}): RenderedContent {
  const values = state.values ?? {};
  const errors = state.errors ?? {};
  return (
    <DocumentLayout title="New project" nav={{ active: "projects" }}>
      <PageHeader
        title="Create project"
        description="A project corresponds to one Storybook. You can have multiple projects per repository."
        breadcrumbs={[{ label: "Projects", href: "/projects" }, { label: "New project" }]}
      />

      {state.globalError ? (
        <Alert tone="danger" title="Could not create project">
          {state.globalError}
        </Alert>
      ) : null}

      <div class="max-w-prose">
        <Card>
          <form
            method="post"
            action="/projects/new"
            hx-post="/projects/new"
            hx-target="body"
            hx-swap="outerHTML"
            novalidate
          >
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

            <div class="mt-1">
              <HStack>
                <Button variant="primary" type="submit">
                  Create project
                </Button>
                <Button variant="secondary" href="/projects">
                  Cancel
                </Button>
              </HStack>
            </div>
          </form>
        </Card>
      </div>
    </DocumentLayout>
  );
}
