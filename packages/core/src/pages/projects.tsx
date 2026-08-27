import { ProjectModel } from "../models/project.ts";
import { getStore } from "../store.ts";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";

export async function renderProjectsPage(): Promise<RenderedContent> {
  const projects = await new ProjectModel(getStore().db).list();
  return (
    <DocumentLayout title="Projects">
      <h1>Projects</h1>
      <ul>
        {projects.map(
          // eslint-disable-next-line promise-function-async -- JSX.Element includes Promise<HtmlEscapedString>
          (p) => (
            <li key={p.id}>
              <a href={`/projects/${p.slug}/builds`}>{p.name}</a>
            </li>
          ),
        )}
      </ul>
      <p>
        <a href="/projects">Manage projects</a>
      </p>
    </DocumentLayout>
  );
}
