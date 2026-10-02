import { describe, expect, it } from "vitest";
import {
  ADVANCED_DATABASE_CHOICES,
  CURATED_DATABASE_CHOICES,
  CURATED_QUEUE_CHOICES,
  CURATED_STORAGE_CHOICES,
  databaseChoices,
  localInfraPrompts,
  queueChoices,
  storageChoices,
} from "./prompts.ts";

describe("curated adapter choices", () => {
  it("curates 4 databases instead of the full 14", () => {
    expect(CURATED_DATABASE_CHOICES.map((c) => c.value)).toEqual([
      "sqlite",
      "postgres",
      "mysql",
      "pglite",
    ]);
    expect(databaseChoices(false)).toHaveLength(4);
    expect(databaseChoices(true)).toHaveLength(
      CURATED_DATABASE_CHOICES.length + ADVANCED_DATABASE_CHOICES.length,
    );
    expect(databaseChoices(true).map((c) => c.value)).toContain("turso");
    expect(databaseChoices(true).map((c) => c.value)).toContain("d1");
  });

  it("curates storage and queue shortlists with full matrix behind the toggle", () => {
    expect(CURATED_STORAGE_CHOICES.map((c) => c.value)).toEqual(["local", "s3"]);
    expect(storageChoices(false)).toHaveLength(2);
    expect(storageChoices(true).map((c) => c.value)).toContain("azure");

    expect(CURATED_QUEUE_CHOICES.map((c) => c.value)).toEqual(["memory", "redis"]);
    expect(queueChoices(false)).toHaveLength(2);
    expect(queueChoices(true).map((c) => c.value)).toContain("sqs");
  });

  it("builds local infra prompts from the shortlist by default", () => {
    const curated = localInfraPrompts(false);
    const db = curated.find((p) => p.name === "database");
    expect(db?.type).toBe("select");
    if (db?.type === "select") {
      expect(db.choices.map((c) => c.value)).toEqual(["sqlite", "postgres", "mysql", "pglite"]);
    }

    const full = localInfraPrompts(true);
    const fullDb = full.find((p) => p.name === "database");
    if (fullDb?.type === "select") {
      expect(fullDb.choices).toHaveLength(14);
    }
  });
});
