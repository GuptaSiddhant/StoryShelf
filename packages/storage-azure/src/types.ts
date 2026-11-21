import type { TokenCredential } from "@azure/identity";
import type { ContainerClient } from "@azure/storage-blob";

/** Options for configuring an Azure Blob Storage adapter. */
export interface AzureStorageOptions {
  /** Azure container name. */
  container: string;
  /** Optional blob prefix applied to all stored objects. */
  prefix?: string;
  /** Pre-configured container client. */
  client?: ContainerClient;
  /** Azure Storage connection string. */
  connectionString?: string;
  /** Storage account name. */
  accountName?: string;
  /** Storage account key. */
  accountKey?: string;
  /** Blob service URL (e.g. https://myaccount.blob.core.windows.net). */
  accountUrl?: string;
  /** SAS token (with or without leading `?`). */
  sasToken?: string;
  /**
   * Entra credential for an account with no key or SAS token. Defaults to `DefaultAzureCredential`
   * (managed identity on Azure), so an account name alone reads and writes with the host's identity.
   */
  credential?: TokenCredential;
  /** Client id of a user-assigned managed identity, for the default credential. */
  managedIdentityClientId?: string;
}
