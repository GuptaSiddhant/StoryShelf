import type { HtmlEscapedString } from "hono/utils/html";
import type { StatusRow, StatusTone } from "../routers/health-status.ts";
import { Absent, Badge, Card, Meta, SectionTitle, statusLabel, Table } from "../ui/components.tsx";

const TONES: Record<StatusTone, "success" | "warning" | "neutral"> = {
  ok: "success",
  warn: "warning",
  off: "neutral",
};

/** Runtime facts that need no probe: telemetry, image engine, public origin, Storybook hosting. */
export function RuntimeStatusCard(props: {
  rows: readonly StatusRow[];
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  if (props.rows.length === 0) {
    return null;
  }
  return (
    <Card>
      <SectionTitle>Runtime</SectionTitle>
      <Meta>
        Configuration the server runs with. Read, not probed: no row here calls out or changes the
        overall status.
      </Meta>
      <Table label="Runtime">
        <table>
          <tbody>
            {props.rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.label}</strong>
                </td>
                <td>
                  <Badge tone={TONES[row.tone]}>{statusLabel(row.value)}</Badge>
                </td>
                <td>
                  <Meta as="span">{row.detail ?? <Absent />}</Meta>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Table>
    </Card>
  );
}
