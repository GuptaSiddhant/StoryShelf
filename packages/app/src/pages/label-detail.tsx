import { BuildModel, LabelModel, ProjectModel } from "@storyshelf/core/models";
import type { Build, LabelType, Project } from "@storyshelf/core/schema";
import { DocumentLayout, type RenderedContent } from "../shell/document.tsx";
import { getStore } from "../store.ts";
import {
  Badge,
  Button,
  EmptyState,
  HStack,
  Meta,
  PageHeader,
  Table,
  statusLabel,
  statusTone,
} from "../ui/components.tsx";
/** Resolve a label type's `link_template` against a build, or return null. */
export function resolveLabelLink(
  template: string | null,
  project: { gitRepository: string | null },
  build: { gitBranch: string },
  value: string,
): string | null {
  if (!template) {
    return null;
  }
  const repo = project.gitRepository ?? "";
  return template
    .replaceAll("{value}", value)
    .replaceAll("{repo}", repo)
    .replaceAll("{branch}", build.gitBranch);
}

type Rendered = ReturnType<typeof Table>;

function LabelBuildRow(props: {
  project: Project;
  build: Build;
  labelType: LabelType | null;
  value: string;
}): Rendered {
  const { project, build, labelType, value } = props;
  const link = labelType?.linkTemplate
    ? resolveLabelLink(labelType.linkTemplate, project, build, value)
    : null;
  return (
    <tr>
      <td>
        <strong>{build.gitBranch}</strong>
        <Meta as="div" mono>
          {build.gitSha.slice(0, 7)} {build.message ? `· ${build.message.slice(0, 60)}` : ""}
        </Meta>
      </td>
      <td>
        <Badge tone={statusTone(build.status)}>{statusLabel(build.status)}</Badge>
      </td>
      <td>
        <div>{build.authorName ?? "—"}</div>
        <Meta as="div">{build.authorEmail ?? ""}</Meta>
      </td>
      <td>
        <Meta as="span">{new Date(build.createdAt).toLocaleString()}</Meta>
      </td>
      <td class="nowrap">
        <HStack wrap={false}>
          <Button
            variant="secondary"
            size="sm"
            href={`/projects/${project.slug}/builds/${build.id}`}
          >
            View
          </Button>
          {link ? (
            <Button variant="ghost" size="sm" href={link} target="_blank" rel="noreferrer">
              Open link
            </Button>
          ) : null}
        </HStack>
      </td>
    </tr>
  );
}

function LabelBuildsTable(props: {
  project: Project;
  builds: Build[];
  labelType: LabelType | null;
  value: string;
}): Rendered {
  return (
    <Table label="Builds with this label">
      <table>
        <thead>
          <tr>
            <th>Build</th>
            <th>Status</th>
            <th>Author</th>
            <th>Created</th>
            <th>
              <span class="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {props.builds.map((build) => (
            <LabelBuildRow
              key={build.id}
              project={props.project}
              build={build}
              labelType={props.labelType}
              value={props.value}
            />
          ))}
        </tbody>
      </table>
    </Table>
  );
}

function LabelDetailHeader(props: {
  project: Project;
  labelKey: string;
  value: string;
  labelType: LabelType | null;
}): ReturnType<typeof PageHeader> {
  const { project, labelKey: key, value, labelType } = props;
  return (
    <PageHeader
      title={
        <>
          {labelType ? labelType.name : key}: {value}
        </>
      }
      description={
        <>
          <Badge tone="neutral">{key}</Badge> Builds bearing this{" "}
          {labelType ? labelType.name.toLowerCase() : "label"}, latest first.
        </>
      }
      actions={
        <Button variant="ghost" href={`/projects/${project.slug}/labels`}>
          All labels
        </Button>
      }
    />
  );
}

/** Label page: every build bearing `key=value`, latest first (ADR 0013). */
export async function renderLabelDetailPage(
  slug: string,
  key: string,
  value: string,
): Promise<RenderedContent | null> {
  const projects = await new ProjectModel(getStore().db).list();
  const project = projects.find((item) => item.slug === slug);
  if (!project) {
    return null;
  }
  const [builds, labelType] = await Promise.all([
    new BuildModel(getStore().db).list(project.id, { labelKey: key, labelValue: value }),
    new LabelModel(getStore().db).getType(project.id, key),
  ]);

  return (
    <DocumentLayout
      title={`${key}: ${value}`}
      nav={{
        active: "settings",
        projectSlug: project.slug,
        projectName: project.name,
        trail: [
          { label: "Labels", href: `/projects/${project.slug}/labels` },
          { label: `${labelType ? labelType.name : key}: ${value}` },
        ],
      }}
    >
      <LabelDetailHeader project={project} labelKey={key} value={value} labelType={labelType} />

      {builds.length === 0 ? (
        <EmptyState
          title="No builds"
          description={`No build currently bears the label ${key}: ${value}.`}
        />
      ) : (
        <LabelBuildsTable project={project} builds={builds} labelType={labelType} value={value} />
      )}
    </DocumentLayout>
  );
}

/** Read-only table of the project's label types. */
function LabelTypesTable(props: { labelTypes: LabelType[] }): ReturnType<typeof Table> {
  const { labelTypes } = props;
  return (
    <Table label="Label types">
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Name</th>
            <th>Template</th>
          </tr>
        </thead>
        <tbody>
          {labelTypes.map((labelType) => (
            <tr key={labelType.id}>
              <td>
                <Badge tone="neutral">{labelType.key}</Badge>
              </td>
              <td>{labelType.name}</td>
              <td class="truncate max-w-cell">{labelType.linkTemplate ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Table>
  );
}

/** Label types overview page (architecture.md `GET /projects/:slug/labels`). */
export async function renderLabelsPage(slug: string): Promise<RenderedContent | null> {
  const projects = await new ProjectModel(getStore().db).list();
  const project = projects.find((item) => item.slug === slug);
  if (!project) {
    return null;
  }
  const labelTypes = await new LabelModel(getStore().db).listTypes(project.id);

  return (
    <DocumentLayout
      title={`Labels · ${project.name}`}
      nav={{
        active: "settings",
        projectSlug: project.slug,
        projectName: project.name,
        trail: [{ label: "Labels" }],
      }}
    >
      <PageHeader
        title="Labels"
        description="Typed labels attach values to builds and link out to external systems."
      />

      {labelTypes.length === 0 ? (
        <EmptyState
          title="No label types"
          description="No label types are configured for this project."
        />
      ) : (
        <LabelTypesTable labelTypes={labelTypes} />
      )}
    </DocumentLayout>
  );
}
