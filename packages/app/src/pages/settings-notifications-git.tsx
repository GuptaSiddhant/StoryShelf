/**
 * Git hosts on Project → Settings → Notifications (ADR 0054, decision 8). New per-project git
 * channels are no longer accepted: a project links its repository on Settings › Git through the
 * server's connection. A channel that remains keeps posting until a site admin moves it, and the
 * tab warns about it, naming the release in which it stops.
 */
import { GIT_CHANNELS_STOP_RELEASE } from "@storyshelf/core/models";
import type { Project } from "@storyshelf/core/schema";
import type { FC } from "hono/jsx";
import { Alert } from "../ui/components.tsx";

/** The warning on a project with git channels left, or where git hosts went for one without. */
export const ProjectGitChannelsNotice: FC<{ project: Project; channels: number }> = ({
  project,
  channels,
}) =>
  channels > 0 ? (
    <Alert
      tone="warning"
      title={`${channels === 1 ? "This git channel stops" : `These ${channels} git channels stop`} posting in ${GIT_CHANNELS_STOP_RELEASE}`}
    >
      Per-project git credentials are removed in StoryShelf {GIT_CHANNELS_STOP_RELEASE}. A site
      admin moves each channel to a repository link on System › Git, with the same repository and
      status prefix; until then it keeps posting. A channel not moved stops posting its status, and
      a required check that stops posting blocks merges.
    </Alert>
  ) : (
    <Alert tone="info">
      Builds show on GitHub or GitLab through a repository link: link the repository on{" "}
      <a href={`/projects/${project.slug}/settings/git`}>Settings › Git</a>, once a site admin has
      connected the server to the git host.
    </Alert>
  );
