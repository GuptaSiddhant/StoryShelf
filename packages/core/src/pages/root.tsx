import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";

export function renderRootPage(): RenderedContent {
  return (
    <DocumentLayout title="Projects">
      <h1>Projects</h1>
      <ul>
        {/* populated via htmx on client */}
      </ul>
      <p>
        <a href="/projects">Manage projects</a>
      </p>
    </DocumentLayout>
  );
}
