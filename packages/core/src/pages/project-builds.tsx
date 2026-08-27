import { BuildModel } from "../models/build.ts";
import { ProjectModel } from "../models/project.ts";
import { getStore } from "../store.ts";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";

export async function renderProjectBuildsPage(slug: string): Promise<RenderedContent | null> {
  const projects = await new ProjectModel(getStore().db).list();
  const project = projects.find((p) => p.slug === slug);
  if (!project) {
    return null;
  }
  const builds = await new BuildModel(getStore().db).list(project.id);
  return (
    <DocumentLayout title={project.name}>
      <h1>{project.name}</h1>
      <ul>
        {builds.map(
          // eslint-disable-next-line promise-function-async -- JSX.Element includes Promise<HtmlEscapedString>
          (b) => (
            <li key={b.id}>
              <a href={`/projects/${project.slug}/builds/${b.id}`}>{b.gitBranch}</a> · {b.status} · {b.message ?? ""}
            </li>
          ),
        )}
      </ul>
    </DocumentLayout>
  );
}
