// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { Card, Meta as MetaText, SubNavLayout } from "./components.tsx";

const meta: Meta = { title: "UI/SubNav" };
export default meta;

export const SettingsLayout = jsxStory(() => (
  <SubNavLayout
    label="Project settings"
    items={[
      { label: "General", href: "#general", icon: "settings", active: true },
      { label: "Members", href: "#members", icon: "users" },
      { label: "Design", href: "#design", icon: "sparkles" },
      { label: "Webhooks", href: "#webhooks", icon: "webhook" },
    ]}
  >
    <Card>
      <MetaText>The active section's content sits beside the navigation.</MetaText>
    </Card>
  </SubNavLayout>
));
