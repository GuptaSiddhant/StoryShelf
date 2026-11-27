import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";
import { runWithStore, type Store } from "../store.ts";
import { isOutOfSpace, withUploadStorage } from "./upload-storage-errors.ts";

const error = vi.fn();
const store = { logger: { error } } as unknown as Store;
const inStore = async <T>(run: () => Promise<T>): Promise<T> => await runWithStore(store, run);
const coded = (code: string): Error => Object.assign(new Error(code), { code });

describe("withUploadStorage", () => {
  it("returns what the step returns and logs nothing", async () => {
    error.mockClear();
    expect(await inStore(async () => await withUploadStorage("zip", "b1", async () => 7))).toBe(7);
    expect(error).not.toHaveBeenCalled();
  });

  it("rethrows an unrelated error untouched", async () => {
    const failure = coded("EACCES");
    await expect(
      inStore(async () => await withUploadStorage("zip", "b1", () => Promise.reject(failure))),
    ).rejects.toBe(failure);
  });

  it.each(["zip", "content", "manifest"])(
    "answers 507 and logs when %s runs out of space",
    async (step) => {
      error.mockClear();
      const answer = await inStore(
        async () =>
          await withUploadStorage(step, "b1", () => Promise.reject(coded("ENOSPC"))).catch(
            (caught: unknown) => caught,
          ),
      );
      expect(answer).toBeInstanceOf(HTTPException);
      expect((answer as HTTPException).status).toBe(507);
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ buildId: "b1", step }),
        expect.stringContaining("out of space"),
      );
    },
  );
});

describe("isOutOfSpace", () => {
  it("recognizes ENOSPC and EDQUOT, also as a cause, and nothing else", () => {
    expect(isOutOfSpace(coded("ENOSPC"))).toBe(true);
    expect(isOutOfSpace(coded("EDQUOT"))).toBe(true);
    expect(isOutOfSpace(new Error("wrapped", { cause: coded("ENOSPC") }))).toBe(true);
    expect(isOutOfSpace(coded("EACCES"))).toBe(false);
    expect(isOutOfSpace("ENOSPC")).toBe(false);
  });
});
