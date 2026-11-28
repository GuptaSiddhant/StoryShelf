// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { ProjectModel } from "@storyshelf/core/models";
import { onAPhone, pageStory } from "../../.storybook/page.tsx";
import { DocumentLayout } from "../shell/document.tsx";
import { getStore } from "../store.ts";
import { ProjectCard } from "./projects-card.tsx";
import { renderProjectsPage } from "./projects.tsx";

const meta: Meta = { title: "Pages/Projects/Projects" };
export default meta;

export const Populated = pageStory(() => renderProjectsPage());

export const NoBuildsYet = pageStory(() => renderProjectsPage(), { dataset: "empty" });

export const NoProjects = pageStory(() => renderProjectsPage(), { dataset: "blank" });

/** The empty state's text is wider than a phone: the page must not scroll sideways. */
export const NoProjectsOnAPhone = onAPhone(
  pageStory(() => renderProjectsPage(), { dataset: "blank" }),
);

/** A project card with the AI health badge: "Health: Watch · 78", a status word in sentence case. */
export const HealthBadge = pageStory(async () => {
  const project = await new ProjectModel(getStore().db).getBySlug("design-system");
  if (!project) {
    throw new Error("the seeded project is missing");
  }
  return (
    <DocumentLayout title="Projects" nav={{ active: "projects" }}>
      <ProjectCard
        summary={{
          project,
          latest: null,
          previews: [],
          pending: 0,
          health: { verdict: "watch", score: 78 },
        }}
        urls={{ library: "/projects/design-system/library", review: "/projects/design-system" }}
      />
    </DocumentLayout>
  );
});

/** A default install with no project yet: sign-in on, no admin token, so the guide starts at New project and shows no `storyshelf create`. */
export const NoProjectsSignInOn = pageStory(() => renderProjectsPage(), {
  dataset: "blank",
  store: { authEnabled: true },
});

/** A signed-in non-admin with no project: the plain line, no setup steps (the admin's guide is not theirs). */
export const NotAddedYet = pageStory(() => renderProjectsPage(), {
  dataset: "blank",
  store: {
    authEnabled: true,
    user: { id: "ada", email: "ada@example.com", name: "Ada", role: "viewer" },
  },
});
