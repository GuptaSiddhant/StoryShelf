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
      <div class="page-header">
        <nav class="breadcrumbs" aria-label="Breadcrumb">
          <ol>
            <li>
              <a href="/projects">Projects</a>
            </li>
            <li>
              <span aria-current="page">New project</span>
            </li>
          </ol>
        </nav>
        <div class="page-header__row">
          <div>
            <h1 class="page-header__title">Create project</h1>
            <p class="page-header__desc">
              A project corresponds to one Storybook. You can have multiple projects per repository.
            </p>
          </div>
        </div>
      </div>

      {state.globalError ? (
        <div class="alert alert--danger" role="alert">
          <strong class="alert__title">Could not create project</strong>
          <div class="alert__body">{state.globalError}</div>
        </div>
      ) : null}

      <div class="card card--padded" style="max-width: 640px;">
        <form
          method="post"
          action="/projects/new"
          hx-post="/projects/new"
          hx-target="body"
          hx-swap="outerHTML"
          novalidate
        >
          <div class="field">
            <label class="field__label" for="name">
              Name <span aria-hidden="true">*</span>
            </label>
            <input
              class={`field__input ${errors["name"] ? "field__input--error" : ""}`}
              id="name"
              name="name"
              type="text"
              required
              autofocus
              value={values.name ?? ""}
              placeholder="Design System"
              aria-invalid={errors["name"] ? "true" : undefined}
              aria-describedby={errors["name"] ? "name-error" : "name-hint"}
              autocomplete="off"
            />
            {errors["name"] ? (
              <p class="field__error" id="name-error" role="alert">
                {errors["name"]}
              </p>
            ) : (
              <p class="field__hint" id="name-hint">
                Human readable name. A URL-friendly slug is generated automatically.
              </p>
            )}
          </div>

          <div class="field">
            <label class="field__label" for="gitRepository">
              Git repository
            </label>
            <input
              class={`field__input ${errors["gitRepository"] ? "field__input--error" : ""}`}
              id="gitRepository"
              name="gitRepository"
              type="text"
              value={values.gitRepository ?? ""}
              placeholder="acme/design-system"
              aria-invalid={errors["gitRepository"] ? "true" : undefined}
              aria-describedby={
                errors["gitRepository"] ? "gitRepository-error" : "gitRepository-hint"
              }
            />
            {errors["gitRepository"] ? (
              <p class="field__error" id="gitRepository-error" role="alert">
                {errors["gitRepository"]}
              </p>
            ) : (
              <p class="field__hint" id="gitRepository-hint">
                Optional owner/repo for status checks and links.
              </p>
            )}
          </div>

          <div class="field">
            <label class="field__label" for="gitDefaultBranch">
              Default branch
            </label>
            <input
              class="field__input"
              id="gitDefaultBranch"
              name="gitDefaultBranch"
              type="text"
              value={values.gitDefaultBranch ?? "main"}
              placeholder="main"
            />
            <p class="field__hint">
              Baselines fall back to this branch when no branch-specific baseline exists.
            </p>
          </div>

          <div style="display:flex; gap:.5rem; margin-top:1rem;">
            <button class="btn btn--primary" type="submit">
              Create project
            </button>
            <a class="btn btn--secondary" href="/projects">
              Cancel
            </a>
          </div>
        </form>
      </div>
    </DocumentLayout>
  );
}
