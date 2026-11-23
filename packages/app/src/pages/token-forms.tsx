import type { Project } from "@storyshelf/core/schema";
import type { FC } from "hono/jsx";
import { Alert, Field } from "../ui/components.tsx";
import { DialogForm } from "./dialog-form.tsx";

/** Dialog ids of the token and webhook forms. */
export const CREATE_TOKEN_DIALOG = "create-token";
export const ADD_WEBHOOK_DIALOG = "add-webhook";

interface FormProps {
  project: Project;
  standalone: boolean;
  error?: string | undefined;
}

/** The create-token form: in the dialog, or on its own page. */
export const CreateTokenForm: FC<FormProps> = ({ project, standalone, error }) => {
  return (
    <DialogForm
      dialog={CREATE_TOKEN_DIALOG}
      action={`/projects/${project.slug}/settings/tokens`}
      submitLabel="Create token"
      standalone={standalone}
      backHref={`/projects/${project.slug}/settings/access#tokens`}
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field
        label="Name"
        name="tokenName"
        required
        placeholder="ci"
        hint="The token value is shown once after creation. Store it securely."
      />
    </DialogForm>
  );
};

/** The add-webhook form: in the dialog, or on its own page. */
export const AddWebhookForm: FC<FormProps> = ({ project, standalone, error }) => {
  return (
    <DialogForm
      dialog={ADD_WEBHOOK_DIALOG}
      action={`/projects/${project.slug}/settings/webhooks`}
      submitLabel="Add webhook"
      standalone={standalone}
      backHref={`/projects/${project.slug}/settings/access#webhooks`}
    >
      <Field
        label="URL"
        name="url"
        type="url"
        required
        placeholder="https://example.com/hooks/storyshelf"
        error={error}
      />
      <Field
        label="Events"
        name="events"
        placeholder="build.created, build.approved, snapshot.reviewed"
        hint="Comma-separated. Leave blank to receive all events."
      />
    </DialogForm>
  );
};
