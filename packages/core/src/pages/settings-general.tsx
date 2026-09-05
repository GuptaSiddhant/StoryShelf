import type { Project } from "../schema/project.ts";

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
  return (
    <div class="grid" style="max-width: 720px;">
      {formState?.globalError ? (
        <div class="alert alert--danger" role="alert">
          {formState.globalError}
        </div>
      ) : null}
      <div class="card card--padded">
        <h2 style="margin:0 0 .5rem;">General</h2>
        <form
          method="post"
          action={`/projects/${project.slug}/settings`}
          hx-post={`/projects/${project.slug}/settings`}
          hx-target="body"
          hx-swap="outerHTML"
        >
          <div class="field">
            <label class="field__label" for="name">
              Name
            </label>
            <input
              class={`field__input ${errors["name"] ? "field__input--error" : ""}`}
              id="name"
              name="name"
              value={project.name}
            />
            {errors["name"] ? (
              <p class="field__error" role="alert">
                {errors["name"]}
              </p>
            ) : null}
          </div>
          <div class="field">
            <label class="field__label" for="gitRepository">
              Git repository
            </label>
            <input
              class="field__input"
              id="gitRepository"
              name="gitRepository"
              value={project.gitRepository ?? ""}
              placeholder="owner/repo"
            />
          </div>
          <div class="field">
            <label class="field__label" for="gitDefaultBranch">
              Default branch
            </label>
            <input
              class="field__input"
              id="gitDefaultBranch"
              name="gitDefaultBranch"
              value={project.gitDefaultBranch}
            />
          </div>
          <div class="grid grid--2">
            <div class="field">
              <label class="field__label" for="pixelThreshold">
                Pixel threshold
              </label>
              <input
                class="field__input"
                id="pixelThreshold"
                name="pixelThreshold"
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={String(project.pixelThreshold)}
              />
              <p class="field__hint">Per-pixel color distance 0–1</p>
            </div>
            <div class="field">
              <label class="field__label" for="maxDiffRatio">
                Max diff ratio
              </label>
              <input
                class="field__input"
                id="maxDiffRatio"
                name="maxDiffRatio"
                type="number"
                step="0.001"
                min="0"
                max="1"
                value={String(project.maxDiffRatio)}
              />
              <p class="field__hint">Allowed diff ratio 0–1</p>
            </div>
          </div>
          <div class="field">
            <label class="field__label" for="publicBranchRegex">
              Public branch regex
            </label>
            <input
              class="field__input"
              id="publicBranchRegex"
              name="publicBranchRegex"
              value={project.publicBranchRegex ?? ""}
              placeholder="^main$"
            />
            <p class="field__hint">Branches matching this regex are publicly viewable.</p>
          </div>
          {isAdmin ? (
            <button class="btn btn--primary" type="submit">
              Save changes
            </button>
          ) : (
            <p class="field__hint">You need admin access to edit settings.</p>
          )}
        </form>
      </div>

      {isAdmin ? (
        <div class="card card--padded" style="border-color: var(--status-rejected);">
          <h3 style="margin:0 0 .4rem; color: var(--status-rejected);">Danger zone</h3>
          <p class="field__hint">
            Deleting a project removes all builds, snapshots, baselines and tokens. This cannot be
            undone.
          </p>
          <form
            method="post"
            action={`/projects/${project.slug}/delete`}
            hx-post={`/projects/${project.slug}/delete`}
            hx-target="body"
            hx-confirm="Delete this project? This cannot be undone."
          >
            <button class="btn btn--danger" type="submit">
              Delete project
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
