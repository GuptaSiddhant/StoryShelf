import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUILD_STATUSES, DESIGN_PROBLEMS, SNAPSHOT_STATUSES } from "./types.ts";

interface Schema {
  type?: string;
  enum?: string[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: Schema;
}

/** The pinned OpenAPI document of the app: the contract the addon's copy must match. */
function storyStatusSchema(): Schema {
  const document = JSON.parse(
    readFileSync(new URL("../../app/src/routers/openapi.snapshot.json", import.meta.url), "utf8"),
  ) as { components: { schemas: Record<string, Schema> } };
  const schema = document.components.schemas["StoryStatus"];
  if (!schema) throw new Error("StoryStatus is not in the OpenAPI document");
  return schema;
}

describe("types copy", () => {
  const schema = storyStatusSchema();
  const build = schema.properties?.["build"];
  const entry = schema.properties?.["stories"]?.additionalProperties;

  it("has the same top-level shape as the OpenAPI document", () => {
    expect(Object.keys(schema.properties ?? {}).toSorted()).toEqual(["build", "stories"]);
    expect(Object.keys(build?.properties ?? {}).toSorted()).toEqual(["reviewPath", "status"]);
    expect(Object.keys(entry?.properties ?? {}).toSorted()).toEqual(["design", "status"]);
  });

  it("lists the same statuses and design problems", () => {
    expect(build?.properties?.["status"]?.enum?.toSorted()).toEqual([...BUILD_STATUSES].toSorted());
    expect(entry?.properties?.["status"]?.enum?.toSorted()).toEqual(
      [...SNAPSHOT_STATUSES].toSorted(),
    );
    expect(entry?.properties?.["design"]?.enum?.toSorted()).toEqual(
      [...DESIGN_PROBLEMS].toSorted(),
    );
  });

  it("keeps design optional, as the copy does", () => {
    expect(entry?.required).not.toContain("design");
    expect(entry?.required).toContain("status");
  });
});
