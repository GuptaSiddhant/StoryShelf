// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { Button, SummaryList } from "./components.tsx";

const meta: Meta = { title: "UI/SummaryList" };
export default meta;

const actions = (
  <>
    <Button variant="secondary" size="sm" href="#edit">
      Edit
    </Button>
    <Button variant="danger-secondary" size="sm" href="#remove">
      Remove
    </Button>
  </>
);

export const Populated = jsxStory(() => (
  <SummaryList
    label="Git connections"
    emptyTitle="No connections"
    items={[
      {
        id: "1",
        name: "acme/app",
        state: { label: "Connected", tone: "success" },
        details: "GitHub · checks on",
        actions,
      },
      {
        id: "2",
        name: "acme/docs",
        state: { label: "Token expired", tone: "danger" },
        details: "GitLab",
        actions,
      },
    ]}
  />
));

export const Empty = jsxStory(() => (
  <SummaryList
    label="Git connections"
    items={[]}
    emptyTitle="No connections"
    emptyDescription="Connect a git host to post build statuses."
    add={<Button href="#add">Add connection</Button>}
  />
));
