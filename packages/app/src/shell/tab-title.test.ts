import { describe, expect, it } from "vitest";
import { tabTitle } from "./document.tsx";

const nav = { projectName: "Demo Design System", trail: [{ label: "Access" }] };

describe("tabTitle", () => {
  it("leaves a page without a project as it is", () => {
    expect(tabTitle("Projects", {})).toBe("Projects");
  });

  it("puts the page before the project", () => {
    expect(tabTitle("Library", nav)).toBe("Library · Demo Design System");
    expect(tabTitle("Builds · Demo Design System", nav)).toBe("Builds · Demo Design System");
  });

  it("reorders a title that starts with the project", () => {
    expect(tabTitle("Demo Design System · Jobs", nav)).toBe("Jobs · Demo Design System");
  });

  it("names a settings tab by its breadcrumb", () => {
    expect(tabTitle("Demo Design System · Settings", nav)).toBe("Access · Demo Design System");
  });
});
