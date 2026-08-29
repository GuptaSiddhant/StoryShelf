import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { serve } from "@hono/node-server";
import { createShelfRouter } from "@storyshelf/core";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { createLocalStorage } from "@storyshelf/storage-local";
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";

import { runServe } from "./serve.ts";

const dbObject = vi.hoisted(() => ({
  migrate: vi.fn(),
}));
const storageObject = vi.hoisted(() => ({}));
const captureObject = vi.hoisted(() => ({
  render: vi.fn(),
  cancel: vi.fn(),
}));
const appObject = vi.hoisted(() => ({
  fetch: vi.fn(),
}));
const serverObject = vi.hoisted(() => ({
  on: vi.fn(),
}));
const loggerObject = vi.hoisted(() => ({
  info: vi.fn(),
}));

vi.mock("@hono/node-server", () => ({
  serve: vi.fn(() => serverObject),
}));
vi.mock("@storyshelf/core", () => ({
  createShelfLogger: vi.fn(() => loggerObject),
  createShelfRouter: vi.fn(() => appObject),
}));
vi.mock("@storyshelf/db-sqlite", () => ({
  createSqliteDatabase: vi.fn(() => dbObject),
}));
vi.mock("@storyshelf/storage-local", () => ({
  createLocalStorage: vi.fn(() => storageObject),
}));
vi.mock("@storyshelf/runner-playwright", () => ({
  createPlaywrightCaptureRunner: vi.fn(() => captureObject),
}));

let tmp: string;
let dataDir: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "storyshelf-server-"));
  dataDir = join(tmp, "data");
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("runServe", () => {
  it("assembles the router with sqlite, local storage, and the playwright runner", async () => {
    await runServe({
      port: "3200",
      dataDir,
      secret: "s3cret",
      captureConcurrency: "3",
      purgeTtlDays: "14",
    });

    expect(createSqliteDatabase).toHaveBeenCalledWith(join(dataDir, "shelf.db"));
    expect(dbObject.migrate).toHaveBeenCalled();
    expect(createLocalStorage).toHaveBeenCalledWith(dataDir);
    expect(createPlaywrightCaptureRunner).toHaveBeenCalledWith();
    expect(createShelfRouter).toHaveBeenCalledWith({
      database: dbObject,
      storage: storageObject,
      capture: captureObject,
      config: {
        secret: "s3cret",
        captureConcurrency: 3,
        scratchDir: dataDir,
        purgeTtlDays: 14,
      },
      logger: loggerObject,
    });
    expect(serve).toHaveBeenCalledWith({ fetch: appObject.fetch, port: 3200 });
    expect(serverObject.on).toHaveBeenCalled();
  });

  it("leaves secret undefined and coerces numeric flags", async () => {
    await runServe({
      port: "3000",
      dataDir,
      captureConcurrency: "2",
      purgeTtlDays: "30",
    });

    expect(createShelfRouter).toHaveBeenCalledWith({
      database: dbObject,
      storage: storageObject,
      capture: captureObject,
      config: { secret: undefined, captureConcurrency: 2, scratchDir: dataDir, purgeTtlDays: 30 },
      logger: loggerObject,
    });
  });
});