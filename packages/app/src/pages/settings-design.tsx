import type { Project } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { Alert, EmptyState } from "../ui/components.tsx";
import { CredentialCard, type SettingsDesignProvider } from "./settings-design-credential.tsx";
import {
  ComponentsCard,
  FilesCard,
  type DesignFormState,
  type SettingsDesignComponent,
  type SettingsDesignFile,
} from "./settings-design-links.tsx";

export type { SettingsDesignComponent, SettingsDesignFile } from "./settings-design-links.tsx";
export type {
  DesignCredentialState,
  SettingsDesignCredential,
  SettingsDesignProvider,
} from "./settings-design-credential.tsx";

/** Data behind the Design settings tab. */
export interface SettingsDesignData {
  files: SettingsDesignFile[];
  components: SettingsDesignComponent[];
  /** Configured design providers; empty when the server wires none. */
  providers: SettingsDesignProvider[];
}

/** Design settings tab: project file links, component mapping and provider credentials (admin-only parts gated). */
export function renderSettingsDesign(
  project: Project,
  design: SettingsDesignData,
  isAdmin: boolean,
  formState?: DesignFormState,
): unknown {
  const base = `/projects/${project.slug}/settings/design`;
  const urlHint = design.providers.map((provider) => provider.urlHint).join(" or ");
  if (design.providers.length === 0) {
    return (
      <EmptyState
        title="No design provider configured"
        description="Add a design provider (for example @storyshelf/design-figma) to createShelfApp({ design: [...] }) to link components to design files."
      />
    );
  }
  return (
    <div class="grid max-w-form">
      {formState?.globalError ? <Alert tone="danger">{formState.globalError}</Alert> : null}
      <FilesCard
        base={base}
        files={design.files}
        isAdmin={isAdmin}
        formState={formState}
        urlHint={urlHint}
      />
      {isAdmin ? (
        <ComponentsCard
          base={base}
          components={design.components}
          formState={formState}
          urlHint={urlHint}
        />
      ) : null}
      {isAdmin
        ? design.providers.map((provider): HtmlEscapedString | Promise<HtmlEscapedString> => (
            <CredentialCard
              key={provider.kind}
              base={base}
              provider={provider}
              formState={formState}
            />
          ))
        : null}
    </div>
  );
}
