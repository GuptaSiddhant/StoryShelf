import { describe, expect, it } from "vitest";
import { resolveContainerClient } from "./client.ts";
import { createAzureStorage } from "./index.ts";

describe("resolveContainerClient", () => {
  it("prefers a pre-configured container client", () => {
    const client = {} as never;
    expect(resolveContainerClient({ container: "bkt", client }, "bkt")).toBe(client);
  });

  it("throws when no client or connection info is supplied", () => {
    expect(() => resolveContainerClient({ container: "bkt" }, "bkt")).toThrow();
  });
});

describe("createAzureStorage - construct", () => {
  it("constructs a StorageAdapter without throwing", () => {
    const storage = createAzureStorage({ container: "test-container", client: {} as never });

    expect(storage).toBeDefined();
    expect(typeof storage.read).toBe("function");
    expect(typeof storage.write).toBe("function");
    expect(typeof storage.delete).toBe("function");
    expect(typeof storage.exists).toBe("function");
    expect(typeof storage.list).toBe("function");
  });

  it("throws when no client or connection info is supplied", () => {
    expect(() => createAzureStorage({ container: "bkt" } as never)).toThrow();
  });
});
