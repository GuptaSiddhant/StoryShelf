import type { Project } from "../schema.ts";

/** Interaction-tests settings tab: play execution toggle and timeout. */
export function renderSettingsTests(
  project: Project,
  isAdmin: boolean,
  formState?: { globalError?: string },
): unknown {
  return (
    <div class="grid" style="max-width: 720px;">
      {formState?.globalError ? (
        <div class="alert alert--danger" role="alert">
          {formState.globalError}
        </div>
      ) : null}
      <div class="card card--padded">
        <h2 style="margin:0 0 .5rem;">Interaction tests</h2>
        <p class="field__hint" style="margin-bottom:1rem;">
          When enabled, Storybook <code>play</code> functions run before each screenshot. Failures
          block the build unless the story is marked
          <code>flaky-test</code> via <code>tags: ['flaky-test']</code> or
          <code>parameters: &#123; flakyTest: true &#125;</code> (supports both{" "}
          <code>chromatic</code> and <code>storyshelf</code> keys, story-level, case-insensitive).
          Use <code>disableSnapshot</code> to skip a story entirely.
        </p>
        <form
          method="post"
          action={`/projects/${project.slug}/settings/tests`}
          hx-post={`/projects/${project.slug}/settings/tests`}
          hx-target="body"
          hx-swap="outerHTML"
        >
          <div class="field">
            <label class="field__label" style="display:flex; gap:.5rem; align-items:center;">
              <input
                type="checkbox"
                name="executePlay"
                value="true"
                checked={project.executePlay ? true : undefined}
                disabled={!isAdmin}
              />
              Enable interaction tests (play)
            </label>
            <p class="field__hint">
              When enabled, failing play blocks the build (failed). Flaky stories show warnings but
              status stays successful.
            </p>
          </div>
          <div class="field">
            <label class="field__label" for="playTimeoutMs">
              Play timeout (ms)
            </label>
            <input
              class="field__input"
              id="playTimeoutMs"
              name="playTimeoutMs"
              type="number"
              min="1000"
              max="30000"
              step="1000"
              value={String(project.playTimeoutMs)}
              disabled={!isAdmin}
            />
            <p class="field__hint">
              Timeout for each play function (1000–30000 ms, default 10000).
            </p>
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
      <div class="card card--padded">
        <h3 style="margin:0 0 .4rem;">How to mark stories</h3>
        <pre
          class="field__hint"
          style="white-space:pre-wrap; background: var(--surface); padding:.75rem; border-radius:.5rem;"
        >
          {`// Disable snapshot entirely (skip capture + play)
export const Hidden: Story = {
  parameters: { storyshelf: { disableSnapshot: true } }
};
// Mark as flaky (non-blocking, shows warning)
export const Flaky: Story = {
  tags: ['flaky-test'],
  play: async ({canvasElement}) => { /* ... */ }
};
// or via parameters (both keys work, storyshelf wins)
export const Flaky2: Story = {
  parameters: { chromatic: { flakyTest: true } }
};`}
        </pre>
        <p class="field__hint">
          Tags are story-level and case-insensitive (<code>flaky-test</code>). Whole story is
          non-blocking when flaky. GitHub status stays
          <code>success</code> with a warning comment.
        </p>
      </div>
    </div>
  );
}
