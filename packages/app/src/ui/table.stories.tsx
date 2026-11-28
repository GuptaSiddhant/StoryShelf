// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { onAPhone } from "../../.storybook/page.tsx";
import { jsxStory } from "../../.storybook/render.tsx";
import { Badge, Button, HStack, Table, VStack } from "./components.tsx";

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

/** No rows: one full-width message row, and no header for nothing. */
export const Empty = jsxStory(() => (
  <Table label="Tokens" empty="No tokens yet. Create one for CI." />
));

/** Wider than a 375px phone: the surface scrolls sideways and takes focus, so a keyboard can scroll it. */
export const Overflowing = jsxStory(() => <Table label="Recent captures">{wide}</Table>);

/** The same wide table in the preview's 375px phone viewport: it scrolls in its own region. */
export const OnAPhone = onAPhone(jsxStory(() => <Table label="Recent captures">{wide}</Table>));

const stacked = (
  <table>
    <thead>
      <tr>
        <th>Component</th>
        <th>Status</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((row) => (
        <tr key={row.name}>
          <td>
            <strong>
              <a href="#component">{row.name}</a>
            </strong>
            <div class="mono">{row.file}</div>
          </td>
          <td data-label="Status">
            <Badge tone={row.tone} icon>
              {row.status}
            </Badge>
          </td>
          <td>
            <HStack justify="end">
              <Button variant="secondary" size="sm" href="#review">
                Review
              </Button>
            </HStack>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

/** `stackOnPhone` at desktop width: the table is unchanged. */
export const Stacked = jsxStory(() => (
  <Table stackOnPhone label="Components">
    {stacked}
  </Table>
));

/** `stackOnPhone` in the 375px phone viewport: each row is a card and its action stays on screen. */
export const StackedOnAPhone = onAPhone(
  jsxStory(() => (
    <Table stackOnPhone label="Components">
      {stacked}
    </Table>
  )),
);

/** A row action is a small `<Button>`: secondary for the neutral one, danger-secondary for the destructive one, side by side. */
export const RowActions = jsxStory(() => (
  <Table label="Components">
    <table>
      <thead>
        <tr>
          <th>Component</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.name}>
            <td>{row.name}</td>
            <td class="nowrap">
              <HStack>
                <Button variant="secondary" size="sm" href="#edit">
                  Edit
                </Button>
                <Button variant="danger-secondary" size="sm" type="button">
                  Remove
                </Button>
              </HStack>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </Table>
));
