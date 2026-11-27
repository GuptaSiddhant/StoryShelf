// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { builds } from "../stories-fixtures/dataset.ts";
import { Meta as MetaText } from "../ui/components.tsx";
import { InheritedRatioCard } from "./inherited-ratio-card.tsx";

const meta: Meta = { title: "Pages/Insights/Inherited share card" };
export default meta;

const withSnapshots = builds.map((build, index) =>
  Object.assign({}, build, { snapshotCount: 10, inheritedCount: index % 4 === 0 ? 8 : 5 }),
);

export const WithSnapshots = jsxStory(() => <InheritedRatioCard builds={withSnapshots} />);

/** No build has snapshots yet: the share is not a number, so the card is not drawn at all. */
export const NoSnapshotsYet = jsxStory(
  () =>
    InheritedRatioCard({
      builds: builds.map((build) => Object.assign({}, build, { snapshotCount: 0 })),
    }) ?? <MetaText>The card is not shown: no recent build has snapshots.</MetaText>,
);
