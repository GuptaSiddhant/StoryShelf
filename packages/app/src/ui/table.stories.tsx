// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { Badge, Table, VStack } from "./components.tsx";

const meta: Meta = { title: "UI/Table" };
export default meta;

const rows = [
  { name: "Kit/Button", file: "src/Button.stories.tsx", status: "approved", tone: "success" },
  { name: "Kit/Card", file: "src/Card.stories.tsx", status: "changed", tone: "warning" },
  { name: "Kit/Modal", file: "src/Modal.stories.tsx", status: "failed", tone: "danger" },
] as const;

const body = (
  <table>
    <thead>
      <tr>
        <th>Component</th>
        <th>Story file</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((row) => (
        <tr key={row.name}>
          <td>
            <a href="#component">{row.name}</a>
          </td>
          <td class="mono">{row.file}</td>
          <td>
            <Badge tone={row.tone} icon>
              {row.status}
            </Badge>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

export const Default = jsxStory(() => <Table>{body}</Table>);

export const Dense = jsxStory(() => <Table dense>{body}</Table>);

export const Both = jsxStory(() => (
  <VStack gap="lg">
    <Table>{body}</Table>
    <Table dense>{body}</Table>
  </VStack>
));
