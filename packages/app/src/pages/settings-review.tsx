import type { Project } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { csrfField } from "../shell/csrf-field.tsx";
import {
  Alert,
  Button,
  Card,
  CheckField,
  Field,
  FormActions,
  Meta,
  SectionTitle,
} from "../ui/components.tsx";
import type { SettingsFormState } from "./settings-general.tsx";

/** The review switch and the approvals count. */
function ReviewFields(props: {
  project: Project;
  errors: Record<string, string>;
  isAdmin: boolean;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, errors, isAdmin } = props;
  return (
    <>
      <CheckField
        label="Review builds before they are accepted"
        name="reviewEnabled"
        value="true"
        checked={project.reviewEnabled !== false}
        disabled={!isAdmin}
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
    </>
  );
}

/** Review section: the review switch and the approvals a build needs. */
export function renderSettingsReview(
  project: Project,
  formState: SettingsFormState | undefined,
  isAdmin: boolean,
): unknown {
  const errors = formState?.errors ?? {};
  return (
    <div class="grid max-w-form">
      {formState?.globalError ? <Alert tone="danger">{formState.globalError}</Alert> : null}
      <Card>
        <SectionTitle>Review</SectionTitle>
        <Meta>
          Comments on builds and stories, and a build-level verdict from approvers and admins. The
          default branch is never held for review.
        </Meta>
        <form
          method="post"
          action={`/projects/${project.slug}/settings/review`}
          hx-post={`/projects/${project.slug}/settings/review`}
          hx-target="body"
          hx-swap="outerHTML"
        >
          {csrfField()}
          <ReviewFields project={project} errors={errors} isAdmin={isAdmin} />
          {isAdmin ? (
            <FormActions>
              <Button variant="primary" type="submit" icon="check">
                Save review settings
              </Button>
            </FormActions>
          ) : null}
        </form>
      </Card>
    </div>
  );
}
