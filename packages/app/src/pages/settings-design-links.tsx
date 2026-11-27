import type { FC } from "hono/jsx";
import { csrfField } from "../shell/csrf-field.tsx";
import {
  Button,
  Card,
  DialogLink,
  Meta,
  SectionTitle,
  SummaryList,
  VStack,
  type SummaryItem,
} from "../ui/components.tsx";
import { ADD_DESIGN_FILE_DIALOG, MAP_COMPONENT_DIALOG } from "./design-forms.tsx";
import { FormDialog } from "./dialog-form.tsx";

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

/** Remove button of a summary row (posts, then asks first). */
export const RemoveForm: FC<{ action: string; confirm: string; label: string }> = (props) => (
  <form
    method="post"
    action={props.action}
    hx-post={props.action}
    hx-target="body"
    hx-confirm={props.confirm}
  >
    {csrfField()}
    <Button variant="danger-secondary" size="sm" type="submit" aria-label={props.label}>
      Remove
    </Button>
  </form>
);

function linkItems(
  rows: { id: string; name: string; url: string; removeAction?: string; confirm: string }[],
): SummaryItem[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    details: row.url,
    actions: row.removeAction ? (
      <RemoveForm action={row.removeAction} confirm={row.confirm} label={`Remove ${row.name}`} />
    ) : undefined,
  }));
}

/** Design files as a summary; linking one opens a dialog. */
export const FilesCard: FC<{
  base: string;
  files: SettingsDesignFile[];
  isAdmin: boolean;
  formState?: DesignFormState;
  urlHint: string;
}> = ({ base, files, isAdmin }) => {
  const add = (primary: boolean): unknown =>
    isAdmin ? (
      <DialogLink
        dialogId={ADD_DESIGN_FILE_DIALOG}
        href={`${base}/files/new`}
        variant={primary ? "primary" : "secondary"}
        size={primary ? "md" : "sm"}
        icon="plus"
      >
        Add design file
      </DialogLink>
    ) : undefined;
  return (
    <VStack>
      <Card>
        <SectionTitle actions={files.length > 0 ? add(false) : null}>Design files</SectionTitle>
        <Meta>
          Design files for this project. They appear in the library header; individual stories link
          to a design through their component (see below) or their story parameters.
        </Meta>
        <SummaryList
          label="Design files"
          items={linkItems(
            files.map((file) => ({
              id: file.id,
              name: file.label,
              url: file.url,
              ...(isAdmin ? { removeAction: `${base}/files/${file.id}/delete` } : {}),
              confirm: "Remove this design file?",
            })),
          )}
          emptyTitle="No design files linked"
          add={add(true)}
        />
      </Card>
      {isAdmin ? (
        <FormDialog
          id={ADD_DESIGN_FILE_DIALOG}
          title="Add design file"
          submitLabel="Add design file"
        />
      ) : null}
    </VStack>
  );
};

/** Component mappings as a summary; mapping one opens a dialog. */
export const ComponentsCard: FC<{
  base: string;
  components: SettingsDesignComponent[];
  formState?: DesignFormState;
  urlHint: string;
}> = ({ base, components }) => {
  const add = (primary: boolean): unknown => (
    <DialogLink
      dialogId={MAP_COMPONENT_DIALOG}
      href={`${base}/components/new`}
      variant={primary ? "primary" : "secondary"}
      size={primary ? "md" : "sm"}
      icon="plus"
    >
      Map component
    </DialogLink>
  );
  return (
    <VStack>
      <Card>
        <SectionTitle actions={components.length > 0 ? add(false) : null}>
          Component mapping
        </SectionTitle>
        <Meta>
          Map a story file (its import path) to a design. A manual mapping overrides the
          story&apos;s own <code>storyshelf.figma</code> and <code>design</code> parameters, and
          survives new builds. Mappings are keyed by the story file path, so update one after a file
          is renamed or moved.
        </Meta>
        <SummaryList
          label="Component design mappings"
          items={linkItems(
            components.map((component) => ({
              id: component.id,
              name: component.importPath,
              url: component.url,
              removeAction: `${base}/components/${component.id}/delete`,
              confirm: "Remove this mapping?",
            })),
          )}
          emptyTitle="No component mappings"
          add={add(true)}
        />
      </Card>
      <FormDialog id={MAP_COMPONENT_DIALOG} title="Map component" submitLabel="Map component" />
    </VStack>
  );
};
