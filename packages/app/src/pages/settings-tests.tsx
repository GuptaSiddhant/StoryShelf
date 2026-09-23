import type { Project } from "@storyshelf/core/schema";
import { Alert, Button, Card, CheckField, Field, Meta, SectionTitle } from "../ui/components.tsx";
import { csrfField } from "../ui/csrf-field.tsx";

/** Interaction-tests settings tab: play execution toggle and timeout. */
export function renderSettingsTests(
  project: Project,
  isAdmin: boolean,
  formState?: { globalError?: string },
): unknown {
  return (
    <div class="grid max-w-form">
      {formState?.globalError ? <Alert tone="danger">{formState.globalError}</Alert> : null}
      <Card>
        <SectionTitle>Interaction tests</SectionTitle>
        <Meta>
          When enabled, Storybook <code>play</code> functions run before each screenshot. Failures
          block the build unless the story is marked
          <code>flaky-test</code> via <code>tags: ['flaky-test']</code> or
          <code>parameters: &#123; flakyTest: true &#125;</code> (supports both{" "}
          <code>chromatic</code> and <code>storyshelf</code> keys, story-level, case-insensitive).
          Use <code>disableSnapshot</code> to skip a story entirely.
        </Meta>
        <form
          method="post"
          action={`/projects/${project.slug}/settings/tests`}
          hx-post={`/projects/${project.slug}/settings/tests`}
          hx-target="body"
          hx-swap="outerHTML"
        >
          {csrfField()}
          <CheckField
            label="Enable interaction tests (play)"
            name="executePlay"
            value="true"
            checked={project.executePlay ? true : undefined}
            disabled={!isAdmin}
            hint="When enabled, failing play blocks the build (failed). Flaky stories show warnings but status stays successful."
          />
          <Field
            label="Play timeout (ms)"
            name="playTimeoutMs"
            type="number"
            min="1000"
            max="30000"
            step="1000"
            value={String(project.playTimeoutMs)}
            disabled={!isAdmin}
            hint="Timeout for each play function (1000–30000 ms, default 10000)."
          />
          {isAdmin ? (
            <Button variant="primary" type="submit">
              Save changes
            </Button>
          ) : (
            <Meta>You need admin access to edit settings.</Meta>
          )}
        </form>
      </Card>
      <Card>
        <SectionTitle level={3}>How to mark stories</SectionTitle>
        <Meta as="pre">
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
        </Meta>
        <Meta>
          Tags are story-level and case-insensitive (<code>flaky-test</code>). Whole story is
          non-blocking when flaky. GitHub status stays
          <code>success</code> with a warning comment.
        </Meta>
      </Card>
    </div>
  );
}
