import { describe, expect, it } from "vitest";
import { formatNotification, formatSystemNotification } from "./format.ts";

describe("formatNotification", () => {
  it("formats a compact build event with prefix and link", () => {
    const formatted = formatNotification(
      {
        event: "build:reviewing",
        projectId: "p1",
        data: { gitBranch: "feature/x", status: "reviewing" },
        timestamp: new Date().toISOString(),
      },
      { name: "Acme", reviewUrl: "https://shelf.example.com/b1" },
      { style: "compact" },
    );
    expect(formatted.subject).toContain("build:reviewing");
    expect(formatted.text).toContain("https://shelf.example.com/b1");
    expect(formatted.html).toContain("Acme");
  });

  it("escapes HTML in free-form fields", () => {
    const formatted = formatNotification(
      {
        event: "build:created",
        data: { message: "<script>alert(1)</script>" },
        timestamp: new Date().toISOString(),
      },
      { name: "Shelf" },
      { style: "verbose" },
    );
    expect(formatted.html).not.toContain("<script>");
    expect(formatted.html).toContain("&lt;script&gt;");
  });

  it("formats system alerts as verbose with sys prefix", () => {
    const formatted = formatSystemNotification(
      {
        event: "sys:user-created",
        data: { email: "a@example.com" },
        timestamp: new Date().toISOString(),
      },
      { name: "Shelf" },
    );
    expect(formatted.subject.startsWith("[Shelf sys]")).toBe(true);
  });
});
