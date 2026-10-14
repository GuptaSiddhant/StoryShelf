import type { HtmlEscapedString } from "hono/utils/html";
import { Badge, Button, Card, Field, FormActions, Meta, SectionTitle } from "../ui/components.tsx";
import { csrfField } from "../ui/csrf-field.tsx";
import { RemoveForm, type DesignFormState } from "./settings-design-links.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type Rendered = HtmlEscapedString | Promise<HtmlEscapedString>;

/** Last observed outcome of the Figma token. */
export type DesignTokenState = "unknown" | "ok" | "unauthorized" | "forbidden";

/** The project's Figma token as shown to admins: never the value. */
export interface SettingsDesignToken {
  status: DesignTokenState;
  /** Days until the 90-day cap, counted from when the token was set or replaced (negative once past). */
  daysLeft: number;
  checkedAt: string | null;
}

const STATUS_BADGES: Record<
  DesignTokenState,
  { tone: "neutral" | "success" | "warning" | "danger"; text: string }
> = {
  unknown: { tone: "neutral", text: "Not used yet" },
  ok: { tone: "success", text: "Working" },
  unauthorized: { tone: "danger", text: "Expired or revoked" },
  forbidden: { tone: "warning", text: "No access to a linked file" },
};

export function TokenCard(props: {
  base: string;
  token: SettingsDesignToken | null;
  formState?: DesignFormState;
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
  const badge = STATUS_BADGES[token.status];
  const days = token.daysLeft;
  return (
    <>
      <p>
        <Badge tone={badge.tone}>{badge.text}</Badge>{" "}
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
