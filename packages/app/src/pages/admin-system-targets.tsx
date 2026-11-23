import { unavailableReason, type RunnerTarget } from "@storyshelf/core/adapter/capture-runner";
import type { HtmlEscapedString } from "hono/utils/html";
import { targetLabel } from "../targets.ts";
import { Badge, Button, Card, Meta, SectionTitle, Table, Time } from "../ui/components.tsx";

/** The remote-browsers guide an unreachable target links to. */
export const REMOTE_BROWSERS_GUIDE = "https://storyshelf.js.org/guides/remote-browsers/";

/** What a target that cannot be reached is shown with: a fixed class and when it began. */
export interface UnreachableView {
  reason: "connection" | "not-installed" | "launch";
  since: string;
}

const REASONS: Record<UnreachableView["reason"], string> = {
  connection: "The browser service did not accept a connection.",
  "not-installed": "The browser is not installed on this host.",
  launch: "The browser failed to start.",
};
/** Why and since when a target cannot be reached, with the guide; nothing when it can. */
function UnreachableNote(props: {
  down: UnreachableView | undefined;
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  const { down } = props;
  if (down === undefined) {
    return null;
  }
  return (
    <>
      <Badge tone="danger" icon>
        unreachable
      </Badge>
      <Meta as="div">
        {REASONS[down.reason]} Since <Time value={down.since} />.
      </Meta>
      <Button variant="ghost" size="sm" href={REMOTE_BROWSERS_GUIDE}>
        Remote browsers guide
      </Button>
    </>
  );
}

/** One offered target: its name, how it reaches Storybook and whether it can render now. */
function TargetRow(props: {
  entry: Partial<RunnerTarget> & Pick<RunnerTarget, "target">;
  isDefault: boolean;
  down: UnreachableView | undefined;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { entry } = props;
  const reason = entry.status === undefined ? null : unavailableReason(entry.status);
  return (
    <tr>
      <td>
        <strong>{targetLabel(entry.target)}</strong>{" "}
        <Meta as="span" mono>
          {entry.target}
        </Meta>
        {props.isDefault ? <Badge>default</Badge> : null}
      </td>
      <td>
        <Meta as="span">
          {entry.reach === undefined ? "—" : entry.reach === "url" ? "signed URL" : "local server"}
        </Meta>
      </td>
      <td>
        <Badge tone={reason === null ? "success" : "danger"} icon>
          {reason === null ? "ready" : "unavailable"}
        </Badge>
        {reason === null ? null : <Meta as="div">{reason}</Meta>}
        <UnreachableNote down={props.down} />
      </td>
    </tr>
  );
}

/** The browsers the capture runner offers and whether each can render now (ADR 0007, decision 7). */
export function CaptureTargetsCard(props: {
  /** The runner's offered targets; empty when it publishes no list. */
  targets: readonly RunnerTarget[];
  /** Targets whose last launch failed, by target; absent or empty when all are reachable. */
  unreachable?: ReadonlyMap<string, UnreachableView> | undefined;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { targets } = props;
  // A runner that publishes no list accepts any target, so an outage can name one it never offered.
  const offered = new Set(targets.map((entry) => entry.target));
  const extra = [...(props.unreachable?.keys() ?? [])]
    .filter((target) => !offered.has(target as RunnerTarget["target"]))
    .map((target) => ({ target: target as RunnerTarget["target"] }));
  const rows = [...targets, ...extra];
  return (
    <Card>
      <SectionTitle>Capture browsers</SectionTitle>
      <Meta>
        What the capture runner offers, default first. A project can only pick a target that is
        ready; a declared engine that is not installed is listed with the reason.
      </Meta>
      <Table label="Capture browsers">
        <table>
          <thead>
            <tr>
              <th>Target</th>
              <th>Reaches Storybook</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry, index) => (
              <TargetRow
                key={entry.target}
                entry={entry}
                isDefault={index === 0 && targets.length > 0}
                down={props.unreachable?.get(entry.target)}
              />
            ))}
          </tbody>
        </table>
      </Table>
    </Card>
  );
}
