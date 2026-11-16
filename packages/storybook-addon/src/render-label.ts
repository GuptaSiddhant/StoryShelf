/** The sidebar label: the story's name followed by its badges, each linking to the review. */
import {
  createElement,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { badgesOf, type Badge, type Tone } from "./badge.ts";
import type { BadgeStore } from "./store.ts";

/** The part of a sidebar entry the label needs. */
export interface LabelItem {
  id: string;
  type: string;
  name: string;
}

/** What Storybook's `sidebar.renderLabel` option takes. */
export type LabelRenderer = (item: LabelItem) => ReactNode;

const COLORS: Readonly<Record<Tone, { background: string; color: string }>> = {
  neutral: { background: "rgba(128,128,128,0.18)", color: "inherit" },
  good: { background: "rgba(40,167,69,0.2)", color: "inherit" },
  warn: { background: "rgba(255,153,0,0.25)", color: "inherit" },
  bad: { background: "rgba(220,53,69,0.25)", color: "inherit" },
};

/** One badge as a link-role span (exported for its handler test). */
export function badgeElement(
  badge: Badge,
  reviewUrl: string,
  open: (url: string) => void,
): ReactNode {
  // Not an anchor: the sidebar row is already a link, and a click here must not select the story.
  const go = (event: MouseEvent | KeyboardEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    open(reviewUrl);
  };
  return createElement(
    "span",
    {
      key: badge.label,
      role: "link",
      tabIndex: 0,
      title: `${badge.label}: open the review`,
      onClick: go,
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === "Enter") go(event);
      },
      style: {
        ...COLORS[badge.tone],
        marginLeft: 6,
        padding: "0 6px",
        borderRadius: 8,
        fontSize: 10,
        cursor: "pointer",
        whiteSpace: "nowrap",
      },
    },
    badge.label,
  );
}

interface StoryLabelProps {
  item: LabelItem;
  store: BadgeStore;
  open: (url: string) => void;
}

/** One story's label. It re-renders itself when the status arrives, so the index need not reload. */
function StoryLabel({ item, store, open }: StoryLabelProps): ReactNode {
  const state = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.get(),
    () => store.get(),
  );
  const entry = state?.status.stories[item.id];
  if (!state || !entry) return item.name;
  const badges = badgesOf(entry).map((badge) => badgeElement(badge, state.reviewUrl, open));
  return createElement("span", null, item.name, ...badges);
}

/**
 * The label renderer. Storybook reads it once, when the story index arrives, so it must already be
 * in place before the status is known: each story's label subscribes to `store`. Entries other than
 * stories, and stories the answer does not list (no snapshot), keep their plain name.
 */
export function createLabelRenderer(store: BadgeStore, open: (url: string) => void): LabelRenderer {
  return (item) =>
    item.type === "story" ? createElement(StoryLabel, { item, store, open }) : item.name;
}
