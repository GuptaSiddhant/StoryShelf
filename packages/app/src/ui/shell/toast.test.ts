import { describe, expect, it } from "vitest";
import { toastHeaders } from "../toast.ts";

describe("toastHeaders", () => {
  it("fires after the swap so body swaps don't destroy the toast", () => {
    const headers = toastHeaders("Approved");
    expect(Object.keys(headers)).toEqual(["HX-Trigger-After-Swap"]);
    expect(JSON.parse(headers["HX-Trigger-After-Swap"] ?? "")).toEqual({
      showToast: { message: "Approved", tone: "success" },
    });
  });

  it("keeps the header ASCII-safe for non-ASCII messages", () => {
    const value = toastHeaders("Gutes Ergebnis — ✓", "info")["HX-Trigger-After-Swap"] ?? "";
    expect(value).toMatch(/^[ -~]*$/u);
    expect(JSON.parse(value).showToast.message).toBe("Gutes Ergebnis — ✓");
  });
});
