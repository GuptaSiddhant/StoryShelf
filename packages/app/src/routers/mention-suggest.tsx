/**
 * The `@` suggestions of the comment box (#463): two HTMX fragments, both `review` routes that
 * need the right to comment. They only ever read the project's own members, so a suggestion never
 * reveals who belongs to another project, and a member who cannot comment gets none.
 */
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ShelfRouter } from "../app-types.ts";
import {
  completeMention,
  mentionCandidates,
  suggestMembers,
  typedMention,
  type MentionSuggestion,
  type TypedMention,
} from "../mentions.ts";
import {
  COMMENT_FIELD_KINDS,
  CommentBodyField,
  MentionSuggestions,
  type CommentFieldKind,
} from "../pages/comment-body-field.tsx";
import { getStore } from "../store.ts";
import { DEVELOPER_ROLES, buildForProject } from "./builds.handlers.ts";
import { resolveAuthorizedProject } from "./helpers.ts";

/** A comment is at most this long (see `commentCreateSchema`); the box's text is cut to it. */
const MAX_BODY = 4000;

interface Typing {
  slug: string;
  buildId: string;
  kind: CommentFieldKind;
  text: string;
  typed: TypedMention | undefined;
  suggestions: MentionSuggestion[];
  pick: string;
}

/** A text field of the posted form, "" when absent or not text. */
function textOf(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

/** The project's members the text points at, for a typed mention (none for plain text). */
async function suggestionsFor(
  projectId: string,
  typed: TypedMention | undefined,
): Promise<MentionSuggestion[]> {
  return typed === undefined
    ? []
    : suggestMembers(await mentionCandidates(getStore().db, projectId), typed.fragment);
}

/** Authorize, read the form, and work out what the text is pointing at. */
async function typing(c: Context): Promise<Typing> {
  const slug = c.req.param("slug") ?? "";
  const buildId = c.req.param("buildId") ?? "";
  const project = await resolveAuthorizedProject(c, slug, ...DEVELOPER_ROLES);
  await buildForProject(project.id, buildId);
  const form = await c.req.formData();
  const text = textOf(form, "body").slice(0, MAX_BODY);
  const typed = typedMention(text);
  const asked = textOf(form, "kind");
  return {
    slug,
    buildId,
    kind: COMMENT_FIELD_KINDS.find((known) => known === asked) ?? "build",
    text,
    typed,
    suggestions: await suggestionsFor(project.id, typed),
    pick: textOf(form, "pick"),
  };
}

/** Register the suggestion list and its completion. */
export function registerMentionSuggest(app: ShelfRouter): void {
  app.post("/projects/:slug/builds/:buildId/mention-suggest", async (c) => {
    const { slug, buildId, kind, suggestions } = await typing(c);
    return suggestions.length === 0
      ? c.html("")
      : c.html(
          <MentionSuggestions
            slug={slug}
            buildId={buildId}
            kind={kind}
            suggestions={suggestions}
          />,
        );
  });

  app.post("/projects/:slug/builds/:buildId/mention-complete", async (c) => {
    const { slug, buildId, kind, text, typed, suggestions, pick } = await typing(c);
    const chosen = suggestions.find((suggestion) => suggestion.userId === pick);
    if (typed === undefined || chosen === undefined) {
      throw new HTTPException(400, { message: "Pick a member from the list" });
    }
    const value = completeMention(text, typed, chosen.handle);
    return c.html(<CommentBodyField slug={slug} buildId={buildId} kind={kind} value={value} />);
  });
}
