import { BuildModel } from "../models/build.ts";
import { SnapshotModel } from "../models/snapshot.ts";
import { getStore } from "../store.ts";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";

export async function renderBuildDetailPage(buildId: string): Promise<RenderedContent | null> {
  const build = await new BuildModel(getStore().db).get(buildId);
  if (!build) {
    return null;
  }
  const snapshots = await new SnapshotModel(getStore().db).listByBuild(build.id);
  return (
    <DocumentLayout title={`Build ${build.gitBranch}`}>
      <h1>
        {build.gitBranch} — {build.status}
      </h1>
      <ul>
        {snapshots.map(
          // eslint-disable-next-line promise-function-async -- JSX.Element includes Promise<HtmlEscapedString>
          (s) => (
            <li key={s.id}>
              {s.storyTitle} / {s.storyName} · {s.viewportName} · {s.status}
            </li>
          ),
        )}
      </ul>
    </DocumentLayout>
  );
}
