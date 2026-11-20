---
"@storyshelf/storage-azure": minor
---

Changed: the image reads GCS and Azure Blob storage; Azure uses a managed identity

`storage-azure` signs in with `DefaultAzureCredential` when no connection string, account key or SAS token is given (`managedIdentityClientId` or `credential` pick the identity), so a bare account name no longer falls back to anonymous access. The image selects Google Cloud Storage from `GCS_BUCKET` and Azure Blob from `AZURE_STORAGE_ACCOUNT` (or `AZURE_STORAGE_CONNECTION`), and refuses to boot with more than one storage backend. The Azure Terraform module no longer stores the account's connection string in Key Vault or passes it to the app; the provider still records the account keys in the Terraform state.

Schema: none
