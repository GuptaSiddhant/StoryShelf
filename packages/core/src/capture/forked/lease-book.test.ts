import { describe, expect, it, vi } from "vitest";
import { LeaseBook } from "./lease-book.ts";

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

describe("LeaseBook", () => {
  it("reports a receipt whose job made no progress for a full lease", async () => {
    const expired = vi.fn();
    new LeaseBook(30, expired).start("r1");
    await sleep(80);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(expired).toHaveBeenCalledWith("r1");
  });

  it("keeps a job alive while it reports progress", async () => {
    const expired = vi.fn();
    const book = new LeaseBook(50, expired);
    book.start("r1");
    for (let tick = 0; tick < 5; tick += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential progress ticks
      await sleep(20);
      book.touch("r1");
    }
    expect(expired).not.toHaveBeenCalled();
    book.stopAll();
  });

  it("stops watching a job that ended", async () => {
    const expired = vi.fn();
    const book = new LeaseBook(20, expired);
    book.start("r1");
    book.stop("r1");
    await sleep(60);
    expect(expired).not.toHaveBeenCalled();
  });

  it("watches each receipt separately", async () => {
    const expired = vi.fn();
    const book = new LeaseBook(40, expired);
    book.start("quiet");
    book.start("busy");
    for (let tick = 0; tick < 4; tick += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential progress ticks
      await sleep(20);
      book.touch("busy");
    }
    expect(expired).toHaveBeenCalledTimes(1);
    expect(expired).toHaveBeenCalledWith("quiet");
    book.stopAll();
  });

  it("is disabled with a zero lease and ignores unknown receipts", async () => {
    const expired = vi.fn();
    const book = new LeaseBook(0, expired);
    book.start("r1");
    book.touch("nope");
    book.stop("nope");
    await sleep(40);
    expect(expired).not.toHaveBeenCalled();
  });

  it("stopAll silences every lease", async () => {
    const expired = vi.fn();
    const book = new LeaseBook(20, expired);
    book.start("a");
    book.start("b");
    book.stopAll();
    await sleep(60);
    expect(expired).not.toHaveBeenCalled();
  });
});
