import { describe, expect, it } from "vite-plus/test";
import { readSessionCookie, SECURE_SESSION_COOKIE, SESSION_COOKIE } from "./types.ts";

describe("readSessionCookie", () => {
  it("reads the plain name (http)", () => {
    expect(readSessionCookie(`a=1; ${SESSION_COOKIE}=plain; b=2`)).toBe("plain");
  });

  it("reads the __Secure- name (https)", () => {
    expect(SECURE_SESSION_COOKIE).toBe("__Secure-storyshelf_session");
    expect(readSessionCookie(`a=1; ${SECURE_SESSION_COOKIE}=secure`)).toBe("secure");
  });

  it("prefers the __Secure- name when both are sent", () => {
    expect(readSessionCookie(`${SESSION_COOKIE}=plain; ${SECURE_SESSION_COOKIE}=secure`)).toBe(
      "secure",
    );
  });

  it("falls back to the plain name when the __Secure- value is empty", () => {
    expect(readSessionCookie(`${SECURE_SESSION_COOKIE}=; ${SESSION_COOKIE}=plain`)).toBe("plain");
  });

  it("keeps the first of a repeated name", () => {
    expect(readSessionCookie(`${SESSION_COOKIE}=first; ${SESSION_COOKIE}=second`)).toBe("first");
  });

  it("is undefined without a header, without the cookie or with an empty value", () => {
    expect(readSessionCookie("")).toBeUndefined();
    expect(readSessionCookie(null)).toBeUndefined();
    expect(readSessionCookie("a=1; storyshelf_sessionx=2")).toBeUndefined();
    expect(readSessionCookie(`${SESSION_COOKIE}=`)).toBeUndefined();
  });

  it("keeps an = inside the value", () => {
    expect(readSessionCookie(`${SESSION_COOKIE}=tok.sig==`)).toBe("tok.sig==");
  });
});
