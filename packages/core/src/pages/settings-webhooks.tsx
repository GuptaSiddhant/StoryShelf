import type { HtmlEscapedString } from "hono/utils/html";
import type { Project } from "../schema/project.ts";

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
    <div class="grid" style="max-width: 880px;">
      {formState?.secret ? (
        <div class="alert alert--success" role="alert">
          <strong class="alert__title">Webhook created</strong>
          <div class="alert__body">
            Copy the signing secret now — shown once: <code>{formState.secret}</code>
          </div>
        </div>
      ) : null}
      {formState?.globalError ? (
        <div class="alert alert--danger" role="alert">
          {formState.globalError}
        </div>
      ) : null}

      <div class="card card--padded">
        <h2 style="margin:0 0 .3rem;">Webhooks</h2>
        <p class="field__hint">
          Notify external services when builds are created, updated, approved or rejected. Payloads
          are POSTed as JSON and signed with the webhook secret.
        </p>
        <div class="table-wrap" style="margin-top:.75rem;">
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
                  <td
                    style="max-width:36ch; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"
                    title={webhook.url}
                  >
                    {webhook.url}
                  </td>
                  <td>
                    {webhook.events.length === 0 ? (
                      <span class="field__hint">all events</span>
                    ) : (
                      <div style="display:flex; gap:.25rem; flex-wrap:wrap;">
                        {webhook.events.map(
                          (event): HtmlEscapedString | Promise<HtmlEscapedString> => (
                            <span key={event} class="badge badge--neutral">
                              {event}
                            </span>
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
                        <button class="btn btn--ghost" type="submit">
                          Delete
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {webhooks.length === 0 ? (
          <p class="field__hint" style="margin-top:.5rem;">
            No webhooks configured.
          </p>
        ) : null}
      </div>

      {isAdmin ? (
        <div class="card card--padded">
          <h3 style="margin:0 0 .5rem;">Create webhook</h3>
          <form
            method="post"
            action={`/projects/${project.slug}/settings/webhooks`}
            hx-post={`/projects/${project.slug}/settings/webhooks`}
            hx-target="body"
          >
            <div class="field">
              <label class="field__label" for="url">
                URL
              </label>
              <input
                class={`field__input ${formState?.errors?.["url"] ? "field__input--error" : ""}`}
                id="url"
                name="url"
                type="url"
                required
                placeholder="https://example.com/hooks/storyshelf"
              />
              {formState?.errors?.["url"] ? (
                <p class="field__error" role="alert">
                  {formState.errors["url"]}
                </p>
              ) : null}
            </div>
            <div class="field">
              <label class="field__label" for="events">
                Events
              </label>
              <input
                class="field__input"
                id="events"
                name="events"
                placeholder="build.created, build.approved, snapshot.reviewed"
              />
              <p class="field__hint">Comma-separated. Leave blank to receive all events.</p>
            </div>
            <button class="btn btn--primary" type="submit">
              Add webhook
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
