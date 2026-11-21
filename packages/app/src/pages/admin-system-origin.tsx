import type { ResolvedPublicOrigin, StoredPublicOrigin } from "@storyshelf/core/models";
import type { HtmlEscapedString } from "hono/utils/html";
import { csrfField } from "../shell/csrf-field.tsx";
import {
  Alert,
  Badge,
  Button,
  Card,
  DialogLink,
  HStack,
  Meta,
  SectionTitle,
} from "../ui/components.tsx";
import { FormDialog } from "./dialog-form.tsx";
import { EDIT_ORIGIN_DIALOG } from "./public-origin-forms.tsx";
/** What the System page knows about the public origin. */
export interface PublicOriginView {
  /** What background jobs use now (configured, platform or confirmed); `null` when nothing is confirmed. */
  resolved: ResolvedPublicOrigin | null;
  /** The origin an admin's browser reported; `null` when none did. */
  stored: StoredPublicOrigin | null;
  /** Whether this deployment can learn an origin from an admin's browser (authentication is on). */
  learns: boolean;
}

const SOURCE_LABELS = {
  config: "configured (PUBLIC_BASE_URL)",
  platform: "detected from the hosting platform",
  admin: "confirmed by an admin",
} as const;

/** Where absolute links in emails, commit statuses and signed Storybook URLs point (ADR 0007). */
export function PublicOriginCard(props: {
  origin: PublicOriginView;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { resolved, stored, learns } = props.origin;
  // A configured or platform origin outranks what a browser reports: there is nothing to learn or
  // to confirm, so neither the beacon nor the forms are offered (#315).
  const fixed = resolved !== null && resolved.source !== "admin";
  const reports = learns && !fixed;
  return (
    <Card>
      <SectionTitle>Public origin</SectionTitle>
      <Meta>
        The address links in emails, commit statuses and signed Storybook URLs use. It comes from{" "}
        <code>PUBLIC_BASE_URL</code>, then the hosting platform, then an address an admin confirmed
        here. An address detected from a browser is used for none of these until it is confirmed;
        sign-in (OAuth redirects) may use the address of the request itself.
      </Meta>
      {resolved === null ? (
        <NothingResolved learns={learns} stored={stored} />
      ) : (
        <Resolved resolved={resolved} />
      )}
      {reports ? <div data-report-origin="/admin/public-origin/report" /> : null}
      {fixed ? null : <OriginActions learns={learns} stored={stored} />}
    </Card>
  );
}

/** Edit (or confirm, or enter) opens a dialog; forgetting a stored origin asks first. */
function OriginActions(props: {
  learns: boolean;
  stored: StoredPublicOrigin | null;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { learns, stored } = props;
  if (!learns) {
    return <></>;
  }
  const label = stored === null ? "Enter origin" : stored.confirmed ? "Edit" : "Confirm";
  return (
    <HStack>
      <DialogLink
        dialogId={EDIT_ORIGIN_DIALOG}
        href="/admin/public-origin/edit"
        variant="secondary"
        size="sm"
      >
        {label}
      </DialogLink>
      {stored === null ? null : (
        <form
          method="post"
          action="/admin/public-origin/clear"
          hx-post="/admin/public-origin/clear"
          hx-target="body"
        >
          {csrfField()}
          <Button type="submit" variant="secondary" size="sm">
            Forget stored origin
          </Button>
        </form>
      )}
      <FormDialog
        id={EDIT_ORIGIN_DIALOG}
        title="Public origin"
        submitLabel={label === "Confirm" ? "Confirm" : "Save"}
      />
    </HStack>
  );
}

function NothingResolved(props: {
  learns: boolean;
  stored: StoredPublicOrigin | null;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  if (props.stored !== null && !props.stored.confirmed) {
    return (
      <Alert tone="warning" title="Public origin detected, not confirmed">
        <code>{props.stored.origin}</code> was detected from your browser. Confirm it to enable
        notifications and signed Storybook URLs: until then no commit status or email is sent, and
        browsers that reach the Storybook by URL stay unavailable.
      </Alert>
    );
  }
  return (
    <Alert tone="warning" title="No public origin is known">
      Notifications are paused, and browsers that reach the Storybook by URL stay unavailable.{" "}
      {props.learns
        ? "Reload this page: it reports the address you opened it with, for you to confirm."
        : "Set PUBLIC_BASE_URL, or turn authentication on so an admin's browser can report it."}
    </Alert>
  );
}

function Resolved(props: {
  resolved: ResolvedPublicOrigin;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { resolved } = props;
  return (
    <HStack>
      <code>{resolved.url}</code>
      <Badge tone="success">{SOURCE_LABELS[resolved.source]}</Badge>
      {resolved.source === "admin" ? null : <Meta>Nothing to confirm.</Meta>}
    </HStack>
  );
}
