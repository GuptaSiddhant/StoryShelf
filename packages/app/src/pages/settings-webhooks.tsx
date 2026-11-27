import type { Project } from "@storyshelf/core/schema";
import { csrfField } from "../shell/csrf-field.tsx";
import {
  Alert,
  Button,
  Card,
  DialogLink,
  Meta,
  SectionTitle,
  SummaryList,
  VStack,
  type SummaryItem,
} from "../ui/components.tsx";
import { FormDialog } from "./dialog-form.tsx";
import { ADD_WEBHOOK_DIALOG } from "./token-forms.tsx";

/** Webhook row as rendered in the webhooks settings tab. */
export interface SettingsWebhook {
  id: string;
  url: string;
  events: string[];
}

function webhookItems(
  project: Project,
  webhooks: SettingsWebhook[],
  isAdmin: boolean,
): SummaryItem[] {
  return webhooks.map((webhook) => {
    const action = `/projects/${project.slug}/settings/webhooks/${webhook.id}/delete`;
    return {
      id: webhook.id,
      name: webhook.url,
      details: webhook.events.length === 0 ? "All events" : webhook.events.join(", "),
      actions: isAdmin ? (
        <form
          method="post"
          action={action}
          hx-post={action}
          hx-target="body"
          hx-confirm="Delete this webhook?"
        >
          {csrfField()}
          <Button variant="danger-secondary" size="sm" type="submit">
            Delete
          </Button>
        </form>
      ) : undefined,
    };
  });
}

/** Webhooks settings tab: webhooks as a summary; adding one opens a dialog. */
export function renderSettingsWebhooks(
  project: Project,
  webhooks: SettingsWebhook[],
  isAdmin: boolean,
  formState?: { errors?: Record<string, string>; globalError?: string; secret?: string },
): unknown {
  const add = (primary: boolean): unknown =>
    isAdmin ? (
      <DialogLink
        dialogId={ADD_WEBHOOK_DIALOG}
        href={`/projects/${project.slug}/settings/webhooks/new`}
        variant={primary ? "primary" : "secondary"}
        size={primary ? "md" : "sm"}
        icon="plus"
      >
        Add webhook
      </DialogLink>
    ) : undefined;
  return (
    <VStack>
      {formState?.secret ? (
        <Alert tone="success" title="Webhook created">
          Copy the signing secret now — shown once: <code>{formState.secret}</code>
        </Alert>
      ) : null}
      {formState?.globalError ? <Alert tone="danger">{formState.globalError}</Alert> : null}
      <Card>
        <SectionTitle actions={webhooks.length > 0 ? add(false) : null}>Webhooks</SectionTitle>
        <Meta>
          Notify external services when builds are created, updated, approved or rejected. Payloads
          are POSTed as JSON and signed with the webhook secret.
        </Meta>
        <SummaryList
          label="Webhooks"
          items={webhookItems(project, webhooks, isAdmin)}
          emptyTitle="No webhooks configured"
          add={add(true)}
        />
      </Card>
      {isAdmin ? (
        <FormDialog id={ADD_WEBHOOK_DIALOG} title="Add webhook" submitLabel="Add webhook" />
      ) : null}
    </VStack>
  );
}
