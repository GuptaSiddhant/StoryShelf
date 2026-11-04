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

export const Default = jsxStory(() => <Table label="Components">{body}</Table>);

export const Dense = jsxStory(() => (
  <Table dense label="Components">
    {body}
  </Table>
));

export const Both = jsxStory(() => (
  <VStack gap="lg">
    <Table label="Components">{body}</Table>
    <Table dense label="Components, dense">
      {body}
    </Table>
  </VStack>
));

const wide = (
  <table>
    <thead>
      <tr>
        <th>Component</th>
        <th>Story file</th>
        <th>Last capture</th>
        <th>Reviewer</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((row) => (
        <tr key={row.name}>
          <td class="nowrap">{row.name}</td>
          <td class="mono nowrap">{row.file}</td>
          <td class="nowrap">2026-11-04 09:30 UTC, 3 browsers</td>
          <td class="nowrap">reviewer@example.com</td>
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

/** Wider than a 375px phone: the surface scrolls sideways and takes focus, so a keyboard can scroll it. */
export const Overflowing = jsxStory(() => <Table label="Recent captures">{wide}</Table>);
