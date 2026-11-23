import { DefaultAzureCredential, type TokenCredential } from "@azure/identity";
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  type ContainerClient,
} from "@azure/storage-blob";
import type { AzureStorageOptions } from "./types.ts";

/** Resolve the container client for the configured credentials. */
export function resolveContainerClient(
  options: AzureStorageOptions,
  containerName: string,
): ContainerClient {
  if (options.client) {
    return options.client;
  }
  if (options.connectionString) {
    return BlobServiceClient.fromConnectionString(options.connectionString).getContainerClient(
      containerName,
    );
  }
  return resolveFromAccount(options, containerName);
}

/** Shared Azure container context threaded through operations. */
export interface AzureContext {
  container: ContainerClient;
  prefix: string;
}

function resolveFromAccount(options: AzureStorageOptions, containerName: string): ContainerClient {
  const url = options.accountUrl ?? buildAccountUrl(options.accountName);
  if (!url) {
    throw new Error(
      "createAzureStorage: provide `client`, `connectionString`, or `accountName`/`accountUrl`",
    );
  }
  if (options.accountName && options.accountKey) {
    const cred = new StorageSharedKeyCredential(options.accountName, options.accountKey);
    return new BlobServiceClient(url, cred).getContainerClient(containerName);
  }
  if (options.sasToken) {
    const token = options.sasToken.replace(/^\?/u, "");
    return new BlobServiceClient(`${url}?${token}`).getContainerClient(containerName);
  }
  return new BlobServiceClient(url, credentialFor(options)).getContainerClient(containerName);
}

/**
 * The Entra credential for an account with no key or SAS token: the one given, else
 * `DefaultAzureCredential` (managed identity on Azure, `az login` locally). `managedIdentityClientId`
 * picks a user-assigned identity. The credential never appears in a message or a log.
 */
function credentialFor(options: AzureStorageOptions): TokenCredential {
  return (
    options.credential ??
    new DefaultAzureCredential(
      options.managedIdentityClientId === undefined
        ? {}
        : { managedIdentityClientId: options.managedIdentityClientId },
    )
  );
}

function buildAccountUrl(accountName: string | undefined): string | undefined {
  if (!accountName) {
    return undefined;
  }
  return `https://${accountName}.blob.core.windows.net`;
}
