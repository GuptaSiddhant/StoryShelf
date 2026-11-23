import type { Project } from "@storyshelf/core/schema";
import type { FC } from "hono/jsx";
import { Alert, CheckField, Field } from "../ui/components.tsx";
import { DialogForm } from "./dialog-form.tsx";

/** Dialog ids of the general and review forms. */
export const EDIT_GENERAL_DIALOG = "edit-general";
export const EDIT_REVIEW_DIALOG = "edit-review";

interface FormProps {
  project: Project;
  standalone: boolean;
  error?: string | undefined;
  errors?: Record<string, string> | undefined;
}

/** The project metadata form: name, repository, default branch and public branches. */
export const EditGeneralForm: FC<FormProps> = ({ project, standalone, error, errors = {} }) => {
  return (
    <DialogForm
      dialog={EDIT_GENERAL_DIALOG}
      action={`/projects/${project.slug}/settings`}
      submitLabel="Save changes"
      standalone={standalone}
      backHref={`/projects/${project.slug}/settings/general`}
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
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
    </DialogForm>
  );
};

/** The review switch and the approvals a build needs. */
export const EditReviewForm: FC<FormProps> = ({ project, standalone, error, errors = {} }) => {
  return (
    <DialogForm
      dialog={EDIT_REVIEW_DIALOG}
      action={`/projects/${project.slug}/settings/review`}
      submitLabel="Save review settings"
      standalone={standalone}
      backHref={`/projects/${project.slug}/settings/review`}
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <CheckField
        label="Review builds before they are accepted"
        name="reviewEnabled"
        value="true"
        checked={project.reviewEnabled !== false}
        hint="With review off, comments and verdicts are hidden, not deleted, and the project's builds waiting for a verdict are accepted when you save."
      />
      <Field
        label="Approvals required"
        name="reviewApprovals"
        type="number"
        step="1"
        min="1"
        max="20"
        value={String(project.reviewApprovals ?? 1)}
        error={errors["reviewApprovals"]}
        hint="Approvals a build needs when screenshots are not captured. A rejection always rejects the build."
      />
    </DialogForm>
  );
};
