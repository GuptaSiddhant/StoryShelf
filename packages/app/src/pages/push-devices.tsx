import type { FC } from "hono/jsx";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  HStack,
  SectionTitle,
  RelativeTime,
  Table,
  VStack,
} from "../ui/components.tsx";
import { css } from "../ui/css.ts";
import { pushDevicesScript } from "./push-devices-script.ts";

/** One registered device as the page shows it: never its endpoint or keys. */
export interface PushDeviceView {
  id: string;
  label: string | null;
  createdAt: string;
  lastSuccessAt: string | null;
}

/** What this browser can do with push. The page script picks it; stories fix it. */
export type PushClientState = "unsupported" | "idle" | "enabled" | "denied";

const note = css`
  /* push-note */
  color: var(--text-secondary);
  font-size: var(--text-sm);
  margin: 0;
`;

const DeviceRow: FC<{ device: PushDeviceView }> = ({ device }) => (
  <tr data-push-device={device.id}>
    <td>
      {device.label ?? "Unnamed device"}{" "}
      <span data-push-this-tag hidden>
        <Badge tone="info">This device</Badge>
      </span>
    </td>
    <td class="nowrap">
      {device.lastSuccessAt ? <RelativeTime value={device.lastSuccessAt} /> : "No delivery yet"}
    </td>
    <td>
      <Button variant="secondary" size="sm" type="button" data-push-remove={device.id}>
        Remove
      </Button>
    </td>
  </tr>
);

const DeviceList: FC<{ devices: PushDeviceView[] }> = ({ devices }) =>
  devices.length === 0 ? (
    <EmptyState
      title="No devices yet"
      description="Enable push on a device to get review requests and build results there."
    />
  ) : (
    <Table dense label="Devices that receive push">
      <table>
        <thead>
          <tr>
            <th>Device</th>
            <th>Last delivery</th>
            <th>
              <span class="visually-hidden">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {devices.map((device) => (
            <DeviceRow key={device.id} device={device} />
          ))}
        </tbody>
      </table>
    </Table>
  );

/**
 * Push notifications per device (ADR 0048, decision 4). The caller renders it only when the server
 * has VAPID keys and the viewer is signed in; without either, push is off and nothing shows.
 */
export const PushDevicesCard: FC<{
  devices: PushDeviceView[];
  /** Initial browser state; the script replaces it once it has asked the browser. */
  clientState?: PushClientState | undefined;
}> = (props) => {
  const state = props.clientState ?? "idle";
  return (
    <Card>
      <div data-push data-push-state={state}>
        <SectionTitle>Push notifications</SectionTitle>
        <p class={note}>
          Choose which devices get push. Per-project delivery follows your notification
          subscriptions.
        </p>
        <VStack>
          <div data-push-when="unsupported" hidden={state !== "unsupported"}>
            <Alert tone="warning" title="Push is not available in this browser" role="status">
              This browser cannot receive web push. Open StoryShelf over HTTPS in a current browser.
            </Alert>
          </div>
          <div data-push-when="denied" hidden={state !== "denied"}>
            <Alert tone="warning" title="Notifications are blocked" role="status">
              This browser blocks notifications for StoryShelf. Allow them in the site settings of
              your browser, then reload this page.
            </Alert>
          </div>
          <div data-push-when="idle" hidden={state !== "idle"}>
            <HStack align="end" wrap>
              <Field label="Device name (optional)" name="pushLabel" />
              <Button variant="primary" size="sm" type="button" data-push-enable>
                Enable push on this device
              </Button>
            </HStack>
          </div>
          <div data-push-when="enabled" hidden={state !== "enabled"}>
            <Alert tone="success" title="Push is on for this device" role="status">
              Remove this device below to turn it off.
            </Alert>
          </div>
          <p class={note} data-push-status aria-live="polite">
            {""}
          </p>
          <DeviceList devices={props.devices} />
          <p class={note}>
            On iPhone and iPad, push needs StoryShelf installed to the home screen: open the Share
            menu and choose Add to Home Screen, then enable push from the installed app.
          </p>
        </VStack>
        <script dangerouslySetInnerHTML={{ __html: pushDevicesScript() }} />
      </div>
    </Card>
  );
};
