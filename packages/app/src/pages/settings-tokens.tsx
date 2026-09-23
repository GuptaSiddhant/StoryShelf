import type { Project } from "@storyshelf/core/schema";
import type { Token } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { Alert, Button, Card, Field, Meta } from "../ui/components.tsx";
import { csrfField } from "../ui/csrf-field.tsx";

/** Tokens settings tab: project CLI tokens plus the create-token form. */
export function renderSettingsTokens(
  project: Project,
  tokens: Omit<Token, "hash">[],
  isAdmin: boolean,
  secret?: string,
): unknown {
  return (
    <div class="grid max-w-form">
      {secret ? (
        <Alert tone="success" title="Token created">
          Copy now — shown once: <code>{secret}</code>
        </Alert>
      ) : null}
      <Card>
        <h2 style="margin:0 0 .3rem;">API tokens</h2>
        <Meta>Tokens are used by the CLI to upload builds. They are scoped to this project.</Meta>
        <div class="table-wrap table-gap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Created</th>
                <th>Last used</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((token): HtmlEscapedString | Promise<HtmlEscapedString> => (
                <tr key={token.id}>
                  <td>{token.name}</td>
                  <td>{new Date(token.createdAt).toLocaleDateString()}</td>
                  <td>
                    {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleDateString() : "—"}
                  </td>
                  <td>
                    {isAdmin ? (
                      <form
                        method="post"
                        action={`/projects/${project.slug}/settings/tokens/${token.id}/delete`}
                        hx-post={`/projects/${project.slug}/settings/tokens/${token.id}/delete`}
                        hx-target="body"
                      >
                        {csrfField()}
                        <Button variant="ghost" type="submit">
                          Revoke
                        </Button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {tokens.length === 0 ? <Meta>No tokens yet. Create one for CI.</Meta> : null}
      </Card>

      {isAdmin ? (
        <Card>
          <h3 style="margin:0 0 .5rem;">Create token</h3>
          <form
            method="post"
            action={`/projects/${project.slug}/settings/tokens`}
            hx-post={`/projects/${project.slug}/settings/tokens`}
            hx-target="body"
          >
            {csrfField()}
            <Field label="Name" name="tokenName" required placeholder="ci" />
            <Button variant="primary" type="submit">
              Create token
            </Button>
          </form>
          <Meta>Token value is shown once after creation. Store it securely.</Meta>
        </Card>
      ) : null}
    </div>
  );
}
