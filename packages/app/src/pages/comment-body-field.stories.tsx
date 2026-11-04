// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { onAPhone } from "../../.storybook/page.tsx";
import { jsxStory, renderJsx } from "../../.storybook/render.tsx";
import type { MentionSuggestion } from "../mentions.ts";
import {
  type CommentFieldKind,
  CommentBodyField,
  MentionSuggestions,
} from "./comment-body-field.tsx";

const meta: Meta = { title: "Pages/Review/CommentBox" };
export default meta;

const SLUG = "design-system";
const BUILD = "01JD0000000000000000BLD002";

const suggestions = [
  { userId: "u_ana", handle: "ana", name: "Ana Ruiz" },
  { userId: "u_anders", handle: "anders", name: "Anders Lindqvist-Montgomery" },
  { userId: "u_ansel", handle: "ansel", name: "Ansel Adams" },
];

/** The empty comment box of a build, with nothing suggested. */
export const Empty = jsxStory(() => <CommentBodyField slug={SLUG} buildId={BUILD} kind="build" />);

/**
 * The box with the suggestions inside its live region, as the page has them once the server has
 * answered (`hx-swap="innerHTML"` into the box's `-mentions` target): the same markup, not a sibling.
 */
async function suggesting(
  kind: CommentFieldKind,
  value: string,
  found: readonly MentionSuggestion[],
): Promise<HtmlEscapedString> {
  const box = await renderJsx(
    <CommentBodyField slug={SLUG} buildId={BUILD} kind={kind} value={value} />,
  );
  const list = await renderJsx(
    <MentionSuggestions slug={SLUG} buildId={BUILD} kind={kind} suggestions={found} />,
  );
  return raw(
    box.replace(
      /(?<open><div id="[^"]*-mentions" aria-live="polite">)<\/div>/u,
      (_match, open: string) => `${open}${list}</div>`,
    ),
  );
}

/** Box and suggestions together, as the server answers while someone types `@an`. */
export const Suggesting = jsxStory(async () => await suggesting("story", "Can @an", suggestions));

/** One match only. */
export const SingleSuggestion = jsxStory(
  async () => await suggesting("snapshot", "Ping @ana", suggestions.slice(0, 1)),
);

/** The handle filled in after choosing a suggestion: the box comes back with the text and focus. */
export const HandleFilledIn = jsxStory(() => (
  <CommentBodyField slug={SLUG} buildId={BUILD} kind="build" value="Can @ana take a look? " />
));

/** Long names on a 375px phone: the suggestions wrap and nothing scrolls sideways. */
export const SuggestionsOnAPhone = onAPhone(Suggesting);
