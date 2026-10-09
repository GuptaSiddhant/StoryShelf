import type { Project } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */
import {
  Alert,
  Button,
  Card,
  FormActions,
  Meta,
  SectionTitle,
  SelectField,
} from "../ui/components.tsx";
import { csrfField } from "../ui/csrf-field.tsx";

/** AI availability and profile choices passed to the settings tab. */
export interface SettingsAiData {
  available: boolean;
  profiles: string[];
  defaultProfile: string;
  isSiteAdmin: boolean;
}

function ProfileForm(props: {
  project: Project;
  ai: SettingsAiData;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, ai } = props;
  return (
    <form
      method="post"
      action={`/projects/${project.slug}/settings/ai`}
      hx-post={`/projects/${project.slug}/settings/ai`}
      hx-target="body"
      hx-swap="outerHTML"
    >
      {csrfField()}
      <SelectField
        label="AI profile"
        name="aiProfile"
        value={project.aiProfile ?? ""}
        disabled={!ai.isSiteAdmin}
        options={[
          { value: "", label: "Off (no data leaves the server)" },
          ...ai.profiles.map((name) => ({
            value: name,
            label: name === ai.defaultProfile ? `${name} (default)` : name,
          })),
        ]}
        hint="Only site admins can change this because it decides where project data is sent."
      />
      {ai.isSiteAdmin ? (
        <FormActions>
          <Button variant="primary" type="submit" icon="check">
            Save changes
          </Button>
        </FormActions>
      ) : (
        <Meta>You need site admin access to change the AI profile.</Meta>
      )}
    </form>
  );
}

/** AI settings tab: per-project profile gate (site admins choose; others read). */
export function renderSettingsAi(
  project: Project,
  ai: SettingsAiData | undefined,
  formState?: { globalError?: string },
): unknown {
  if (!ai?.available) {
    return (
      <Alert tone="info" title="AI is not configured">
        This server has no AI configured, so insights are unavailable.
      </Alert>
    );
  }
  return (
    <div class="grid max-w-form">
      {formState?.globalError ? <Alert tone="danger">{formState.globalError}</Alert> : null}
      <Card>
        <SectionTitle>AI insights</SectionTitle>
        <Meta>
          Choosing a profile turns on AI triage for builds and a project health digest. The profile
          decides which models see this project&apos;s data (including screenshots when its model
          supports vision). Insights are advisory only: they never approve or reject anything.
        </Meta>
        <ProfileForm project={project} ai={ai} />
      </Card>
    </div>
  );
}
