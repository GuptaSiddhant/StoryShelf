import * as runner from "@storyshelf/runner";
import * as remote from "@storyshelf/runner/remote";
import { describe, expect, it } from "vitest";
import * as oldRunner from "./index.ts";
import * as oldRemote from "./remote/index.ts";

describe("@storyshelf/runner-playwright shim", () => {
  it("re-exports every @storyshelf/runner export", () => {
    expect(Object.keys(oldRunner).toSorted()).toEqual(Object.keys(runner).toSorted());
    expect(oldRunner.createCaptureRunner).toBe(runner.createCaptureRunner);
    expect(Reflect.get(oldRunner, "createPlaywrightCaptureRunner")).toBe(
      Reflect.get(runner, "createPlaywrightCaptureRunner"),
    );
  });

  it("re-exports every @storyshelf/runner/remote export", () => {
    expect(Object.keys(oldRemote).toSorted()).toEqual(Object.keys(remote).toSorted());
  });
});
