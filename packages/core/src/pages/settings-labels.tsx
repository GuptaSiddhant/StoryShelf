import type { LabelType, Project } from "../schema.ts";
import { Badge } from "../ui/components.tsx";

export function renderSettingsLabels(project: Project, labelTypes: LabelType[], isAdmin: boolean): unknown {
  return (
    <div class="grid" style="max-width: 880px;">
      <div class="card card--padded">
        <h2 style="margin:0 0 .3rem;">Label types</h2>
        <p class="field__hint">Labels attach typed values to builds (e.g. pr=123, jira=ABC-123). Values link out via the template.</p>
        <div class="table-wrap" style="margin-top:.75rem;">
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Name</th>
                <th>Template</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {labelTypes.map(
                // eslint-disable-next-line promise-function-async -- JSX.Element includes Promise<HtmlEscapedString>
                (labelType) => (
                  <tr key={labelType.id}>
                    <td>
                      <Badge tone="neutral">{labelType.key}</Badge>
                    </td>
                    <td>{labelType.name}</td>
                    <td style="max-width:32ch; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{labelType.linkTemplate ?? "—"}</td>
                    <td>
                      {isAdmin && labelType.key !== "persistent" && labelType.key !== "branch" ? (
                        <form method="post" action={`/projects/${project.slug}/settings/labels/${labelType.key}/delete`} hx-post={`/projects/${project.slug}/settings/labels/${labelType.key}/delete`} hx-target="body">
                          <button class="btn btn--ghost" type="submit" aria-label={`Delete ${labelType.key}`}>
                            Delete
                          </button>
                        </form>
                      ) : (
                        <span class="field__hint">built-in</span>
                      )}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
        {labelTypes.length === 0 ? <p class="field__hint" style="margin-top:.5rem;">No label types configured.</p> : null}
      </div>

      {isAdmin ? (
        <div class="card card--padded">
          <h3 style="margin:0 0 .5rem;">Create label type</h3>
          <form method="post" action={`/projects/${project.slug}/settings/labels`} hx-post={`/projects/${project.slug}/settings/labels`} hx-target="body">
            <div class="grid grid--2">
              <div class="field">
                <label class="field__label" for="key">
                  Key
                </label>
                <input class="field__input" id="key" name="key" required placeholder="jira" pattern="^[a-z0-9_-]+$" />
                <p class="field__hint">Lowercase, no spaces.</p>
              </div>
              <div class="field">
                <label class="field__label" for="labelName">
                  Name
                </label>
                <input class="field__input" id="labelName" name="labelName" required placeholder="Jira issue" />
              </div>
            </div>
            <div class="field">
              <label class="field__label" for="linkTemplate">
                Link template
              </label>
              <input class="field__input" id="linkTemplate" name="linkTemplate" placeholder="https://jira.example.com/browse/{value}" />
              <p class="field__hint">
                Use {"{value}"} placeholder. Optional.
              </p>
            </div>
            <button class="btn btn--primary" type="submit">
              Add label type
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}