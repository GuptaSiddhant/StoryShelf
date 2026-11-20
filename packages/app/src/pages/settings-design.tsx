import type { Project } from "@storyshelf/core/schema";
import { Alert, VStack } from "../ui/components.tsx";
import { UnofferedNotice, type UnofferedIntegrationView } from "./integrations-unoffered.tsx";
import { CredentialsSection, type SettingsDesignProvider } from "./settings-design-credential.tsx";
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

/**
 * Design settings tab: project file links, component mapping and provider credentials (admin-only
 * parts gated). With no provider offered (issue #1126), a site admin sees one line naming what is
 * missing (`unoffered`, site admins only) and everyone else sees nothing.
 */
export function renderSettingsDesign(
  project: Project,
  design: SettingsDesignData,
  isAdmin: boolean,
  formState?: DesignFormState,
  unoffered?: readonly UnofferedIntegrationView[],
): unknown {
  const base = `/projects/${project.slug}/settings/design`;
  const urlHint = design.providers.map((provider) => provider.urlHint).join(" or ");
  if (design.providers.length === 0) {
    return <UnofferedNotice area="Design tools are" integrations={unoffered} />;
  }
  return (
    <VStack>
      <UnofferedNotice area="Some design tools are" integrations={unoffered} />
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
      {isAdmin ? <CredentialsSection base={base} providers={design.providers} /> : null}
    </VStack>
  );
}
