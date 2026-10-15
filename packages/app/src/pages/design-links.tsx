import type { HtmlEscapedString } from "hono/utils/html";
import {
  Alert,
  Button,
  DesignPreview,
  DesignReference,
  Dropdown,
  DropdownItem,
  HStack,
  Meta,
} from "../ui/components.tsx";
import { csrfField } from "../ui/csrf-field.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type Rendered = HtmlEscapedString | Promise<HtmlEscapedString>;

/** "Connect your own account" state for a provider whose project has no shared credential. */
export interface DesignConnect {
  /** `connect` (not connected), `reconnect` (connection expired) or `connected`. */
  state: "connect" | "reconnect" | "connected";
  startUrl: string;
  disconnectUrl: string;
  returnTo: string;
}

/** A design link a component resolves to, with cached provider metadata when available. */
export interface DesignItem {
  url: string;
  /** Display name of the provider that owns the link ("Figma"). */
  providerName: string;
  /** Design node/file name from the metadata cache. */
  name: string | null;
  /** Cache state: `ok` | `deleted` | `unauthorized` | `forbidden` | `unknown` (nothing cached). */
  state: string;
  /** API URL of the cached render, when one exists. */
  renderUrl: string | null;
  /** The design changed after the baseline it is compared with was approved. */
  stale: boolean;
  /** Offer to connect the viewer's own account; absent when not applicable. */
  connect?: DesignConnect;
}

/** Cached name and render of a design link, for library popovers. */
export interface DesignPreviewInfo {
  name: string | null;
  renderUrl: string | null;
}

/** A project-level design file link for the library header. */
export interface ProjectDesignLink {
  label: string;
  url: string;
}

/**
 * Design actions for a component's link(s). A link with a cached render opens a
 * click popover (preview + `Open in <provider>`); others are plain deep links.
 */
export function DesignButtons(props: {
  urls: readonly string[];
  /** Display name of the provider that owns a link. */
  providerName: (url: string) => string;
  previews?: ReadonlyMap<string, DesignPreviewInfo>;
  /** Component page of the story, offered in the popover as `View component →`. */
  componentHref?: string;
  size?: "sm" | "md";
}): Rendered {
  const { urls, providerName, previews, componentHref, size = "sm" } = props;
  return (
    <>
      {urls.map((url, index): Rendered => {
        const name = providerName(url);
        const label = urls.length > 1 ? `${name} ${index + 1}` : name;
        const preview = previews?.get(url);
        return preview?.renderUrl ? (
          <Dropdown key={url} label={label}>
            <DesignPreview src={preview.renderUrl} name={preview.name} providerName={name} />
            <DropdownItem href={url} icon="external-link" target="_blank" rel="noopener noreferrer">
              Open in {name}
            </DropdownItem>
            {componentHref ? (
              <DropdownItem href={componentHref}>View component →</DropdownItem>
            ) : null}
          </Dropdown>
        ) : (
          <Button
            key={url}
            variant="ghost"
            size={size}
            icon="external-link"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {label}
          </Button>
        );
      })}
    </>
  );
}

/** Reference panes (cached renders) for the review page, shown under the diff stage. */
export function DesignReferences(props: { items: DesignItem[] }): Rendered {
  return (
    <>
      {props.items.map((item): Rendered | null =>
        item.renderUrl ? (
          <DesignReference
            key={item.url}
            src={item.renderUrl}
            name={item.name}
            href={item.url}
            providerName={item.providerName}
          />
        ) : null,
      )}
    </>
  );
}

/** Review-page design strip: open-in-provider actions plus non-blocking stale/deleted notices. */
export function DesignStrip(props: { items: DesignItem[] }): Rendered {
  const { items } = props;
  return (
    <>
      <HStack>
        {items.map((item): Rendered => (
          <HStack key={item.url} wrap={false}>
            <Button
              variant="secondary"
              size="sm"
              icon="external-link"
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in {item.providerName}
            </Button>
            {item.name ? <Meta as="span">{item.name}</Meta> : null}
          </HStack>
        ))}
      </HStack>
      {items.map((item): Rendered | null => designNotice(item))}
      {connectPrompts(items)}
    </>
  );
}

/** One connect/disconnect prompt per provider (several links of one provider share it). */
function connectPrompts(items: DesignItem[]): Rendered[] {
  const byProvider = new Map(
    items.flatMap((item) => (item.connect ? [[item.providerName, item] as const] : [])),
  );
  return [...byProvider.values()].map((item): Rendered => connectPrompt(item, item.connect));
}

function connectPrompt(item: DesignItem, connect: DesignConnect | undefined): Rendered {
  if (!connect) return <></>;
  if (connect.state === "connected") {
    return (
      <form key={item.providerName} method="post" action={connect.disconnectUrl}>
        {csrfField()}
        <input type="hidden" name="return" value={connect.returnTo} />
        <HStack wrap={false}>
          <Meta as="span">Previews use your {item.providerName} account.</Meta>
          <Button variant="ghost" size="sm" type="submit">
            Disconnect
          </Button>
        </HStack>
      </form>
    );
  }
  return (
    <Alert
      key={item.providerName}
      tone={connect.state === "reconnect" ? "warning" : "info"}
      title={
        connect.state === "reconnect"
          ? `Your ${item.providerName} connection expired`
          : `Connect ${item.providerName} for design previews`
      }
    >
      Sign in with your own {item.providerName} account to see names, previews and stale-design
      warnings. Only you will see what your account can open.{" "}
      <Button variant="secondary" size="sm" href={connect.startUrl}>
        {connect.state === "reconnect" ? "Reconnect" : "Connect"} {item.providerName}
      </Button>
    </Alert>
  );
}

function designNotice(item: DesignItem): Rendered | null {
  if (item.state === "deleted") {
    return (
      <Alert key={item.url} tone="warning" title="Design not found">
        The linked {item.providerName} file or node no longer exists. Update the link in the
        project&apos;s Design settings.
      </Alert>
    );
  }
  if (item.stale) {
    return (
      <Alert key={item.url} tone="warning" title="Design changed since this baseline was approved">
        {item.name ? `${item.name} was` : "The linked design was"} edited in {item.providerName}{" "}
        after the baseline. This does not block review.
      </Alert>
    );
  }
  if (item.state === "unauthorized" || item.state === "forbidden") {
    return (
      <Meta key={item.url} as="div">
        {item.state === "unauthorized"
          ? `The project's ${item.providerName} credential is expired or revoked — design status is unavailable.`
          : `The project's ${item.providerName} credential cannot open this file — design status is unavailable.`}
      </Meta>
    );
  }
  return null;
}

/** Library header links to the project's design files. */
export function ProjectDesignLinks(props: { links: ProjectDesignLink[] }): Rendered {
  return (
    <HStack>
      {props.links.map((link): Rendered => (
        <Button
          key={link.url}
          variant="ghost"
          size="sm"
          icon="external-link"
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {link.label}
        </Button>
      ))}
    </HStack>
  );
}
