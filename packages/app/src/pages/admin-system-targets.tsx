import { unavailableReason, type RunnerTarget } from "@storyshelf/core/adapter/capture-runner";
import type { HtmlEscapedString } from "hono/utils/html";
import { targetLabel } from "../targets.ts";
import { Badge, Card, Meta, SectionTitle, Table } from "../ui/components.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

/** The browsers the capture runner offers and whether each can render now (ADR 0007, decision 7). */
export function CaptureTargetsCard(props: {
  targets: readonly RunnerTarget[];
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { targets } = props;
  return (
    <Card>
      <SectionTitle>Capture browsers</SectionTitle>
      <Meta>
        What the capture runner offers, default first. A project can only pick a target that is
        ready; a declared engine that is not installed is listed with the reason.
      </Meta>
      <Table>
        <table>
          <thead>
            <tr>
              <th>Target</th>
              <th>Reaches Storybook</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {targets.map((entry, index) => {
              const reason = unavailableReason(entry.status);
              return (
                <tr key={entry.target}>
                  <td>
                    <strong>{targetLabel(entry.target)}</strong>{" "}
                    <Meta as="span" mono>
                      {entry.target}
                    </Meta>
                    {index === 0 ? <Badge>default</Badge> : null}
                  </td>
                  <td>
                    <Meta as="span">{entry.reach === "url" ? "signed URL" : "local server"}</Meta>
                  </td>
                  <td>
                    <Badge tone={reason === null ? "success" : "danger"} icon>
                      {reason === null ? "ready" : "unavailable"}
                    </Badge>
                    {reason === null ? null : <Meta as="div">{reason}</Meta>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Table>
    </Card>
  );
}
