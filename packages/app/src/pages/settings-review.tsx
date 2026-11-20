import type { Project } from "@storyshelf/core/schema";
import {
  Alert,
  DialogLink,
  Meta,
  SectionTitle,
  SummaryList,
  VStack,
  type SummaryItem,
} from "../ui/components.tsx";
import { FormDialog } from "./dialog-form.tsx";
import { EDIT_REVIEW_DIALOG } from "./project-forms.tsx";
import type { SettingsFormState } from "./settings-general.tsx";

function reviewItems(project: Project, isAdmin: boolean): SummaryItem[] {
  const on = project.reviewEnabled !== false;
  const approvals = project.reviewApprovals ?? 1;
  return [
    {
      id: "review",
      name: "Review",
      state: on ? { label: "On", tone: "success" } : { label: "Off", tone: "neutral" },
      details: on
        ? `${approvals} approval${approvals === 1 ? "" : "s"} required when screenshots are not captured`
        : "Builds are accepted without a verdict",
      actions: isAdmin ? (
        <DialogLink
          dialogId={EDIT_REVIEW_DIALOG}
          href={`/projects/${project.slug}/settings/review/edit`}
          variant="secondary"
          size="sm"
        >
          Edit
        </DialogLink>
      ) : undefined,
    },
  ];
}

/** Review section: the review switch and the approvals a build needs, as a summary. */
export function renderSettingsReview(
  project: Project,
  formState: SettingsFormState | undefined,
  isAdmin: boolean,
): unknown {
  return (
    <VStack>
      {formState?.globalError ? <Alert tone="danger">{formState.globalError}</Alert> : null}
      <SectionTitle>Review</SectionTitle>
      <Meta>
        Comments on builds and stories, and a build-level verdict from approvers and admins. The
        default branch is never held for review.
      </Meta>
      <SummaryList label="Review" items={reviewItems(project, isAdmin)} emptyTitle="No review" />
      {isAdmin ? (
        <FormDialog id={EDIT_REVIEW_DIALOG} title="Edit review" submitLabel="Save review settings" />
      ) : null}
    </VStack>
  );
}
