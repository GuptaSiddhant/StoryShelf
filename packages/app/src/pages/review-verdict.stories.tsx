import type { Meta } from "@storybook/html-vite";
// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Build, BuildReview } from "@storyshelf/core/schema";
import { jsxStory } from "../../.storybook/render.tsx";
import type { ReviewSectionData } from "../routers/review-section.handlers.ts";
import { BUILD_REVIEW, builds, project } from "../stories-fixtures/dataset.ts";
import { hoursAgo } from "../stories-fixtures/time.ts";
import { VerdictCard } from "./review-verdict.tsx";

const meta: Meta = { title: "Pages/Review/Verdict" };
export default meta;

function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("fixture missing: the build under review");
  }
  return value;
}

const build = required(builds.find((item) => item.id === BUILD_REVIEW));

const verdictBy = (userId: string, verdict: BuildReview["verdict"]): BuildReview => ({
  id: `rv_${userId}`,
  buildId: BUILD_REVIEW,
  userId,
  verdict,
  body: null,
  createdAt: hoursAgo(26),
});

const NAMES = new Map([
  ["u_ana", "Ana Ruiz"],
  ["u_bo", "Bo Chen"],
  ["u_cy", "Cy Okafor"],
]);

/** The verdict card of a build under review, with the given verdicts and assigned reviewers. */
function card(
  latest: BuildReview[],
  assigned: ReviewSectionData["assigned"],
  status: Build["status"] = build.status,
): ReviewSectionData {
  return {
    project,
    build: { ...build, status },
    state: { status, approvalsRequired: 1, approvals: 0, latest, history: latest },
    changeset: {
      baseline: null,
      changeset: { added: [], removed: [], changed: [], unchanged: 0 },
    },
    firstStory: new Map(),
    comments: [],
    names: NAMES,
    assigned,
    changeRequests: [],
    snapshotLabels: new Map(),
    canTriage: true,
    testing: false,
    publishing: "success",
    canComment: true,
    canVerdict: true,
  };
}

export const NoOwnersAssigned = jsxStory(() => <VerdictCard data={card([], [])} />);

export const AssignedWaiting = jsxStory(() => (
  <VerdictCard
    data={card(
      [],
      [
        { userId: "u_ana", components: ["Button", "Input"] },
        { userId: "u_bo", components: ["Card"] },
      ],
    )}
  />
));

export const AssignedMixed = jsxStory(() => (
  <VerdictCard
    data={card(
      [verdictBy("u_ana", "approved"), verdictBy("u_cy", "rejected")],
      [
        { userId: "u_ana", components: ["Button", "Input"] },
        { userId: "u_bo", components: ["Card"] },
        { userId: "u_cy", components: ["Tabs", "Tooltip", "Dialog", "Menu", "Table", "Toast"] },
      ],
    )}
  />
));

/** A cancelled build is terminal: the reviewer can still see it, but gets no verdict controls. */
export const CancelledBuild = jsxStory(() => <VerdictCard data={card([], [], "cancelled")} />);

/** A failed capture has nothing to review either. */
export const FailedBuild = jsxStory(() => <VerdictCard data={card([], [], "failed")} />);
