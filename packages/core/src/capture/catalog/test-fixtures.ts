/** Shared fixtures of the catalog tests. */
import { createTestBuild, createTestProject } from "../../test-helpers/create-project.ts";
import { makeDatabase, makeStorage } from "../../test-helpers/fake-adapters.ts";
import { catalogPath, storybookDir } from "../../utils/paths.ts";

/** A v5 index with a button (two stories and docs) and a card. */
export const INDEX = {
  v: 5,
  entries: {
    "button--primary": {
      type: "story",
      id: "button--primary",
      name: "Primary",
      title: "Components/Button",
      importPath: "./src/Button.stories.tsx",
      tags: ["dev"],
    },
    "button--secondary": {
      type: "story",
      id: "button--secondary",
      name: "Secondary",
      title: "Components/Button",
      importPath: "./src/Button.stories.tsx",
    },
    "button--docs": {
      type: "docs",
      id: "button--docs",
      name: "Docs",
      title: "Components/Button",
      importPath: "./src/Button.stories.tsx",
    },
    "card--basic": {
      type: "story",
      id: "card--basic",
      name: "Basic",
      title: "Components/Card",
      importPath: "./src/Card.stories.tsx",
    },
  },
};

/** What {@link seedPublished} sets up. */
export interface SeededPublish {
  db: ReturnType<typeof makeDatabase>["db"];
  storage: ReturnType<typeof makeStorage>["storage"];
  objects: ReturnType<typeof makeStorage>["objects"];
  project: Awaited<ReturnType<typeof createTestProject>>;
  build: Awaited<ReturnType<typeof createTestBuild>>;
  /** Replace the published index.json of a build. */
  publish: (id: string, doc: unknown) => void;
  catalogKey: string;
}

/** A project, one build and storage that holds `index` as the build's published index.json. */
export async function seedPublished(
  index: unknown = INDEX,
  branch?: string,
): Promise<SeededPublish> {
  const { db } = makeDatabase();
  const fake = makeStorage();
  const project = await createTestProject(db, db.tables);
  const build = await createTestBuild(
    db,
    db.tables,
    project.id,
    branch ? { gitBranch: branch } : {},
  );
  const publish = (id: string, doc: unknown): void => {
    fake.objects.set(
      `${storybookDir(project.id, id)}/index.json`,
      Buffer.from(JSON.stringify(doc)),
    );
  };
  publish(build.id, index);
  return {
    db,
    ...fake,
    project,
    build,
    publish,
    catalogKey: catalogPath(project.id, build.id),
  };
}
