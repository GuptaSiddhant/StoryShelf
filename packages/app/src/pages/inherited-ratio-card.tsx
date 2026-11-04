import { averageInheritedRatio } from "@storyshelf/core/models";
import type { Build } from "@storyshelf/core/schema";
import { Card, Meta, Stat } from "../ui/components.tsx";

/**
 * Affected-capture reuse: the average share of each recent build's snapshots that was inherited from
 * a baseline instead of captured again, from the counts stored on the builds (no snapshot reads).
 * It measures capture reuse only, never time or cost saved. Nothing renders until a build has snapshots.
 */
export function InheritedRatioCard(props: { builds: Build[] }): ReturnType<typeof Card> | null {
  const average = averageInheritedRatio(props.builds);
  if (average === null) {
    return null;
  }
  return (
    <Card>
      <Stat
        label="Average inherited share per build"
        value={`${Math.round(average.ratio * 100)}%`}
      />
      <Meta>
        Over the last {average.builds} {average.builds === 1 ? "build" : "builds"}, the average
        share of a build&apos;s snapshots that was reused from a baseline instead of captured again.
        This measures capture reuse, not time or cost saved.
      </Meta>
    </Card>
  );
}
