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
} from "../ui/components.tsx";

/** Tests settings tab: play execution, Storybook 10 test runs, accessibility checks, play timeout. */
export function renderSettingsTests(
  project: Project,
  isAdmin: boolean,
  formState?: { globalError?: string },
): unknown {
  return (
    <div class="grid max-w-form">
      {formState?.globalError ? <Alert tone="danger">{formState.globalError}</Alert> : null}
      <Card>
        <SectionTitle>Interaction and accessibility tests</SectionTitle>
        <Meta>
          When enabled, Storybook <code>play</code> functions run before each screenshot. Failures
          block the build unless the story is marked
          <code>flaky-test</code> via <code>tags: ['flaky-test']</code> or
          <code>parameters: &#123; flakyTest: true &#125;</code> (supports both{" "}
          <code>chromatic</code> and <code>storyshelf</code> keys, story-level, case-insensitive).
          Use <code>disableSnapshot</code> to skip a story entirely.
        </Meta>
        <Meta>
          Accessibility checks run axe on every captured story. Violations appear with the snapshot
          in review and never block a build; a story opts out with{" "}
          <code>parameters: &#123; a11y: &#123; disable: true &#125; &#125;</code>.
        </Meta>
        <Meta>
          Storybook 10 <code>.test()</code> entries (<code>story.test("name", async ...)</code>) can
          run as interaction tests too. They take no screenshot: each runs in the Storybook iframe
          and is reported as passed or failed on the build. A failing test fails the build like a
          failing <code>play</code> function. Storybook 8 and 9 builds have none.
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
          <CheckField
            label="Run Storybook tests (.test())"
            name="runTests"
            value="true"
            checked={project.runTests === true ? true : undefined}
            disabled={!isAdmin}
            hint="Off by default, because it changes what a build contains. When enabled, each .test() entry runs once on the primary browser and a failing test fails the build (flaky stories excepted)."
          />
          <CheckField
            label="Accessibility checks (axe)"
            name="runA11y"
            value="true"
            checked={project.runA11y === false ? undefined : true}
            disabled={!isAdmin}
            hint="On by default. Each story is scanned with axe-core (WCAG A/AA and best-practice rules). Violations are shown on the snapshot in review and never block the build."
          />
          <CheckField
            label="Detect unstable renders"
            name="detectUnstable"
            value="true"
            checked={project.detectUnstable === false ? undefined : true}
            disabled={!isAdmin}
            hint="On by default. A snapshot that differs from its baseline is rendered once more; if the two renders differ, it is flagged as a likely flaky story. It stays a change to review and never changes the build status. Costs one extra render per changed snapshot."
          />
          <CheckField
            label="Verify default-branch builds with the git host"
            name="requireVerifiedDefault"
            value="true"
            checked={project.requireVerifiedDefault === false ? undefined : true}
            disabled={!isAdmin}
            hint={`On by default. A build that names ${project.gitDefaultBranch} auto-approves and moves the default-branch baselines only after a git channel confirms the commit is on ${project.gitDefaultBranch}. Turn it off only for a project with no git host: its default-branch builds then count unverified, and anyone with an upload token can move the baselines.`}
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
