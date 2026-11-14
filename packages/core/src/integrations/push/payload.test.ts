import { describe, expect, it } from "vitest";
import { payloadOf, relativePath } from "./payload.ts";

const base = { subject: "[Shelf] build:failed on main", text: "l1\nl2", markdown: "", html: "" };

describe("push payload", () => {
  it("takes the title, a one-line body and a relative path", () => {
    expect(
      payloadOf({
        ...base,
        summary: "Shelf: build:failed on main",
        url: "https://shelf.example.com/projects/p/builds/b?x=1",
      }),
    ).toEqual({
      title: "[Shelf] build:failed on main",
      body: "Shelf: build:failed on main",
      url: "/projects/p/builds/b?x=1",
    });
  });

  it("has no url without a link (no confirmed origin)", () => {
    expect(payloadOf(base)).toEqual({ title: base.subject, body: "l1" });
  });

  it("cuts long text", () => {
    expect(payloadOf({ ...base, summary: "x".repeat(500) }).body).toHaveLength(200);
  });

  it("drops a link that is not http(s)", () => {
    expect(relativePath("javascript:alert(1)")).toBeUndefined();
    expect(relativePath("not a url")).toBeUndefined();
    expect(relativePath()).toBeUndefined();
  });
});
