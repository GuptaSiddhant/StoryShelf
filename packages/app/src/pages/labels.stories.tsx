// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { onAPhone, pageStory } from "../../.storybook/page.tsx";
import { renderLabelDetailPage, renderLabelsPage } from "./label-detail.tsx";

const meta: Meta = { title: "Pages/Project/Labels" };
export default meta;

/** The label types of a project: a key, a name and the link template that turns a value into a link. */
export const Types = pageStory(() => renderLabelsPage("design-system"));

/** A project with no label types: the empty state. */
export const NoTypes = pageStory(() => renderLabelsPage("design-system"), { dataset: "empty" });

/** The table on a 375px phone. */
export const TypesOnAPhone = onAPhone(pageStory(() => renderLabelsPage("design-system")));

/** Every build bearing `pr=482`: the type has a template, so each row links out. */
export const DetailWithBuilds = pageStory(() =>
  renderLabelDetailPage("design-system", "pr", "482"),
);

/** A label whose type has no link template: the builds list without an external link. */
export const DetailWithoutLink = pageStory(() =>
  renderLabelDetailPage("design-system", "release", "1.4"),
);

/** No build currently bears the label: the empty state. */
export const DetailNoBuilds = pageStory(() => renderLabelDetailPage("design-system", "pr", "9999"));

/** A key that is not a configured label type still lists its builds, under the bare key. */
export const DetailUnknownType = pageStory(() =>
  renderLabelDetailPage("design-system", "ticket", "DS-12"),
);

/** The builds table on a 375px phone. */
export const DetailOnAPhone = onAPhone(
  pageStory(() => renderLabelDetailPage("design-system", "pr", "482")),
);
