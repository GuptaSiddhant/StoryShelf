import type { Project } from "@storyshelf/core/schema";
import type { Token } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import {
  Alert,
  Button,
  Card,
  Field,
  FormActions,
  Meta,
  SectionTitle,
  Table,
} from "../ui/components.tsx";
import { csrfField } from "../ui/csrf-field.tsx";

/** Tokens settings tab: project CLI tokens plus the create-token form. */
export function renderSettingsTokens(
  project: Project,
  tokens: Omit<Token, "hash">[],
  isAdmin: boolean,
  formState?: { globalError?: string; secret?: string },
): unknown {
  return (
    <div class="grid max-w-form">
      {formState?.secret ? (
        <Alert tone="success" title="Token created">
          Copy now — shown once: <code>{formState.secret}</code>
        </Alert>
      ) : null}
      {formState?.globalError ? <Alert tone="danger">{formState.globalError}</Alert> : null}
      <Card>
        <SectionTitle>API tokens</SectionTitle>
        <Meta>Tokens are used by the CLI to upload builds. They are scoped to this project.</Meta>
        <Table>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Created</th>
                <th>Last used</th>
                <th>
                  <span class="visually-hidden">Actions</span>
                </th>
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
                        hx-confirm="Delete this token? CI jobs using it will stop working."
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
        </Table>
        {tokens.length === 0 ? <Meta>No tokens yet. Create one for CI.</Meta> : null}
      </Card>

      {isAdmin ? (
        <Card>
          <SectionTitle level={3}>Create token</SectionTitle>
          <form
            method="post"
            action={`/projects/${project.slug}/settings/tokens`}
            hx-post={`/projects/${project.slug}/settings/tokens`}
            hx-target="body"
          >
            {csrfField()}
            <Field label="Name" name="tokenName" required placeholder="ci" />
            <FormActions>
              <Button variant="primary" type="submit" icon="plus">
                Create token
              </Button>
            </FormActions>
          </form>
          <Meta>Token value is shown once after creation. Store it securely.</Meta>
        </Card>
      ) : null}
    </div>
  );
}
