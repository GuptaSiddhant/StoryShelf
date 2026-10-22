import type { ResolvedPublicOrigin, StoredPublicOrigin } from "@storyshelf/core/models";
import type { HtmlEscapedString } from "hono/utils/html";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  FormActions,
  HStack,
  Meta,
  SectionTitle,
} from "../ui/components.tsx";
import { csrfField } from "../ui/csrf-field.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

/** What the System page knows about the public origin. */
export interface PublicOriginView {
  /** What background jobs use now; `null` when nothing resolves. */
  resolved: ResolvedPublicOrigin | null;
  /** The origin an admin's browser reported; `null` when none did. */
  stored: StoredPublicOrigin | null;
  /** Whether this deployment can learn an origin from an admin's browser (authentication is on). */
  learns: boolean;
}

const SOURCE_LABELS = {
  config: "configured (PUBLIC_BASE_URL)",
  platform: "detected from the hosting platform",
  admin: "detected from your browser",
} as const;

/** Where absolute links in emails, commit statuses and signed Storybook URLs point (ADR 0007). */
export function PublicOriginCard(props: {
  origin: PublicOriginView;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { resolved, stored, learns } = props.origin;
  // A configured or platform origin outranks what a browser reports, so there is nothing to learn.
  const reports = learns && (resolved === null || resolved.source === "admin");
  return (
    <Card>
      <SectionTitle>Public origin</SectionTitle>
      <Meta>
        The address links in emails, commit statuses and signed Storybook URLs use. It comes from{" "}
        <code>PUBLIC_BASE_URL</code>, then the hosting platform, then the address an admin used to
        open this page.
      </Meta>
      {resolved === null ? <NothingResolved learns={learns} /> : <Resolved resolved={resolved} />}
      {reports ? <div data-report-origin="/admin/public-origin/report" /> : null}
      {learns && stored !== null ? <StoredForm stored={stored} /> : null}
      {learns && stored === null ? <EnterForm /> : null}
    </Card>
  );
}

function NothingResolved(props: {
  learns: boolean;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  return (
    <Alert tone="warning" title="No public origin is known">
      Links in commit statuses and emails are left out, and browsers that reach the Storybook by URL
      stay unavailable.{" "}
      {props.learns
        ? "Reload this page: it reports the address you opened it with."
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
      <Badge tone={resolved.confirmed ? "success" : "info"}>{SOURCE_LABELS[resolved.source]}</Badge>
      {resolved.source === "admin" && !resolved.confirmed ? (
        <Badge tone="warning">unconfirmed</Badge>
      ) : null}
    </HStack>
  );
}

/** Confirm the detected origin, replace it, or drop it. */
function StoredForm(props: {
  stored: StoredPublicOrigin;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { stored } = props;
  return (
    <>
      <form
        method="post"
        action="/admin/public-origin"
        hx-post="/admin/public-origin"
        hx-target="body"
      >
        {csrfField()}
        <Field
          label="Stored origin"
          name="origin"
          value={stored.origin}
          hint={
            stored.confirmed
              ? "Confirmed. Change it if this is not the address people use."
              : "Detected from your browser. Confirm it, or enter the address people use."
          }
        />
        <FormActions>
          <Button type="submit" variant="secondary" size="sm">
            {stored.confirmed ? "Save" : "Confirm"}
          </Button>
        </FormActions>
      </form>
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
    </>
  );
}

/** Enter an origin by hand when none was reported. */
function EnterForm(): HtmlEscapedString | Promise<HtmlEscapedString> {
  return (
    <form
      method="post"
      action="/admin/public-origin"
      hx-post="/admin/public-origin"
      hx-target="body"
    >
      {csrfField()}
      <Field label="Origin" name="origin" placeholder="https://shelf.example.com" />
      <FormActions>
        <Button type="submit" variant="secondary" size="sm">
          Save
        </Button>
      </FormActions>
    </form>
  );
}
