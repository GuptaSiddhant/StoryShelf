/**
 * The comment box with `@` member suggestions (#463). Server-rendered, no client script: while
 * typing, the box posts its text to `mention-suggest`, which answers with the members the text
 * is pointing at; choosing one posts the text and the member to `mention-complete`, which answers
 * with the box again, the handle filled in.
 */
import type { HtmlEscapedString } from "hono/utils/html";
import type { MentionSuggestion } from "../mentions.ts";
import { Button, Meta, TextareaField, VStack } from "../ui/components.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type Rendered = HtmlEscapedString | Promise<HtmlEscapedString>;

/** What a comment box is for: the whole build, one story, or one snapshot. */
export type CommentFieldKind = "build" | "story" | "snapshot";

export const COMMENT_FIELD_KINDS: readonly CommentFieldKind[] = ["build", "story", "snapshot"];

const FIELDS: Record<CommentFieldKind, { id: string; label: string; placeholder: string }> = {
  build: {
    id: "build-comment-body",
    label: "Add build comment",
    placeholder: "Leave a comment on this build…",
  },
  story: {
    id: "story-comment-body",
    label: "Add story comment",
    placeholder: "Leave a comment on this story…",
  },
  snapshot: {
    id: "snapshot-comment-body",
    label: "Add comment",
    placeholder: "Leave feedback on this snapshot…",
  },
};

/** Where the suggest and complete routes of a build are. */
function mentionUrls(slug: string, buildId: string): { suggest: string; complete: string } {
  const base = `/projects/${slug}/builds/${buildId}`;
  return { suggest: `${base}/mention-suggest`, complete: `${base}/mention-complete` };
}

/** The comment text box, and the place its member suggestions appear. */
export function CommentBodyField(props: {
  slug: string;
  buildId: string;
  kind: CommentFieldKind;
  /** The text to show, when the box is re-rendered with a handle filled in. */
  value?: string;
}): Rendered {
  const { slug, buildId, kind, value } = props;
  const field = FIELDS[kind];
  return (
    <div
      id={`${field.id}-field`}
      hx-post={mentionUrls(slug, buildId).suggest}
      hx-trigger="input from:find textarea delay:250ms"
      hx-include="find textarea"
      hx-vals={JSON.stringify({ kind })}
      hx-target={`#${field.id}-mentions`}
      hx-swap="innerHTML"
    >
      <TextareaField
        label={field.label}
        name="body"
        id={field.id}
        rows={3}
        required
        placeholder={field.placeholder}
        {...(value === undefined ? {} : { value })}
      />
      <div id={`${field.id}-mentions`} aria-live="polite" />
    </div>
  );
}

/** The members the text is pointing at, each a button that fills their handle into the box. */
export function MentionSuggestions(props: {
  slug: string;
  buildId: string;
  kind: CommentFieldKind;
  suggestions: readonly MentionSuggestion[];
}): Rendered {
  const { slug, buildId, kind, suggestions } = props;
  const fieldId = FIELDS[kind].id;
  return (
    <VStack>
      <Meta>Mention a member</Meta>
      {suggestions.map((suggestion): Rendered => (
        <Button
          key={suggestion.userId}
          variant="ghost"
          size="sm"
          type="button"
          hx-post={mentionUrls(slug, buildId).complete}
          hx-include={`#${fieldId}`}
          hx-vals={JSON.stringify({ kind, pick: suggestion.userId })}
          hx-target={`#${fieldId}-field`}
          hx-swap="outerHTML"
        >
          @{suggestion.handle} <span class="muted">{suggestion.name}</span>
        </Button>
      ))}
    </VStack>
  );
}
