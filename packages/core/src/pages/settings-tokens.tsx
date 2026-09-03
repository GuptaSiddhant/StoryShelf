import type { HtmlEscapedString } from "hono/utils/html";
import type { Project, Token } from "../schema.ts";

export function renderSettingsTokens(project: Project, tokens: Omit<Token, "hash">[], isAdmin: boolean): unknown {
  return (
    <div class="grid" style="max-width: 880px;">
      <div class="card card--padded">
        <h2 style="margin:0 0 .3rem;">API tokens</h2>
        <p class="field__hint">Tokens are used by the CLI to upload builds. They are scoped to this project.</p>
        <div class="table-wrap" style="margin-top:.75rem;">
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
              {tokens.map(
                (token): HtmlEscapedString => (
                  <tr key={token.id}>
                    <td>{token.name}</td>
                    <td>{new Date(token.createdAt).toLocaleDateString()}</td>
                    <td>{token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleDateString() : "—"}</td>
                    <td>
                      {isAdmin ? (
                        <form method="post" action={`/projects/${project.slug}/settings/tokens/${token.id}/delete`} hx-post={`/projects/${project.slug}/settings/tokens/${token.id}/delete`} hx-target="body">
                          <button class="btn btn--ghost" type="submit">
                            Revoke
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
        {tokens.length === 0 ? <p class="field__hint" style="margin-top:.5rem;">No tokens yet. Create one for CI.</p> : null}
      </div>

      {isAdmin ? (
        <div class="card card--padded">
          <h3 style="margin:0 0 .5rem;">Create token</h3>
          <form method="post" action={`/projects/${project.slug}/settings/tokens`} hx-post={`/projects/${project.slug}/settings/tokens`} hx-target="body">
            <div class="field">
              <label class="field__label" for="tokenName">
                Name
              </label>
              <input class="field__input" id="tokenName" name="tokenName" required placeholder="ci" />
            </div>
            <button class="btn btn--primary" type="submit">
              Create token
            </button>
          </form>
          <p class="field__hint" style="margin-top:.5rem;">Token value is shown once after creation. Store it securely.</p>
        </div>
      ) : null}
    </div>
  );
}