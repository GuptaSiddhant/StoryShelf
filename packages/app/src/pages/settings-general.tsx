import type { Project } from "@storyshelf/core/schema";
import { csrfField } from "../shell/csrf-field.tsx";
import {
  Alert,
  Button,
  Card,
  DialogLink,
  Meta,
  SectionTitle,
  SummaryList,
  VStack,
  type SummaryItem,
} from "../ui/components.tsx";
import { FormDialog } from "./dialog-form.tsx";
import { EDIT_GENERAL_DIALOG } from "./project-forms.tsx";

/** Form state for the settings tabs (field errors and global error). */
export interface SettingsFormState {
  errors?: Record<string, string>;
  globalError?: string;
}

type Rendered = ReturnType<typeof Card>;

/** What the project is called and where it lives, as one line. */
function generalDetails(project: Project): string {
  const parts = [
    project.gitRepository ? `Repository ${project.gitRepository}` : "No git repository",
    `Default branch ${project.gitDefaultBranch}`,
  ];
  if (project.publicBranchRegex) {
    parts.push(`Public branches ${project.publicBranchRegex}`);
  }
  return parts.join(" · ");
}

function generalItems(project: Project, isAdmin: boolean): SummaryItem[] {
  return [
    {
      id: project.id,
      name: project.name,
      details: generalDetails(project),
      actions: isAdmin ? (
        <DialogLink
          dialogId={EDIT_GENERAL_DIALOG}
          href={`/projects/${project.slug}/settings/general/edit`}
          variant="secondary"
          size="sm"
        >
          Edit
        </DialogLink>
      ) : undefined,
    },
  ];
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
        {csrfField()}
        <Button variant="danger" type="submit">
          Delete project
        </Button>
      </form>
    </Card>
  );
}

/** General settings tab: the project as a summary (Edit opens a dialog) and the danger zone. */
export function renderSettingsGeneral(
  project: Project,
  formState: SettingsFormState | undefined,
  isAdmin: boolean,
): unknown {
  return (
    <VStack>
      {formState?.globalError ? <Alert tone="danger">{formState.globalError}</Alert> : null}
      <SectionTitle>General</SectionTitle>
      <SummaryList label="General" items={generalItems(project, isAdmin)} emptyTitle="No project" />
      {isAdmin ? (
        <>
          <FormDialog id={EDIT_GENERAL_DIALOG} title="Edit project" submitLabel="Save changes" />
          <DangerZoneCard project={project} />
        </>
      ) : (
        <Meta>You need admin access to edit settings.</Meta>
      )}
    </VStack>
  );
}
