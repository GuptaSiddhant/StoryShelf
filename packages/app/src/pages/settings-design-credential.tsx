import type { HtmlEscapedString } from "hono/utils/html";
import { Badge, Button, Card, Field, FormActions, Meta, SectionTitle } from "../ui/components.tsx";
import { csrfField } from "../ui/csrf-field.tsx";
import { RemoveForm, type DesignFormState } from "./settings-design-links.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type Rendered = HtmlEscapedString | Promise<HtmlEscapedString>;

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

/** Settings card for one provider's project-wide credential (admin only). */
export function CredentialCard(props: {
  base: string;
  provider: SettingsDesignProvider;
  formState?: DesignFormState;
}): Rendered {
  const { base, provider, formState } = props;
  const action = `${base}/${provider.kind}/token`;
  return (
    <Card>
      <SectionTitle>{provider.credentialLabel}</SectionTitle>
      <Meta>{provider.credentialHelp}</Meta>
      {provider.credential ? (
        <CredentialStatus action={action} provider={provider} credential={provider.credential} />
      ) : (
        <Meta>No credential set.</Meta>
      )}
      <CredentialForm
        action={action}
        provider={provider}
        error={formState?.errors?.[`token:${provider.kind}`]}
      />
    </Card>
  );
}

function CredentialStatus(props: {
  action: string;
  provider: SettingsDesignProvider;
  credential: SettingsDesignCredential;
}): Rendered {
  const { action, provider, credential } = props;
  const badge = STATUS_BADGES[credential.status];
  const days = credential.daysLeft;
  return (
    <>
      <p>
        <Badge tone={badge.tone}>{badge.text}</Badge>{" "}
        {days === null ? null : (
          <Meta as="span">
            {days >= 0
              ? `Rotate within ${days} day${days === 1 ? "" : "s"}`
              : `Past the ${provider.maxAgeDays}-day cap — rotate now`}
          </Meta>
        )}
      </p>
      <RemoveForm
        action={`${action}/delete`}
        confirm={`Remove the ${provider.name} credential?`}
        label={`Remove ${provider.name} credential`}
      />
    </>
  );
}

function CredentialForm(props: {
  action: string;
  provider: SettingsDesignProvider;
  error?: string;
}): Rendered {
  const { action, provider } = props;
  const replace = provider.credential !== null;
  return (
    <form method="post" action={action} hx-post={action} hx-target="body">
      {csrfField()}
      <Field
        label={replace ? "Replace token" : "Token"}
        name="token"
        type="password"
        required
        autocomplete="off"
        placeholder={provider.credentialPlaceholder}
        error={props.error}
      />
      <FormActions>
        <Button variant="primary" type="submit">
          {replace ? "Rotate token" : "Save token"}
        </Button>
      </FormActions>
    </form>
  );
}
