// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { onAPhone, pageStory } from "../../.storybook/page.tsx";
import { project } from "../stories-fixtures/dataset.ts";
import { renderLabelDetailPage, renderLabelsPage } from "./label-detail.tsx";

const meta: Meta = { title: "Pages/Library/Labels" };
export default meta;

/** The project's label types, with the template that turns a value into a link. */
export const LabelTypes = pageStory(() => renderLabelsPage(project.slug));

/** No label type is configured. */
export const NoLabelTypes = pageStory(() => renderLabelsPage(project.slug), { dataset: "empty" });

/** Builds bearing `ticket: DS-42`; the type links out, so each row has an "Open link" action. */
export const BuildsWithLink = pageStory(() =>
  renderLabelDetailPage(project.slug, "ticket", "DS-42"),
);

/** A label type without a link template: no "Open link" action. */
export const BuildsWithoutLink = pageStory(() =>
  renderLabelDetailPage(project.slug, "release", "2026.1"),
);

/** No build bears this value any more. */
export const NoBuilds = pageStory(() => renderLabelDetailPage(project.slug, "ticket", "DS-99"));

export const LabelTypesOnAPhone = onAPhone(LabelTypes);

export const BuildsOnAPhone = onAPhone(BuildsWithLink);
