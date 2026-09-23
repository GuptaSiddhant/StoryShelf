import type { Project } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { Alert, Badge, Button, Card, Field, Meta, SectionTitle } from "../ui/components.tsx";
import { csrfField } from "../ui/csrf-field.tsx";

/** Webhook row as rendered in the webhooks settings tab. */
export interface SettingsWebhook {
  id: string;
  url: string;
  events: string[];
}

/** Webhooks settings tab: webhook list plus the create-webhook form. */
export function renderSettingsWebhooks(
  project: Project,
  webhooks: SettingsWebhook[],
  isAdmin: boolean,
  formState?: { errors?: Record<string, string>; globalError?: string; secret?: string },
): unknown {
  return (
    <div class="grid max-w-form">
      {formState?.secret ? (
        <Alert tone="success" title="Webhook created">
          Copy the signing secret now — shown once: <code>{formState.secret}</code>
        </Alert>
      ) : null}
      {formState?.globalError ? <Alert tone="danger">{formState.globalError}</Alert> : null}

      <Card>
        <SectionTitle>Webhooks</SectionTitle>
        <Meta>
          Notify external services when builds are created, updated, approved or rejected. Payloads
          are POSTed as JSON and signed with the webhook secret.
        </Meta>
        <div class="table-wrap table-gap">
          <table>
            <thead>
              <tr>
                <th>URL</th>
                <th>Events</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {webhooks.map((webhook): HtmlEscapedString | Promise<HtmlEscapedString> => (
                <tr key={webhook.id}>
                  <td class="truncate max-w-cell" title={webhook.url}>
                    {webhook.url}
                  </td>
                  <td>
                    {webhook.events.length === 0 ? (
                      <Meta as="span">all events</Meta>
                    ) : (
                      <div class="row-actions">
                        {webhook.events.map(
                          (event): HtmlEscapedString | Promise<HtmlEscapedString> => (
                            <Badge tone="neutral">{event}</Badge>
                          ),
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    {isAdmin ? (
                      <form
                        method="post"
                        action={`/projects/${project.slug}/settings/webhooks/${webhook.id}/delete`}
                        hx-post={`/projects/${project.slug}/settings/webhooks/${webhook.id}/delete`}
                        hx-target="body"
                      >
                        {csrfField()}
                        <Button variant="ghost" type="submit">
                          Delete
                        </Button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {webhooks.length === 0 ? <Meta>No webhooks configured.</Meta> : null}
      </Card>

      {isAdmin ? (
        <Card>
          <SectionTitle level={3}>Create webhook</SectionTitle>
          <form
            method="post"
            action={`/projects/${project.slug}/settings/webhooks`}
            hx-post={`/projects/${project.slug}/settings/webhooks`}
            hx-target="body"
          >
            {csrfField()}
            <Field
              label="URL"
              name="url"
              type="url"
              required
              placeholder="https://example.com/hooks/storyshelf"
              error={formState?.errors?.["url"]}
            />
            <Field
              label="Events"
              name="events"
              placeholder="build.created, build.approved, snapshot.reviewed"
              hint="Comma-separated. Leave blank to receive all events."
            />
            <Button variant="primary" type="submit">
              Add webhook
            </Button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
