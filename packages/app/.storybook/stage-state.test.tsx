// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import { describe, expect, it } from "vitest";
import { CompareStage } from "../src/ui/components.tsx";
import { baselineShot, currentShot, designShot, diffShot } from "./assets/screens.ts";
import { renderJsx } from "./render.tsx";
import { stageState } from "./stage-state.ts";

const baseline = async (): Promise<string> =>
  await renderJsx(
    <CompareStage
      baselineSrc={baselineShot}
      currentSrc={currentShot}
      diffSrc={diffShot}
      subject="Kit / Button / Default"
    />,
  );

const design = async (): Promise<string> =>
  await renderJsx(
    <CompareStage
      variant="design"
      baselineSrc={designShot}
      currentSrc={currentShot}
      diffSrc={null}
      subject="Kit / Button / Default"
    />,
  );

/** The `data-view-value`s that are pressed in one control group of the rendered stage. */
function pressed(html: string, group: "data-compare-mode" | "data-compare-zoom"): string[] {
  const start = html.indexOf(group);
  const end = html.indexOf("</div>", start);
  return [
    ...html.slice(start, end).matchAll(/data-view-value="(?<value>[^"]+)"\s+aria-pressed="true"/gu),
  ].map((match) => match.groups?.["value"] ?? "");
}

function attribute(html: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="(?<value>[^"]*)"`, "u").exec(html)?.groups?.["value"];
}

describe("stageState", () => {
  it("leaves a stage alone without a state, so the default story stays split and fit", async () => {
    const html = await baseline();
    expect(stageState(html)).toBe(html);
    expect(attribute(html, "data-view")).toBe("split");
    expect(attribute(html, "data-zoom")).toBe("fit");
    expect(pressed(html, "data-compare-mode")).toEqual(["split"]);
    expect(pressed(html, "data-compare-zoom")).toEqual(["fit"]);
  });

  it.each(["swipe", "onion", "diff", "flip"] as const)(
    "shows the %s mode and presses only its button",
    async (view) => {
      const html = stageState(await baseline(), { view });
      expect(attribute(html, "data-view")).toBe(view);
      expect(pressed(html, "data-compare-mode")).toEqual([view]);
      expect(pressed(html, "data-compare-zoom")).toEqual(["fit"]);
    },
  );

  it.each(["100", "200", "400"] as const)(
    "shows zoom %s and presses only its button",
    async (zoom) => {
      const html = stageState(await baseline(), { zoom });
      expect(attribute(html, "data-zoom")).toBe(zoom);
      expect(pressed(html, "data-compare-zoom")).toEqual([zoom]);
      expect(pressed(html, "data-compare-mode")).toEqual(["split"]);
    },
  );

  it("shows the baseline side of a flip", async () => {
    const html = stageState(await baseline(), { view: "flip", flip: "baseline" });
    expect(attribute(html, "data-flip")).toBe("baseline");
    expect(attribute(html, "data-view")).toBe("flip");
  });

  it("applies the modes a design comparison allows", async () => {
    const html = stageState(await design(), { view: "onion" });
    expect(attribute(html, "data-view")).toBe("onion");
    expect(pressed(html, "data-compare-mode")).toEqual(["onion"]);
  });

  it("ignores what a design comparison does not offer (diff, flip, zoom)", async () => {
    const original = await design();
    const html = stageState(original, { view: "diff", zoom: "200" });
    expect(attribute(html, "data-view")).toBe("split");
    expect(attribute(html, "data-zoom")).toBe("fit");
    expect(pressed(html, "data-compare-mode")).toEqual(["split"]);
  });

  it("is deterministic: the same state gives the same HTML", async () => {
    const state = { view: "swipe", zoom: "200" } as const;
    expect(stageState(await baseline(), state)).toBe(stageState(await baseline(), state));
  });
});
