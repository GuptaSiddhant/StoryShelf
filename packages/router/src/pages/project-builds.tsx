import type { HtmlEscapedString } from "hono/utils/html";
import { BuildModel } from "../models/build.ts";
import { ProjectModel } from "../models/project.ts";
import { getStore } from "../store.ts";
import { Badge, statusTone } from "../ui/components.tsx";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";

/** Project builds page: filterable build history for one project. */
export async function renderProjectBuildsPage(
  slug: string,
  query: { status?: string; branch?: string } = {},
): Promise<RenderedContent | null> {
  const projects = await new ProjectModel(getStore().db).list();
  const project = projects.find((item) => item.slug === slug);
  if (!project) {
    return null;
  }
  const builds = await new BuildModel(getStore().db).list(project.id, {
    status: query.status as never,
    branch: query.branch,
  });

  return (
    <DocumentLayout
      title={project.name}
      nav={{ active: "builds", projectSlug: project.slug, projectName: project.name }}
    >
      <div class="page-header">
        <nav class="breadcrumbs" aria-label="Breadcrumb">
          <ol>
            <li>
              <a href="/projects">Projects</a>
            </li>
            <li>
              <span aria-current="page">{project.name}</span>
            </li>
          </ol>
        </nav>
        <div class="page-header__row">
          <div>
            <h1 class="page-header__title">{project.name}</h1>
            <p class="page-header__desc">
              <code>{project.slug}</code>{" "}
              {project.gitRepository ? `· ${project.gitRepository}` : ""} ·{" "}
              <Badge tone="neutral">{project.gitDefaultBranch}</Badge>
            </p>
          </div>
          <div class="page-header__actions">
            <a class="btn btn--secondary" href={`/projects/${project.slug}/settings`}>
              Settings
            </a>
            <a class="btn btn--ghost" href={`/projects/${project.slug}/builds`}>
              Refresh
            </a>
          </div>
        </div>
      </div>

      <div class="card card--padded" style="margin-bottom:1rem;">
        <form
          method="get"
          action={`/projects/${project.slug}/builds`}
          style="display:flex; gap:.5rem; flex-wrap:wrap; align-items:end;"
        >
          <div class="field" style="margin:0; min-width:160px;">
            <label class="field__label" for="status">
              Status
            </label>
            <select class="field__input" id="status" name="status">
              <option value="" selected={!query.status}>
                All
              </option>
              <option value="pending" selected={query.status === "pending"}>
                pending
              </option>
              <option value="reviewing" selected={query.status === "reviewing"}>
                reviewing
              </option>
              <option value="approved" selected={query.status === "approved"}>
                approved
              </option>
              <option value="rejected" selected={query.status === "rejected"}>
                rejected
              </option>
              <option value="failed" selected={query.status === "failed"}>
                failed
              </option>
            </select>
          </div>
          <div class="field" style="margin:0; min-width:180px;">
            <label class="field__label" for="branch">
              Branch
            </label>
            <input
              class="field__input"
              id="branch"
              name="branch"
              value={query.branch ?? ""}
              placeholder="main"
            />
          </div>
          <button class="btn btn--secondary" type="submit">
            Filter
          </button>
          {query.status || query.branch ? (
            <a class="btn btn--ghost" href={`/projects/${project.slug}/builds`}>
              Clear
            </a>
          ) : null}
        </form>
      </div>

      {builds.length === 0 ? (
        <div class="empty">
          <h2 class="empty__title">No builds</h2>
          <p class="empty__desc">
            {query.status || query.branch
              ? "No builds match the current filter."
              : "Upload your first build with the CLI. Builds appear here once uploaded."}
          </p>
        </div>
      ) : (
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Branch / SHA</th>
                <th>Status</th>
                <th>Snapshots</th>
                <th>Author</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {builds.map((build): HtmlEscapedString | Promise<HtmlEscapedString> => (
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
                    <span class="field__hint">
                      {build.changedCount} changed · {build.approvedCount} approved ·{" "}
                      {build.snapshotCount} total
                    </span>
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
                    <span style="margin-left:.35rem;" />
                    <a
                      class="btn btn--ghost"
                      href={`/projects/${project.slug}/builds/${build.id}/diff`}
                    >
                      Review
                    </a>
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
