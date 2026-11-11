import type { Project } from "@storyshelf/core/schema";
import { csrfField } from "../shell/csrf-field.tsx";
import { Alert, Button, Card, Field, FormActions, Meta, SectionTitle } from "../ui/components.tsx";
import type { SettingsFormState } from "./settings-general.tsx";

/** Thresholds section: how different two captures may be before a snapshot counts as changed. */
export function renderSettingsThresholds(
  project: Project,
  formState: SettingsFormState | undefined,
  isAdmin: boolean,
): unknown {
  const action = `/projects/${project.slug}/settings/thresholds`;
  return (
    <div class="grid max-w-form">
      {formState?.globalError ? <Alert tone="danger">{formState.globalError}</Alert> : null}
      <Card>
        <SectionTitle>Diff thresholds</SectionTitle>
        <form method="post" action={action} hx-post={action} hx-target="body" hx-swap="outerHTML">
          {csrfField()}
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
          {isAdmin ? (
            <FormActions>
              <Button variant="primary" type="submit" icon="check">
                Save thresholds
              </Button>
            </FormActions>
          ) : (
            <Meta>You need admin access to edit settings.</Meta>
          )}
        </form>
      </Card>
    </div>
  );
}
