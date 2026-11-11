import { isCaptureTarget, type RunnerTarget } from "@storyshelf/core/adapter/capture-runner";
import type { Project } from "@storyshelf/core/schema";
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
  SelectField,
} from "../ui/components.tsx";
import { targetChoices } from "./target-choices.ts";

/** Form state for the settings tabs (field errors and global error). */
export interface SettingsFormState {
  errors?: Record<string, string>;
  globalError?: string;
}

type Rendered = ReturnType<typeof Card>;

/** Pixel threshold and max diff ratio. */
function ThresholdFields(props: { project: Project }): Rendered {
  const { project } = props;
  return (
    <div class="grid grid--2">
      <Field
        label="Pixel threshold"
        name="pixelThreshold"
        type="number"
        step="0.01"
        min="0"
        max="1"
        value={String(project.pixelThreshold)}
        hint="Per-pixel color distance 0–1"
      />
      <Field
        label="Max diff ratio"
        name="maxDiffRatio"
        type="number"
        step="0.001"
        min="0"
        max="1"
        value={String(project.maxDiffRatio)}
        hint="Allowed diff ratio 0–1"
      />
    </div>
  );
}

/** Capture browser select; disabled for non-admins. */
function CaptureBrowserField(props: {
  browser: string;
  isAdmin: boolean;
  targets: ReturnType<typeof targetChoices>;
}): Rendered {
  const { browser, isAdmin, targets } = props;
  return (
    <SelectField
      label="Capture browser"
      name="browser"
      value={browser}
      disabled={!isAdmin}
      options={targets.choices}
      hint={`Where captures render. Baselines are kept per target, so switching starts a fresh baseline for the new one.${
        targets.unavailable.length > 0
          ? ` Not selectable on this server: ${targets.unavailable.join("; ")}.`
          : ""
      }`}
    />
  );
}

/** Project metadata, diff thresholds and capture browser. */
function GeneralCard(props: {
  project: Project;
  errors: Record<string, string>;
  isAdmin: boolean;
  targets: ReturnType<typeof targetChoices>;
}): Rendered {
  const { project, errors, isAdmin, targets } = props;
  const browser = project.browser ?? "chromium";
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
        <ThresholdFields project={project} />
        <CaptureBrowserField browser={browser} isAdmin={isAdmin} targets={targets} />
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

/** Approvals-required number field of the review card. */
function ApprovalsField(props: { value: number; error?: string }): Rendered {
  return (
    <Field
      label="Approvals required"
      name="reviewApprovals"
      type="number"
      step="1"
      min="1"
      max="20"
      value={String(props.value)}
      error={props.error}
      hint="Approvals a build needs when screenshots are not captured. A rejection always rejects the build."
    />
  );
}

/** Review switch and approvals required. */
function ReviewCard(props: {
  project: Project;
  errors: Record<string, string>;
  isAdmin: boolean;
}): Rendered {
  const { project, errors, isAdmin } = props;
  return (
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
        <CheckField
          label="Review builds before they are accepted"
          name="reviewEnabled"
          value="true"
          checked={project.reviewEnabled !== false}
          disabled={!isAdmin}
          hint="With review off, comments and verdicts are hidden, not deleted, and the project's builds waiting for a verdict are accepted when you save."
        />
        <ApprovalsField value={project.reviewApprovals ?? 1} error={errors["reviewApprovals"]} />
        {isAdmin ? (
          <FormActions>
            <Button variant="primary" type="submit" icon="check">
              Save review settings
            </Button>
          </FormActions>
        ) : null}
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

/** General settings tab: project metadata, diff thresholds, and danger zone. */
export function renderSettingsGeneral(
  project: Project,
  formState: SettingsFormState | undefined,
  isAdmin: boolean,
  /** What the runner offers; omitted when it publishes no list. */
  offered?: readonly RunnerTarget[],
): unknown {
  const errors = formState?.errors ?? {};
  const browser = project.browser ?? "chromium";
  const targets = targetChoices(offered, isCaptureTarget(browser) ? [browser] : []);
  return (
    <div class="grid max-w-form">
      {formState?.globalError ? <Alert tone="danger">{formState.globalError}</Alert> : null}
      <GeneralCard project={project} errors={errors} isAdmin={isAdmin} targets={targets} />
      <ReviewCard project={project} errors={errors} isAdmin={isAdmin} />
      {isAdmin ? <DangerZoneCard project={project} /> : null}
    </div>
  );
}
