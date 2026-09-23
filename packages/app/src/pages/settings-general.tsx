import type { Project } from "@storyshelf/core/schema";
import { Alert, Button, Field, Meta, SelectField } from "../ui/components.tsx";
import { csrfField } from "../ui/csrf-field.tsx";

/** Form state for the settings tabs (field errors and global error). */
export interface SettingsFormState {
  errors?: Record<string, string>;
  globalError?: string;
}

/** General settings tab: project metadata, diff thresholds, and danger zone. */
export function renderSettingsGeneral(
  project: Project,
  formState: SettingsFormState | undefined,
  isAdmin: boolean,
): unknown {
  const errors = formState?.errors ?? {};
  const browser = project.browser ?? "chromium";
  return (
    <div class="grid max-w-form">
      {formState?.globalError ? <Alert tone="danger">{formState.globalError}</Alert> : null}
      <div class="card card--padded">
        <h2 style="margin:0 0 .5rem;">General</h2>
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
          <SelectField
            label="Capture browser"
            name="browser"
            value={browser}
            disabled={!isAdmin}
            options={[
              { value: "chromium", label: "Chromium (default)" },
              { value: "firefox", label: "Firefox" },
              { value: "webkit", label: "WebKit (Safari engine)" },
              { value: "chrome", label: "Chrome (Chromium engine)" },
            ]}
            hint="Rendering engine for captures. Baselines track the browser, so switching starts a fresh baseline. Firefox and WebKit need Playwright system dependencies installed on the server."
          />
          <Field
            label="Public branch regex"
            name="publicBranchRegex"
            value={project.publicBranchRegex ?? ""}
            placeholder="^main$"
            hint="Branches matching this regex are publicly viewable."
          />
          {isAdmin ? (
            <Button variant="primary" type="submit">
              Save changes
            </Button>
          ) : (
            <Meta>You need admin access to edit settings.</Meta>
          )}
        </form>
      </div>

      {isAdmin ? (
        <div class="card card--padded" style="border-color: var(--status-rejected);">
          <h3 style="margin:0 0 .4rem; color: var(--status-rejected);">Danger zone</h3>
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
        </div>
      ) : null}
    </div>
  );
}
