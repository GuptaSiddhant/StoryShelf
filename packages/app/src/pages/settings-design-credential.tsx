import type { FC } from "hono/jsx";
import {
  Card,
  DialogLink,
  SectionTitle,
  SummaryList,
  VStack,
  type SummaryItem,
} from "../ui/components.tsx";
import { DESIGN_TOKEN_DIALOG } from "./design-forms.tsx";
import { FormDialog } from "./dialog-form.tsx";
import { RemoveForm } from "./settings-design-links.tsx";

/** Last observed outcome of a design credential. */
export type DesignCredentialState = "unknown" | "ok" | "unauthorized" | "forbidden";

/** A stored credential as shown to admins: never the value. */
export interface SettingsDesignCredential {
  status: DesignCredentialState;
  /** Days until the provider's maximum credential age, counted from when it was set or replaced (negative once past); null without a limit. */
  daysLeft: number | null;
  checkedAt: string | null;
}

/** A configured design provider with its (optional) project credential. */
export interface SettingsDesignProvider {
  kind: string;
  name: string;
  credentialLabel: string;
  credentialHelp: string;
  credentialPlaceholder?: string;
  urlHint: string;
  /** Provider's maximum credential lifetime in days, when it has one. */
  maxAgeDays?: number;
  credential: SettingsDesignCredential | null;
}

const STATUS_BADGES: Record<
  DesignCredentialState,
  { tone: "neutral" | "success" | "warning" | "danger"; text: string }
> = {
  unknown: { tone: "neutral", text: "Not used yet" },
  ok: { tone: "success", text: "Working" },
  unauthorized: { tone: "danger", text: "Expired or revoked" },
  forbidden: { tone: "warning", text: "No access to a linked file" },
};

function credentialDetails(provider: SettingsDesignProvider): string {
  const { credential } = provider;
  if (credential === null) {
    return `No credential set. ${provider.credentialHelp}`;
  }
  const days = credential.daysLeft;
  if (days === null) {
    return provider.credentialHelp;
  }
  return days >= 0
    ? `Rotate within ${days} day${days === 1 ? "" : "s"}`
    : `Past the ${provider.maxAgeDays}-day cap — rotate now`;
}

/** Each provider's project-wide credential as a summary row (admin only); Set or Rotate opens a dialog. */
export const CredentialsSection: FC<{
  base: string;
  providers: SettingsDesignProvider[];
}> = ({ base, providers }) => {
  const items: SummaryItem[] = providers.map((provider) => ({
    id: provider.kind,
    name: provider.credentialLabel,
    state: provider.credential
      ? {
          label: STATUS_BADGES[provider.credential.status].text,
          tone: STATUS_BADGES[provider.credential.status].tone,
        }
      : { label: "Not set", tone: "neutral" },
    details: credentialDetails(provider),
    actions: (
      <>
        <DialogLink
          dialogId={DESIGN_TOKEN_DIALOG}
          href={`${base}/${provider.kind}/token/edit`}
          variant="secondary"
          size="sm"
          aria-label={`${provider.credential ? "Rotate" : "Set"} ${provider.name} token`}
        >
          {provider.credential ? "Rotate token" : "Set token"}
        </DialogLink>
        {provider.credential ? (
          <RemoveForm
            action={`${base}/${provider.kind}/token/delete`}
            confirm={`Remove the ${provider.name} credential?`}
            label={`Remove ${provider.name} credential`}
          />
        ) : null}
      </>
    ),
  }));
  return (
    <VStack gap="lg">
      <Card>
        <SectionTitle>Design tokens</SectionTitle>
        <SummaryList label="Design tokens" items={items} emptyTitle="No design providers" />
      </Card>
      <FormDialog id={DESIGN_TOKEN_DIALOG} title="Design token" submitLabel="Save token" />
    </VStack>
  );
};
