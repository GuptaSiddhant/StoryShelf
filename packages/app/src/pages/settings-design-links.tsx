import type { HtmlEscapedString } from "hono/utils/html";
import { Button, Card, Field, FormActions, Meta, SectionTitle, Table } from "../ui/components.tsx";
import { csrfField } from "../ui/csrf-field.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type Rendered = HtmlEscapedString | Promise<HtmlEscapedString>;

/** Field-level and page-level errors of the Design settings forms. */
export type DesignFormState = { errors?: Record<string, string>; globalError?: string };

/** A project-level design file link (shown in the library header). */
export interface SettingsDesignFile {
  id: string;
  label: string;
  url: string;
}

/** A manual `import_path → URL` component mapping. */
export interface SettingsDesignComponent {
  id: string;
  importPath: string;
  url: string;
}

export function FilesCard(props: {
  base: string;
  files: SettingsDesignFile[];
  isAdmin: boolean;
  formState?: DesignFormState;
  urlHint: string;
}): Rendered {
  const { base, files, isAdmin, formState, urlHint } = props;
  return (
    <Card>
      <SectionTitle>Design files</SectionTitle>
      <Meta>
        Design files for this project. They appear in the library header; individual stories link to
        a design through their component (see below) or their story parameters.
      </Meta>
      <LinkTable
        rows={files.map((file) => ({
          id: file.id,
          key: file.label,
          url: file.url,
          removeAction: isAdmin ? `${base}/files/${file.id}/delete` : undefined,
        }))}
        keyHeading="Label"
        confirm="Remove this design file?"
      />
      {files.length === 0 ? <Meta>No design files linked.</Meta> : null}
      {isAdmin ? (
        <AddFileForm base={base} urlHint={urlHint} error={formState?.errors?.["file"]} />
      ) : null}
    </Card>
  );
}

/** Rows of `key → design link` with an optional remove action. */
function LinkTable(props: {
  rows: { id: string; key: string; url: string; removeAction?: string }[];
  keyHeading: string;
  confirm: string;
}): Rendered {
  return (
    <Table>
      <table>
        <thead>
          <tr>
            <th>{props.keyHeading}</th>
            <th>Design</th>
            <th>
              <span class="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row): Rendered => (
            <tr key={row.id}>
              <td>{row.key}</td>
              <td class="truncate max-w-cell" title={row.url}>
                <a href={row.url} target="_blank" rel="noopener noreferrer">
                  {row.url}
                </a>
              </td>
              <td>
                {row.removeAction ? (
                  <RemoveForm
                    action={row.removeAction}
                    confirm={props.confirm}
                    label={`Remove ${row.key}`}
                  />
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Table>
  );
}

function AddFileForm(props: { base: string; urlHint: string; error?: string }): Rendered {
  const action = `${props.base}/files`;
  return (
    <form method="post" action={action} hx-post={action} hx-target="body">
      {csrfField()}
      <div class="grid grid--2">
        <Field label="Label" name="label" required placeholder="Design system" />
        <Field
          label="Design URL"
          name="url"
          type="url"
          required
          placeholder={props.urlHint}
          error={props.error}
        />
      </div>
      <FormActions>
        <Button variant="primary" type="submit" icon="plus">
          Add design file
        </Button>
      </FormActions>
    </form>
  );
}

export function ComponentsCard(props: {
  base: string;
  components: SettingsDesignComponent[];
  formState?: DesignFormState;
  urlHint: string;
}): Rendered {
  const { base, components, formState, urlHint } = props;
  return (
    <Card>
      <SectionTitle>Component mapping</SectionTitle>
      <Meta>
        Map a story file (its import path) to a design. A manual mapping overrides the story&apos;s
        own <code>storyshelf.figma</code> and <code>design</code> parameters, and survives new
        builds. Mappings are keyed by the story file path, so update one after a file is renamed or
        moved.
      </Meta>
      <LinkTable
        rows={components.map((component) => ({
          id: component.id,
          key: component.importPath,
          url: component.url,
          removeAction: `${base}/components/${component.id}/delete`,
        }))}
        keyHeading="Story file"
        confirm="Remove this mapping?"
      />
      {components.length === 0 ? <Meta>No component mappings.</Meta> : null}
      <MapComponentForm base={base} urlHint={urlHint} error={formState?.errors?.["component"]} />
    </Card>
  );
}

function MapComponentForm(props: { base: string; urlHint: string; error?: string }): Rendered {
  const action = `${props.base}/components`;
  return (
    <form method="post" action={action} hx-post={action} hx-target="body">
      {csrfField()}
      <div class="grid grid--2">
        <Field
          label="Story file"
          name="importPath"
          required
          placeholder="./src/Button.stories.tsx"
        />
        <Field
          label="Design URL"
          name="url"
          type="url"
          required
          placeholder={props.urlHint}
          error={props.error}
        />
      </div>
      <FormActions>
        <Button variant="primary" type="submit" icon="plus">
          Map component
        </Button>
      </FormActions>
    </form>
  );
}

export function RemoveForm(props: { action: string; confirm: string; label: string }): Rendered {
  return (
    <form
      method="post"
      action={props.action}
      hx-post={props.action}
      hx-target="body"
      hx-confirm={props.confirm}
    >
      {csrfField()}
      <Button variant="ghost" size="sm" type="submit" aria-label={props.label}>
        Remove
      </Button>
    </form>
  );
}
