import { isServerlessHost } from "@storyshelf/core/config";
import type { Project } from "@storyshelf/core/schema";
import type { FC } from "hono/jsx";
import {
  Alert,
  Button,
  Card,
  Field,
  FormActions,
  SectionTitle,
  SelectField,
} from "../ui/components.tsx";
import { csrfField } from "../ui/csrf-field.tsx";
import type { NotificationsFormState, SettingsNotifyProvider } from "./settings-notifications.tsx";

/* eslint-disable promise-function-async -- JSX components return HtmlEscapedString */

/** The repository, prefix and token fields of the git channel form. */
const GitChannelFields: FC<{ errors?: Record<string, string> }> = ({ errors }) => (
  <>
    <Field
      label="Owner"
      name="owner"
      required
      placeholder="my-org"
      hint="Organization, user or group that owns the repository."
      error={errors?.["owner"]}
    />
    <Field label="Repository" name="repo" required placeholder="my-repo" error={errors?.["repo"]} />
    <Field
      label="Host"
      name="host"
      placeholder="https://gitlab.example.com"
      hint="GitLab only: a self-managed host. Leave blank for gitlab.com."
      error={errors?.["host"]}
    />
    <Field
      label="Status prefix"
      name="prefix"
      placeholder="storyshelf"
      hint="Statuses are named <prefix>/testing and <prefix>/storybook. Give each project in a shared repository its own prefix."
      error={errors?.["prefix"]}
    />
    <Field
      label="Token"
      name="token"
      type="password"
      required
      placeholder="ghp_…"
      hint="A token that can write commit statuses (GitHub: repo:status; GitLab: api)."
      error={errors?.["token"]}
    />
  </>
);

/** Git channel creation card (admins only): repository, status prefix and token. */
export const CreateGitChannelCard: FC<{
  project: Project;
  providers: SettingsNotifyProvider[];
  formState?: NotificationsFormState;
}> = ({ project, providers, formState }) => (
  <Card>
    <SectionTitle level={3}>Add a git channel</SectionTitle>
    {isServerlessHost() ? (
      <Alert tone="info" title="Statuses are delivered inline">
        This host has no job consumer, so a build's state is written in the request that changes it,
        without retries. A failure shows on the channel and the next change writes the current state
        again.
      </Alert>
    ) : null}
    <form
      method="post"
      action={`/projects/${project.slug}/settings/notifications`}
      hx-post={`/projects/${project.slug}/settings/notifications`}
      hx-target="body"
    >
      {csrfField()}
      <SelectField
        label="Git provider"
        name="gitProvider"
        options={providers.map((provider) => ({ value: provider.kind, label: provider.name }))}
        hint={formState?.errors?.["gitProvider"]}
      />
      <GitChannelFields errors={formState?.errors} />
      <FormActions>
        <Button variant="primary" type="submit" icon="plus">
          Add git channel
        </Button>
      </FormActions>
    </form>
  </Card>
);
