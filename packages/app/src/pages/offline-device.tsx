import type { StorybookHostingMode } from "@storyshelf/core/config";
import type { FC } from "hono/jsx";
import { DocumentLayout, type RenderedContent } from "../shell/document.tsx";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  HStack,
  PageHeader,
  Progress,
  SelectField,
  Table,
  VStack,
} from "../ui/components.tsx";
import { css } from "../ui/css.ts";
import {
  CAP_CHOICES,
  formatBytes,
  type OfflineKept,
  type OfflineUsage,
} from "./offline-device-model.ts";
import { offlineDeviceScript } from "./offline-device-script.ts";

export interface OfflineDevicePageState {
  /** Projects the viewer may keep: the page lists these. */
  projects: Array<{ slug: string; name: string }>;
  hostingMode: StorybookHostingMode;
  /** Device state, filled by the page script from the worker; stories pass a fixed one. */
  usage?: OfflineUsage | undefined;
}

const note = css`
  /* offline-note */
  color: var(--text-secondary);
  font-size: 0.85rem;
  margin: 0;
`;

/** Offline Storybooks are unavailable outside `trusted` hosting mode: say why, offer nothing. */
const UnavailableNotice: FC<{ hostingMode: StorybookHostingMode }> = (props) => (
  <Alert tone="info" title="Offline Storybooks are unavailable here" role="status">
    This deployment hosts Storybooks in <strong>{props.hostingMode}</strong> mode. Only{" "}
    <strong>trusted</strong> mode (Storybooks on the app&apos;s own origin) can serve them offline,
    so nothing can be kept on this device.
  </Alert>
);

const StorageCard: FC<{ usage: OfflineUsage | undefined }> = (props) => {
  const usage = props.usage;
  const cap = usage?.capBytes ?? CAP_CHOICES[1] ?? 0;
  const used = usage?.usedBytes ?? 0;
  return (
    <Card>
      <PageHeader level={2} title="Storage" description="Offline copies on this device only" />
      <VStack>
        <div data-offline-meter>
          <Progress value={used} max={cap} label="Offline storage used" />
        </div>
        <p class={note}>
          <span data-offline-used>{formatBytes(used)}</span> of{" "}
          <span data-offline-cap>{formatBytes(cap)}</span> used
          {usage && used >= cap ? <Badge tone="warning">At the cap</Badge> : null}
        </p>
        <HStack align="end" wrap>
          <SelectField
            label="Storage cap"
            name="offlineCap"
            value={String(cap)}
            options={CAP_CHOICES.map((bytes) => ({
              value: String(bytes),
              label: formatBytes(bytes),
            }))}
          />
          <Button variant="secondary" size="sm" type="button" data-offline-sync>
            Sync now
          </Button>
        </HStack>
        <p class={note}>
          Adding a project that would pass the cap is refused. Nothing is removed on its own.
          Signing out clears everything kept here.
        </p>
      </VStack>
    </Card>
  );
};

const ProjectRow: FC<{
  project: { slug: string; name: string };
  row: OfflineKept | undefined;
}> = ({ project, row }) => (
  <tr data-offline-row={project.slug}>
    <td>
      <div>{project.name}</div>
      <div class={note} data-offline-status>
        {row ? (row.expired ? "Expired, go online to sync" : "Kept") : ""}
      </div>
    </td>
    <td class="nowrap" data-offline-size>
      {row ? formatBytes(row.size) : "—"}
    </td>
    <td class="nowrap" data-offline-synced>
      {row ? row.syncedAt.slice(0, 16).replace("T", " ") : "Not kept"}
    </td>
    <td>
      <Button
        variant="secondary"
        size="sm"
        type="button"
        data-offline-keep={project.slug}
        data-offline-state={row ? "kept" : "idle"}
        data-idle-label="Keep offline"
        data-kept-label="Remove"
      >
        {row ? "Remove" : "Keep offline"}
      </Button>
    </td>
  </tr>
);

const ProjectRows: FC<{
  projects: OfflineDevicePageState["projects"];
  usage: OfflineUsage | undefined;
}> = (props) => {
  const kept = new Map((props.usage?.projects ?? []).map((project) => [project.slug, project]));
  return (
    <Table dense label="Projects kept offline">
      <table>
        <thead>
          <tr>
            <th>Project</th>
            <th>Size</th>
            <th>Last synced</th>
            <th>
              <span class="visually-hidden">Keep offline</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {props.projects.map((project) => (
            <ProjectRow key={project.slug} project={project} row={kept.get(project.slug)} />
          ))}
        </tbody>
      </table>
    </Table>
  );
};

const ProjectsCard: FC<{
  projects: OfflineDevicePageState["projects"];
  usage: OfflineUsage | undefined;
}> = (props) => (
  <Card>
    <PageHeader
      level={2}
      title="Projects"
      description="The latest default-branch Storybook of each project you keep"
      actions={
        <Button variant="secondary" size="sm" type="button" data-offline-all>
          Keep all my projects
        </Button>
      }
    />
    {props.projects.length === 0 ? (
      <EmptyState title="No projects to keep" description="Projects you can open appear here." />
    ) : (
      <ProjectRows projects={props.projects} usage={props.usage} />
    )}
  </Card>
);

/** This device's offline settings (ADR 0048, decision 3), under the account area. */
export function renderOfflineDevicePage(state: OfflineDevicePageState): RenderedContent {
  const trusted = state.hostingMode === "trusted";
  return (
    <DocumentLayout
      title="This device"
      nav={{
        active: "profile",
        trail: [{ label: "Profile", href: "/profile" }, { label: "This device" }],
      }}
    >
      <PageHeader
        title="This device"
        description="Keep default-branch Storybooks to read without a network"
      />
      {trusted ? (
        <VStack gap="lg">
          <div data-offline-unsupported hidden>
            <Alert tone="warning" title="Offline storage is not available" role="status">
              This browser cannot run the offline worker. Open StoryShelf over HTTPS in a current
              browser.
            </Alert>
          </div>
          <p class={note} data-offline-status-line aria-live="polite">
            {""}
          </p>
          <StorageCard usage={state.usage} />
          <ProjectsCard projects={state.projects} usage={state.usage} />
          <script dangerouslySetInnerHTML={{ __html: offlineDeviceScript() }} />
        </VStack>
      ) : (
        <UnavailableNotice hostingMode={state.hostingMode} />
      )}
    </DocumentLayout>
  );
}
