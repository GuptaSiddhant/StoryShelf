import type { Project } from "@storyshelf/core/schema";
import { csrfField } from "../shell/csrf-field.tsx";
import { Alert, Button, Card, Field, FormActions, Meta, SectionTitle } from "../ui/components.tsx";

/** Form state for the settings tabs (field errors and global error). */
export interface SettingsFormState {
  errors?: Record<string, string>;
  globalError?: string;
}

type Rendered = ReturnType<typeof Card>;

/** Project metadata form. */
function GeneralCard(props: {
  project: Project;
  errors: Record<string, string>;
  isAdmin: boolean;
}): Rendered {
  const { project, errors, isAdmin } = props;
  return (
    <Card>
      <SectionTitle>General</SectionTitle>
      <form
        method="post"
        action={`/projects/${project.slug}/settings`}
        hx-post={`/projects/${project.slug}/settings`}
        hx-target="body"
        hx-swap="outerHTML"
      >
        {csrfField()}
        <Field label="Name" name="name" value={project.name} error={errors["name"]} />
        <Field
          label="Git repository"
          name="gitRepository"
          value={project.gitRepository ?? ""}
          placeholder="owner/repo"
        />
        <Field label="Default branch" name="gitDefaultBranch" value={project.gitDefaultBranch} />
        <Field
          label="Public branch regex"
          name="publicBranchRegex"
          value={project.publicBranchRegex ?? ""}
          placeholder="^main$"
          hint="Branches matching this regex are publicly viewable."
        />
        {isAdmin ? (
          <FormActions>
            <Button variant="primary" type="submit" icon="check">
              Save changes
            </Button>
          </FormActions>
        ) : (
          <Meta>You need admin access to edit settings.</Meta>
        )}
      </form>
    </Card>
  );
}

/** Project deletion (admins only). */
function DangerZoneCard(props: { project: Project }): Rendered {
  const { project } = props;
  return (
    <Card tone="danger">
      <SectionTitle level={3} tone="danger">
        Danger zone
      </SectionTitle>
      <Meta>
        Deleting a project removes all builds, snapshots, baselines and tokens. This cannot be
        undone.
      </Meta>
      <form
        method="post"
        action={`/projects/${project.slug}/delete`}
        hx-post={`/projects/${project.slug}/delete`}
        hx-target="body"
        hx-confirm="Delete this project? This cannot be undone."
      >
        <Button variant="danger" type="submit">
          Delete project
        </Button>
      </form>
    </Card>
  );
}

/** General settings tab: project metadata and the danger zone. */
export function renderSettingsGeneral(
  project: Project,
  formState: SettingsFormState | undefined,
  isAdmin: boolean,
): unknown {
  const errors = formState?.errors ?? {};
  return (
    <div class="grid max-w-form">
      {formState?.globalError ? <Alert tone="danger">{formState.globalError}</Alert> : null}
      <GeneralCard project={project} errors={errors} isAdmin={isAdmin} />
      {isAdmin ? <DangerZoneCard project={project} /> : null}
    </div>
  );
}
