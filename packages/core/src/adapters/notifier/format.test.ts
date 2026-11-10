import { describe, expect, it } from "vite-plus/test";
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

  it("says why an assigned reviewer was asked, right under the headline, escaped in html", () => {
    const formatted = formatNotification(
      {
        event: "review:requested",
        data: { gitBranch: "main", assignedBecause: "You were asked because you own <Button>." },
        timestamp: new Date().toISOString(),
      },
      { name: "Shelf", reviewUrl: "https://shelf.example.com/b1" },
    );
    expect(formatted.text.split("\n").slice(0, 3)).toEqual([
      "Shelf: review:requested on main",
      "You were asked because you own <Button>.",
      "https://shelf.example.com/b1",
    ]);
    expect(formatted.html).toContain("you own &lt;Button&gt;.");
  });

  it("adds no reason line for an ordinary review request", () => {
    const formatted = formatNotification(
      { event: "review:requested", data: {}, timestamp: new Date().toISOString() },
      { name: "Shelf" },
    );
    expect(formatted.text.split("\n")[0]).toBe("Shelf: review:requested");
    expect(formatted.text).not.toContain("asked");
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
