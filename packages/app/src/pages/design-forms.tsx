import type { Project } from "@storyshelf/core/schema";
import type { FC } from "hono/jsx";
import { Alert, Field } from "../ui/components.tsx";
import { DialogForm } from "./dialog-form.tsx";

/** Dialog ids of the design forms. */
export const ADD_DESIGN_FILE_DIALOG = "add-design-file";
export const MAP_COMPONENT_DIALOG = "map-component";
export const DESIGN_TOKEN_DIALOG = "design-token";

interface LinkFormProps {
  project: Project;
  standalone: boolean;
  urlHint: string;
  error?: string | undefined;
}

const designBack = (project: Project): string =>
  `/projects/${project.slug}/settings/capture#design`;

/** Link a design file to the project. */
export const AddDesignFileForm: FC<LinkFormProps> = ({ project, standalone, urlHint, error }) => {
  return (
    <DialogForm
      dialog={ADD_DESIGN_FILE_DIALOG}
      action={`/projects/${project.slug}/settings/design/files`}
      submitLabel="Add design file"
      standalone={standalone}
      backHref={designBack(project)}
    >
      <Field label="Label" name="label" required placeholder="Design system" />
      <Field
        label="Design URL"
        name="url"
        type="url"
        required
        placeholder={urlHint}
        error={error}
      />
    </DialogForm>
  );
};

/** Map a story file to a design. */
export const MapComponentForm: FC<LinkFormProps> = ({ project, standalone, urlHint, error }) => {
  return (
    <DialogForm
      dialog={MAP_COMPONENT_DIALOG}
      action={`/projects/${project.slug}/settings/design/components`}
      submitLabel="Map component"
      standalone={standalone}
      backHref={designBack(project)}
    >
      <Field label="Story file" name="importPath" required placeholder="./src/Button.stories.tsx" />
      <Field
        label="Design URL"
        name="url"
        type="url"
        required
        placeholder={urlHint}
        error={error}
      />
    </DialogForm>
  );
};

/** Set or replace one provider's project token. */
export const DesignTokenForm: FC<{
  project: Project;
  provider: { kind: string; name: string; credentialLabel: string; placeholder?: string };
  replace: boolean;
  standalone: boolean;
  error?: string | undefined;
}> = ({ project, provider, replace, standalone, error }) => {
  return (
    <DialogForm
      dialog={DESIGN_TOKEN_DIALOG}
      action={`/projects/${project.slug}/settings/design/${provider.kind}/token`}
      submitLabel={replace ? "Rotate token" : "Save token"}
      standalone={standalone}
      backHref={designBack(project)}
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field
        label={`${provider.name}: ${replace ? "replace token" : "token"}`}
        name="token"
        type="password"
        required
        autocomplete="off"
        placeholder={provider.placeholder}
        hint={provider.credentialLabel}
      />
    </DialogForm>
  );
};
