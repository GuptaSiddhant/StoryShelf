import type { CaptureRunner } from "@storyshelf/core/adapter/capture-runner";

/** A capture runner that renders nothing: turns `testing` on in app tests without a browser. */
export function stubRunner(): CaptureRunner {
  return {
    metadata: { name: "stub", version: "0.0.0", kind: "stub", category: "capture-runner" },
    render: async () => {
      await Promise.resolve();
      return { captures: [], failures: [] };
    },
    cancel: async () => {
      await Promise.resolve();
    },
  };
}
