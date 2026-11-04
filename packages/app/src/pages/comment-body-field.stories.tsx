// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { onAPhone } from "../../.storybook/page.tsx";
import { jsxStory } from "../../.storybook/render.tsx";
import { VStack } from "../ui/components.tsx";
import { CommentBodyField, MentionSuggestions } from "./comment-body-field.tsx";

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

/** Box and suggestions together, as the server answers while someone types `@an`. */
export const Suggesting = jsxStory(() => (
  <VStack>
    <CommentBodyField slug={SLUG} buildId={BUILD} kind="story" value="Can @an take a look?" />
    <MentionSuggestions slug={SLUG} buildId={BUILD} kind="story" suggestions={suggestions} />
  </VStack>
));

/** One match only. */
export const SingleSuggestion = jsxStory(() => (
  <VStack>
    <CommentBodyField slug={SLUG} buildId={BUILD} kind="snapshot" value="Ping @ana" />
    <MentionSuggestions
      slug={SLUG}
      buildId={BUILD}
      kind="snapshot"
      suggestions={suggestions.slice(0, 1)}
    />
  </VStack>
));

/** The handle filled in after choosing a suggestion: the box comes back with the text and focus. */
export const HandleFilledIn = jsxStory(() => (
  <CommentBodyField slug={SLUG} buildId={BUILD} kind="build" value="Can @ana take a look? " />
));

/** Long names on a 375px phone: the suggestions wrap and nothing scrolls sideways. */
export const SuggestionsOnAPhone = onAPhone(Suggesting);
