import type { Project } from "@storyshelf/core/schema";
import { Alert } from "../ui/components.tsx";
import {
  ComponentsCard,
  FilesCard,
  type DesignFormState,
  type SettingsDesignComponent,
  type SettingsDesignFile,
} from "./settings-design-links.tsx";
import { TokenCard, type SettingsDesignToken } from "./settings-design-token.tsx";

export type { SettingsDesignComponent, SettingsDesignFile } from "./settings-design-links.tsx";
export type { SettingsDesignToken } from "./settings-design-token.tsx";

/** Data behind the Design settings tab. */
export interface SettingsDesignData {
  files: SettingsDesignFile[];
  components: SettingsDesignComponent[];
  token: SettingsDesignToken | null;
}

/** Design settings tab: project file links, component mapping and the Figma token (admin-only parts gated). */
export function renderSettingsDesign(
  project: Project,
  design: SettingsDesignData,
  isAdmin: boolean,
  formState?: DesignFormState,
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
