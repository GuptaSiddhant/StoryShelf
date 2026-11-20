/** Entra (managed identity) credentials for an account with no key: the SDK clients are faked. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({ DefaultAzureCredential: vi.fn() }));
const blob = vi.hoisted(() => {
  const BlobServiceClient = Object.assign(vi.fn(), { fromConnectionString: vi.fn() });
  return { BlobServiceClient, StorageSharedKeyCredential: vi.fn() };
});

vi.mock("@azure/identity", () => identity);
vi.mock("@azure/storage-blob", () => blob);

import { resolveContainerClient } from "./client.ts";

/** A constructor that hands back `service` (vitest 5 mocks need `function` to be `new`-able). */
function serviceConstructor(service: object): () => object {
  // oxlint-disable-next-line prefer-arrow-callback -- `new` needs a function, not an arrow.
  return vi.fn(function Fake() {
    return service;
  }) as unknown as () => object;
}

beforeEach(() => {
  vi.clearAllMocks();
  const service = { getContainerClient: (name: string) => ({ name }) };
  blob.BlobServiceClient.mockImplementation(serviceConstructor(service));
  blob.BlobServiceClient.fromConnectionString.mockReturnValue(service);
});

describe("resolveContainerClient with Entra credentials", () => {
  it("uses DefaultAzureCredential for an account name alone", () => {
    resolveContainerClient({ container: "c", accountName: "acct" }, "c");
    expect(identity.DefaultAzureCredential).toHaveBeenCalledWith({});
    expect(blob.BlobServiceClient).toHaveBeenCalledWith(
      "https://acct.blob.core.windows.net",
      expect.any(identity.DefaultAzureCredential),
    );
  });

  it("selects a user-assigned identity by client id", () => {
    resolveContainerClient(
      { container: "c", accountName: "acct", managedIdentityClientId: "cid" },
      "c",
    );
    expect(identity.DefaultAzureCredential).toHaveBeenCalledWith({
      managedIdentityClientId: "cid",
    });
  });

  it("takes an explicit credential instead of the default one", () => {
    const credential = { getToken: vi.fn() };
    resolveContainerClient({ container: "c", accountUrl: "https://x.example", credential }, "c");
    expect(identity.DefaultAzureCredential).not.toHaveBeenCalled();
    expect(blob.BlobServiceClient).toHaveBeenCalledWith("https://x.example", credential);
  });

  it("keeps the connection string and the account key ahead of the identity", () => {
    resolveContainerClient({ container: "c", connectionString: "UseDevelopmentStorage=true" }, "c");
    resolveContainerClient({ container: "c", accountName: "a", accountKey: "k" }, "c");
    resolveContainerClient({ container: "c", accountName: "a", sasToken: "?sig=1" }, "c");
    expect(identity.DefaultAzureCredential).not.toHaveBeenCalled();
    expect(blob.StorageSharedKeyCredential).toHaveBeenCalledWith("a", "k");
  });
});
