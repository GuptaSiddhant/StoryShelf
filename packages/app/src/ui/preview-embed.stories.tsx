// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { PreviewEmbed } from "./components.tsx";

const meta: Meta = { title: "UI/PreviewEmbed" };
export default meta;

const signed = {
  url: "/api/v1/projects/kit/builds/B1/preview-token",
  path: "/iframe.html?id=kit-button--default",
  seconds: 2400,
};

const signedPreview = (): ReturnType<typeof PreviewEmbed> => (
  <PreviewEmbed src="about:blank" title="Kit / Button / Default preview" refresh={signed} />
);

/** Unsigned (a public build): the preview never renews, so nothing is said about it. */
export const Idle = jsxStory(() => (
  <PreviewEmbed src="about:blank" title="Kit / Button / Default preview" />
));

/** Signed, healthy: one line under the box says it reloads itself to stay signed in. */
export const Signed = jsxStory(signedPreview);

/** Renewal failed after the last retry: the line gives way to a notice with a reload button. */
export const RenewalFailed = jsxStory(signedPreview, { preview: "failed" });

/** Reload in flight: the button is busy and disabled, and the notice says it is busy. */
export const Reloading = jsxStory(signedPreview, { preview: "reloading" });

/** The reload failed too: the notice stays, the button is back, and one more line says so. */
export const ReloadFailedAgain = jsxStory(signedPreview, { preview: "failed-again" });
