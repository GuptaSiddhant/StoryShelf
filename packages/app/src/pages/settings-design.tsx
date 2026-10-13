import type { Project } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
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
import { csrfField } from "../ui/csrf-field.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type Rendered = HtmlEscapedString | Promise<HtmlEscapedString>;

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

/** The project's Figma token as shown to admins: never the value. */
export interface SettingsDesignToken {
  /** `unknown` | `ok` | `unauthorized` | `forbidden`. */
  status: string;
  /** Days until the 90-day cap (negative once past). */
  daysLeft: number;
  checkedAt: string | null;
}

/** Data behind the Design settings tab. */
export interface SettingsDesignData {
  files: SettingsDesignFile[];
  components: SettingsDesignComponent[];
  token: SettingsDesignToken | null;
}

type FormState = { errors?: Record<string, string>; globalError?: string };

/** Design settings tab: project file links, component mapping and the Figma token (admin-only parts gated). */
export function renderSettingsDesign(
  project: Project,
  design: SettingsDesignData,
  isAdmin: boolean,
  formState?: FormState,
): unknown {
  const base = `/projects/${project.slug}/settings/design`;
  return (
    <div class="grid max-w-form">
      {formState?.globalError ? <Alert tone="danger">{formState.globalError}</Alert> : null}
      <FilesCard base={base} files={design.files} isAdmin={isAdmin} formState={formState} />
      {isAdmin ? (
        <ComponentsCard base={base} components={design.components} formState={formState} />
      ) : null}
      {isAdmin ? <TokenCard base={base} token={design.token} formState={formState} /> : null}
    </div>
  );
}

function RemoveForm(props: { action: string; confirm: string; label: string }): Rendered {
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

function FilesCard(props: {
  base: string;
  files: SettingsDesignFile[];
  isAdmin: boolean;
  formState?: FormState;
}): Rendered {
  const { base, files, isAdmin, formState } = props;
  return (
    <Card>
      <SectionTitle>Design files</SectionTitle>
      <Meta>
        Figma files for this project. They appear in the library header; individual stories link to
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
      {isAdmin ? <AddFileForm base={base} error={formState?.errors?.["file"]} /> : null}
    </Card>
  );
}

/** Rows of `key → Figma link` with an optional remove action. */
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
            <th>Figma</th>
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

function AddFileForm(props: { base: string; error?: string }): Rendered {
  const action = `${props.base}/files`;
  return (
    <form method="post" action={action} hx-post={action} hx-target="body">
      {csrfField()}
      <div class="grid grid--2">
        <Field label="Label" name="label" required placeholder="Design system" />
        <Field
          label="Figma URL"
          name="url"
          type="url"
          required
          placeholder="https://www.figma.com/design/…"
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

function ComponentsCard(props: {
  base: string;
  components: SettingsDesignComponent[];
  formState?: FormState;
}): Rendered {
  const { base, components, formState } = props;
  return (
    <Card>
      <SectionTitle>Component mapping</SectionTitle>
      <Meta>
        Map a story file (its import path) to a Figma node. A manual mapping overrides the
        story&apos;s own <code>storyshelf.figma</code> and <code>design</code> parameters, and
        survives story renames and new builds.
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
      <MapComponentForm base={base} error={formState?.errors?.["component"]} />
    </Card>
  );
}

function MapComponentForm(props: { base: string; error?: string }): Rendered {
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
          label="Figma URL"
          name="url"
          type="url"
          required
          placeholder="https://www.figma.com/design/…?node-id=1-2"
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

const STATUS_BADGES: Record<
  string,
  { tone: "neutral" | "success" | "warning" | "danger"; text: string }
> = {
  unknown: { tone: "neutral", text: "Not used yet" },
  ok: { tone: "success", text: "Working" },
  unauthorized: { tone: "danger", text: "Expired or revoked" },
  forbidden: { tone: "warning", text: "No access to a linked file" },
};

function TokenCard(props: {
  base: string;
  token: SettingsDesignToken | null;
  formState?: FormState;
}): Rendered {
  const { base, token, formState } = props;
  return (
    <Card>
      <SectionTitle>Figma access token</SectionTitle>
      <Meta>
        A personal access token with read access (file content) lets StoryShelf show the design name
        and flag stale designs. Without one, buttons still deep-link to Figma. Figma tokens expire
        after at most 90 days — rotate before then.
      </Meta>
      {token ? <TokenStatus base={base} token={token} /> : <Meta>No token set.</Meta>}
      <TokenForm base={base} replace={token !== null} error={formState?.errors?.["token"]} />
    </Card>
  );
}

function TokenStatus(props: { base: string; token: SettingsDesignToken }): Rendered {
  const { base, token } = props;
  const badge = STATUS_BADGES[token.status] ?? STATUS_BADGES["unknown"];
  const days = token.daysLeft;
  return (
    <>
      <p>
        <Badge tone={badge?.tone ?? "neutral"}>{badge?.text ?? "Unknown"}</Badge>{" "}
        <Meta as="span">
          {days >= 0
            ? `Rotate within ${days} day${days === 1 ? "" : "s"}`
            : "Past the 90-day cap — rotate now"}
        </Meta>
      </p>
      <RemoveForm
        action={`${base}/token/delete`}
        confirm="Remove the Figma token?"
        label="Remove Figma token"
      />
    </>
  );
}

function TokenForm(props: { base: string; replace: boolean; error?: string }): Rendered {
  const action = `${props.base}/token`;
  return (
    <form method="post" action={action} hx-post={action} hx-target="body">
      {csrfField()}
      <Field
        label={props.replace ? "Replace token" : "Token"}
        name="token"
        type="password"
        required
        autocomplete="off"
        placeholder="figd_…"
        error={props.error}
      />
      <FormActions>
        <Button variant="primary" type="submit">
          {props.replace ? "Rotate token" : "Save token"}
        </Button>
      </FormActions>
    </form>
  );
}
