import { createUrlBuilder } from "@storyshelf/core/urls";
import type { HtmlEscapedString } from "hono/utils/html";
import { Badge, Button, HStack } from "../ui/components.tsx";

/** A linked package a story uses, resolved against its upstream project. */
export interface LinkedUsageItem {
  package: string;
  version: string | null;
  upstreamSlug: string;
  /** Latest approved default build of the upstream project, when it has one. */
  upstreamBuildId: string | null;
  /** Upstream story the package module maps to; null when nothing matched. */
  upstreamStoryId: string | null;
}

/** Deep link to the upstream component's published story (or its Storybook root). */
export function upstreamPreviewUrl(
  item: LinkedUsageItem,
  publishedBaseDomain?: string,
): string | null {
  if (!item.upstreamBuildId) {
    return null;
  }
  const base = createUrlBuilder("/", publishedBaseDomain).storybookBuild(
    item.upstreamSlug,
    item.upstreamBuildId,
  );
  return item.upstreamStoryId
    ? `${base}?storyId=${encodeURIComponent(item.upstreamStoryId)}`
    : base;
}

/** "Uses @acme/ds v2.4.0" provenance badge with Preview and History deep links. */
export function LinkedUsage(props: {
  usage: LinkedUsageItem[];
  publishedBaseDomain?: string;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const urls = createUrlBuilder("/", props.publishedBaseDomain);
  return (
    <>
      {props.usage.map((item): HtmlEscapedString | Promise<HtmlEscapedString> => {
        const preview = upstreamPreviewUrl(item, props.publishedBaseDomain);
        return (
          <HStack key={item.package} wrap={false}>
            <Badge tone="info">
              Uses {item.package}
              {item.version ? ` v${item.version}` : ""}
            </Badge>
            {preview ? (
              <Button variant="ghost" size="sm" href={preview} target="_blank" rel="noreferrer">
                Preview
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              href={urls.library(item.upstreamSlug)}
              target="_blank"
              rel="noreferrer"
            >
              History
            </Button>
          </HStack>
        );
      })}
    </>
  );
}
