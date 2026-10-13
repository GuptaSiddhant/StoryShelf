import type { HtmlEscapedString } from "hono/utils/html";
import { Alert, Button, HStack, Meta } from "../ui/components.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type Rendered = HtmlEscapedString | Promise<HtmlEscapedString>;

/** A design link a component resolves to, with cached Figma metadata when available. */
export interface DesignItem {
  url: string;
  /** Figma node/file name from the metadata cache. */
  name: string | null;
  /** Cache state: `ok` | `deleted` | `unauthorized` | `forbidden` | `unknown` (nothing cached). */
  state: string;
  /** The design changed after the baseline it is compared with was approved. */
  stale: boolean;
}

/** A project-level design file link for the library header. */
export interface ProjectDesignLink {
  label: string;
  url: string;
}

/** `Open in Figma` actions for a component's design link(s); renders nothing without links. */
export function DesignButtons(props: { urls: readonly string[]; size?: "sm" | "md" }): Rendered {
  const { urls, size = "sm" } = props;
  return (
    <>
      {urls.map((url, index): Rendered => (
        <Button
          key={url}
          variant="ghost"
          size={size}
          icon="external-link"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {urls.length > 1 ? `Figma ${index + 1}` : "Figma"}
        </Button>
      ))}
    </>
  );
}

/** Review-page design strip: open-in-Figma actions plus non-blocking stale/deleted notices. */
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
              Open in Figma
            </Button>
            {item.name ? <Meta as="span">{item.name}</Meta> : null}
          </HStack>
        ))}
      </HStack>
      {items.map((item): Rendered | null => designNotice(item))}
    </>
  );
}

function designNotice(item: DesignItem): Rendered | null {
  if (item.state === "deleted") {
    return (
      <Alert key={item.url} tone="warning" title="Design not found">
        The linked Figma file or node no longer exists. Update the link in the project&apos;s Design
        settings.
      </Alert>
    );
  }
  if (item.stale) {
    return (
      <Alert key={item.url} tone="warning" title="Design changed since this baseline was approved">
        {item.name ? `${item.name} was` : "The linked design was"} edited in Figma after the
        baseline. This does not block review.
      </Alert>
    );
  }
  if (item.state === "unauthorized" || item.state === "forbidden") {
    return (
      <Meta key={item.url} as="div">
        {item.state === "unauthorized"
          ? "The project's Figma token is expired or revoked — design status is unavailable."
          : "The project's Figma token cannot open this file — design status is unavailable."}
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
