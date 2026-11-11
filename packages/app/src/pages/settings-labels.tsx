import type { LabelType, Project } from "@storyshelf/core/schema";
import { csrfField } from "../shell/csrf-field.tsx";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  FormActions,
  Meta,
  SectionTitle,
  Table,
} from "../ui/components.tsx";

type Rendered = ReturnType<typeof Card>;

function LabelTypeActions(props: { project: Project; labelType: LabelType }): Rendered {
  const { project, labelType } = props;
  const editable = labelType.key !== "persistent";
  const deletable = editable && labelType.key !== "branch";
  return (
    <>
      {editable ? (
        <Button
          variant="ghost"
          size="sm"
          href={`/projects/${project.slug}/settings/labels?edit=${labelType.key}`}
          aria-label={`Edit ${labelType.key}`}
        >
          Edit
        </Button>
      ) : null}
      {deletable ? (
        <form
          method="post"
          action={`/projects/${project.slug}/settings/labels/${labelType.key}/delete`}
          hx-post={`/projects/${project.slug}/settings/labels/${labelType.key}/delete`}
          hx-target="body"
          hx-confirm="Delete this label type?"
        >
          {csrfField()}
          <Button variant="ghost" type="submit" aria-label={`Delete ${labelType.key}`}>
            Delete
          </Button>
        </form>
      ) : (
        <Meta as="span">built-in</Meta>
      )}
    </>
  );
}

function LabelTypeRow(props: {
  project: Project;
  labelType: LabelType;
  isAdmin: boolean;
}): Rendered {
  const { project, labelType, isAdmin } = props;
  return (
    <tr>
      <td>
        <Badge tone="neutral">{labelType.key}</Badge>
      </td>
      <td>{labelType.name}</td>
      <td class="truncate max-w-cell">{labelType.linkTemplate ?? "—"}</td>
      <td>
        {isAdmin ? (
          <LabelTypeActions project={project} labelType={labelType} />
        ) : (
          <Meta as="span">built-in</Meta>
        )}
      </td>
    </tr>
  );
}

function LabelTypesCard(props: {
  project: Project;
  labelTypes: LabelType[];
  isAdmin: boolean;
}): Rendered {
  const { project, labelTypes, isAdmin } = props;
  return (
    <Card>
      <SectionTitle>Label types</SectionTitle>
      <Meta>
        Labels attach typed values to builds (e.g. pr=123, jira=ABC-123). Values link out via the
        template.
      </Meta>
      <Table label="Label types">
        <table>
          <thead>
            <tr>
              <th>Key</th>
              <th>Name</th>
              <th>Template</th>
              <th>
                <span class="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {labelTypes.map((labelType) => (
              <LabelTypeRow
                key={labelType.id}
                project={project}
                labelType={labelType}
                isAdmin={isAdmin}
              />
            ))}
          </tbody>
        </table>
      </Table>
      {labelTypes.length === 0 ? <Meta>No label types configured.</Meta> : null}
    </Card>
  );
}

function EditLabelTypeCard(props: { project: Project; editing: LabelType }): Rendered {
  const { project, editing } = props;
  return (
    <Card>
      <SectionTitle level={3}>Edit label type: {editing.key}</SectionTitle>
      <form
        method="post"
        action={`/projects/${project.slug}/settings/labels/${editing.key}`}
        hx-post={`/projects/${project.slug}/settings/labels/${editing.key}`}
        hx-target="body"
      >
        {csrfField()}
        <Field label="Name" name="labelName" required value={editing.name} />
        <Field
          label="Link template"
          name="linkTemplate"
          value={editing.linkTemplate ?? ""}
          placeholder="https://jira.example.com/browse/{value}"
          hint="Placeholders: {value}, {repo}, {branch}. Leave empty for no link."
        />
        <FormActions>
          <Button variant="primary" type="submit">
            Save label type
          </Button>
          <Button variant="ghost" href={`/projects/${project.slug}/settings/labels`}>
            Cancel
          </Button>
        </FormActions>
      </form>
    </Card>
  );
}

function CreateLabelTypeCard(props: { project: Project }): Rendered {
  const { project } = props;
  return (
    <Card>
      <SectionTitle level={3}>Create label type</SectionTitle>
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
        <FormActions>
          <Button variant="primary" type="submit" icon="plus">
            Add label type
          </Button>
        </FormActions>
      </form>
    </Card>
  );
}

/** Labels settings tab: label-type table plus the create-type form. */
export function renderSettingsLabels(
  project: Project,
  labelTypes: LabelType[],
  isAdmin: boolean,
  formState?: { globalError?: string; editKey?: string },
): unknown {
  const editing = isAdmin ? labelTypes.find((item) => item.key === formState?.editKey) : undefined;
  return (
    <div class="grid max-w-form">
      {formState?.globalError ? <Alert tone="danger">{formState.globalError}</Alert> : null}
      <LabelTypesCard project={project} labelTypes={labelTypes} isAdmin={isAdmin} />
      {editing ? <EditLabelTypeCard project={project} editing={editing} /> : null}
      {isAdmin ? <CreateLabelTypeCard project={project} /> : null}
    </div>
  );
}
