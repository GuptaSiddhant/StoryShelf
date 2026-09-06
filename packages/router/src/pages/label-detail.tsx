import type { HtmlEscapedString } from "hono/utils/html";
import { BuildModel } from "../models/build.ts";
import { LabelModel } from "../models/label.ts";
import { ProjectModel } from "../models/project.ts";
import { getStore } from "../store.ts";
import { Badge, statusTone } from "../ui/components.tsx";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";

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
      nav={{ active: "labels", projectSlug: project.slug, projectName: project.name }}
    >
      <div class="page-header">
        <nav class="breadcrumbs" aria-label="Breadcrumb">
          <ol>
            <li>
              <a href="/projects">Projects</a>
            </li>
            <li>
              <a href={`/projects/${project.slug}/builds`}>{project.name}</a>
            </li>
            <li>
              <span aria-current="page">
                {labelType ? labelType.name : key}: {value}
              </span>
            </li>
          </ol>
        </nav>
        <div class="page-header__row">
          <div>
            <h1 class="page-header__title">
              {labelType ? labelType.name : key}: {value}
            </h1>
            <p class="page-header__desc">
              <Badge tone="neutral">{key}</Badge> Builds bearing this{" "}
              {labelType ? labelType.name.toLowerCase() : "label"}, latest first.
            </p>
          </div>
          <div class="page-header__actions">
            <a class="btn btn--ghost" href={`/projects/${project.slug}/labels`}>
              All labels
            </a>
          </div>
        </div>
      </div>

      {builds.length === 0 ? (
        <div class="empty">
          <h2 class="empty__title">No builds</h2>
          <p class="empty__desc">
            No build currently bears the label {key}: {value}.
          </p>
        </div>
      ) : (
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Build</th>
                <th>Status</th>
                <th>Author</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {builds.map((build): HtmlEscapedString | Promise<HtmlEscapedString> => {
                const link = labelType?.linkTemplate
                  ? resolveLabelLink(labelType.linkTemplate, project, build, value)
                  : null;
                return (
                  <tr key={build.id}>
                    <td>
                      <div style="font-weight:600;">{build.gitBranch}</div>
                      <div class="field__hint" style="font-family: ui-monospace, monospace;">
                        {build.gitSha.slice(0, 7)}{" "}
                        {build.message ? `· ${build.message.slice(0, 60)}` : ""}
                      </div>
                    </td>
                    <td>
                      <Badge tone={statusTone(build.status)}>{build.status}</Badge>
                    </td>
                    <td>
                      <div>{build.authorName ?? "—"}</div>
                      <div class="field__hint">{build.authorEmail ?? ""}</div>
                    </td>
                    <td class="field__hint">{new Date(build.createdAt).toLocaleString()}</td>
                    <td style="white-space:nowrap;">
                      <a
                        class="btn btn--secondary"
                        href={`/projects/${project.slug}/builds/${build.id}`}
                      >
                        View
                      </a>
                      {link ? (
                        <>
                          <span style="margin-left:.35rem;" />
                          <a class="btn btn--ghost" href={link} target="_blank" rel="noreferrer">
                            Open link
                          </a>
                        </>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </DocumentLayout>
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
      nav={{ active: "labels", projectSlug: project.slug, projectName: project.name }}
    >
      <div class="page-header">
        <nav class="breadcrumbs" aria-label="Breadcrumb">
          <ol>
            <li>
              <a href="/projects">Projects</a>
            </li>
            <li>
              <a href={`/projects/${project.slug}/builds`}>{project.name}</a>
            </li>
            <li>
              <span aria-current="page">Labels</span>
            </li>
          </ol>
        </nav>
        <div class="page-header__row">
          <div>
            <h1 class="page-header__title">Labels</h1>
            <p class="page-header__desc">
              Typed labels attach values to builds and link out to external systems.
            </p>
          </div>
        </div>
      </div>

      {labelTypes.length === 0 ? (
        <div class="empty">
          <h2 class="empty__title">No label types</h2>
          <p class="empty__desc">No label types are configured for this project.</p>
        </div>
      ) : (
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Name</th>
                <th>Template</th>
              </tr>
            </thead>
            <tbody>
              {labelTypes.map((labelType): HtmlEscapedString | Promise<HtmlEscapedString> => (
                <tr key={labelType.id}>
                  <td>
                    <Badge tone="neutral">{labelType.key}</Badge>
                  </td>
                  <td>{labelType.name}</td>
                  <td style="max-width:32ch; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                    {labelType.linkTemplate ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DocumentLayout>
  );
}
