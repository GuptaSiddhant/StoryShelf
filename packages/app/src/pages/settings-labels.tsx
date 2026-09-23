import type { LabelType } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { Badge, Button, Field, Meta } from "../ui/components.tsx";
import { csrfField } from "../ui/csrf-field.tsx";

/** Labels settings tab: label-type table plus the create-type form. */
export function renderSettingsLabels(
  project: Project,
  labelTypes: LabelType[],
  isAdmin: boolean,
): unknown {
  return (
    <div class="grid max-w-form">
      <div class="card card--padded">
        <h2 style="margin:0 0 .3rem;">Label types</h2>
        <Meta>
          Labels attach typed values to builds (e.g. pr=123, jira=ABC-123). Values link out via the
          template.
        </Meta>
        <div class="table-wrap table-gap">
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
              {labelTypes.map((labelType): HtmlEscapedString | Promise<HtmlEscapedString> => (
                <tr key={labelType.id}>
                  <td>
                    <Badge tone="neutral">{labelType.key}</Badge>
                  </td>
                  <td>{labelType.name}</td>
                  <td style="max-width:32ch; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                    {labelType.linkTemplate ?? "—"}
                  </td>
                  <td>
                    {isAdmin && labelType.key !== "persistent" && labelType.key !== "branch" ? (
                      <form
                        method="post"
                        action={`/projects/${project.slug}/settings/labels/${labelType.key}/delete`}
                        hx-post={`/projects/${project.slug}/settings/labels/${labelType.key}/delete`}
                        hx-target="body"
                      >
                        {csrfField()}
                        <Button
                          variant="ghost"
                          type="submit"
                          aria-label={`Delete ${labelType.key}`}
                        >
                          Delete
                        </Button>
                      </form>
                    ) : (
                      <Meta as="span">built-in</Meta>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {labelTypes.length === 0 ? <Meta>No label types configured.</Meta> : null}
      </div>

      {isAdmin ? (
        <div class="card card--padded">
          <h3 style="margin:0 0 .5rem;">Create label type</h3>
          <form
            method="post"
            action={`/projects/${project.slug}/settings/labels`}
            hx-post={`/projects/${project.slug}/settings/labels`}
            hx-target="body"
          >
            {csrfField()}
            <div class="grid grid--2">
              <Field
                label="Key"
                name="key"
                required
                placeholder="jira"
                pattern="^[a-z0-9_-]+$"
                hint="Lowercase, no spaces."
              />
              <Field label="Name" name="labelName" required placeholder="Jira issue" />
            </div>
            <Field
              label="Link template"
              name="linkTemplate"
              placeholder="https://jira.example.com/browse/{value}"
              hint="Use {value} placeholder. Optional."
            />
            <Button variant="primary" type="submit">
              Add label type
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
