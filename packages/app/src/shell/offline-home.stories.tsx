import type { Meta } from "@storybook/html-vite";
// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX
import type { FC } from "hono/jsx";
import { jsxStory } from "../../.storybook/render.tsx";
import { OFFLINE_HOME_EXPIRED, OFFLINE_HOME_PROJECTS } from "../stories-fixtures/offline.ts";
import { css } from "../ui/css.ts";
import { renderOfflineHome, type OfflineHomeProject } from "./service-worker-home.ts";

const meta: Meta = { title: "Pages/Offline/Home" };
export default meta;

const frame = css`
  /* offline-home-frame */
  width: 100%;
  height: 28rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
`;

/** The worker's static page in a frame, so its own inlined CSS applies as on a device. */
const OfflineHome: FC<{ projects: Record<string, OfflineHomeProject> }> = async (props) => (
  <iframe
    class={frame}
    title="Offline home page"
    srcdoc={await renderOfflineHome(props.projects)}
  />
);

export const Empty = jsxStory(() => <OfflineHome projects={{}} />);
export const SomeProjects = jsxStory(() => <OfflineHome projects={OFFLINE_HOME_PROJECTS} />);
export const PastExpiry = jsxStory(() => <OfflineHome projects={OFFLINE_HOME_EXPIRED} />);
