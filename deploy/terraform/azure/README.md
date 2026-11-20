# StoryShelf on Azure (Terraform module)

Runs the published StoryShelf image (`ghcr.io/guptasiddhant/storyshelf`) on Azure Container Apps,
with Azure Database for PostgreSQL (Flexible Server) on private access, Blob storage and Key Vault.
It builds no image and creates no registry. ADR 0050 describes the decision; this page is the
reference.

## Use it

Pin a release with a git source (`?ref=v<version>`), and give `image_version` the same version:

```hcl
module "storyshelf" {
  source = "git::https://github.com/GuptaSiddhant/StoryShelf.git//deploy/terraform/azure?ref=v0.12.0"

  name                = "storyshelf"
  location            = "eastus"
  image_version       = "0.12.0"
  allowed_cidr_blocks = ["203.0.113.0/24"] # your office or VPN; ["0.0.0.0/0"] publishes the app
}
```

The provider needs `features {}` and a subscription (`ARM_SUBSCRIPTION_ID`). Each stable release also
attaches `storyshelf-terraform-<version>.tar.gz` (the whole `deploy/terraform/` folder). Upgrade by
changing both versions together and reading the release notes. A runnable example is in
`examples/minimal/`.

## What it creates

| Part     | Resources                                                                            |
| -------- | ------------------------------------------------------------------------------------ |
| Network  | VNet with a Container Apps subnet and a delegated Postgres subnet                    |
| Compute  | Container Apps environment (Consumption profile), one app of identical copies        |
| Database | Postgres Flexible Server 16, private access only, private DNS zone (or your own URL) |
| Storage  | Storage account and a private `storybook` Blob container                             |
| Identity | One user-assigned managed identity for the app                                       |
| Secrets  | Key Vault (RBAC): `SECRET`, `ADMIN-TOKEN`, `OIDC-CLIENT-SECRET`, `DATABASE-URL`      |
| Logs     | Log Analytics workspace                                                              |

The app is served on the Container Apps default domain over HTTPS; `allowed_cidr_blocks` becomes its
ingress IP restrictions. A custom domain and sign-in federation (Entra) are not part of the module.
The database has no public endpoint: only the VNet reaches it.

## Inputs

| Name                                                           | Default                            | Meaning                                                               |
| -------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------- |
| `name`                                                         | required                           | Name prefix, 2-20 characters                                          |
| `image_version`                                                | required                           | Release version of the image (no `v`)                                 |
| `allowed_cidr_blocks`                                          | required                           | Who may reach the app                                                 |
| `location`                                                     | `eastus`                           | Region                                                                |
| `image_repository`                                             | `ghcr.io/guptasiddhant/storyshelf` | Registry path, for a mirror                                           |
| `cpu` / `memory`                                               | `2` / `4Gi`                        | Capture renders in the container: do not go much lower                |
| `min_instances` / `max_instances`                              | `1` / `1`                          | Identical copies; at least 1 (see "Capture, scaling and shutdown")    |
| `database_pool_size`                                           | `10`                               | Connections per copy: `max_instances` x this must fit the database    |
| `shutdown_grace_seconds`                                       | `30`                               | See "Capture, scaling and shutdown"                                   |
| `existing_database_url_secret_id`                              | `""`                               | A Postgres URL in Key Vault; no database is created                   |
| `database_sku_name` / `database_storage_mb`                    | `B_Standard_B1ms` / `32768`        | Created database only                                                 |
| `deletion_protection`                                          | `true`                             | Delete lock on the database, purge protection on the vault            |
| `playwright_workspace_endpoint_secret_id` / `_token_secret_id` | `""`                               | Optional Azure Playwright Workspace (secret references, both or none) |
| `log_retention_days`                                           | `30`                               | Log Analytics retention                                               |
| `tags`                                                         | `{}`                               | Added to every taggable resource                                      |

## Outputs

`url`, `resource_group_name`, `container_app_name`, `storage_account_name`, `storage_container_name`,
`database_fqdn`, `key_vault_name`, `admin_token_secret_id`, `oidc_client_secret_id`,
`identity_principal_id`, `identity_client_id` and `role_assignments`. Secret outputs are Key Vault
ids (references), never values.

## Secrets

The app gets every secret as a Container Apps secret that is a **Key Vault reference** resolved by its
managed identity. No output carries a value.

- **`SECRET`, `ADMIN-TOKEN`** are generated. Their values, the database password and the storage
  database password are also in the Terraform state: keep the state in an encrypted backend with
  restricted access.
- **`OIDC-CLIENT-SECRET`** is an operator step. Terraform writes `change-me` once and never
  overwrites it:

  ```sh
  az keyvault secret set --vault-name "$(terraform output -raw key_vault_name)" --name OIDC-CLIENT-SECRET --value "<client secret>"
  az containerapp revision restart --name "$(terraform output -raw container_app_name)" --resource-group "$(terraform output -raw resource_group_name)" --revision <revision>
  ```

Terraform's own principal gets `Key Vault Secrets Officer` on the vault to write them, then waits 60
seconds for the role to take effect.

## Role assignments

`role_assignments` lists them. The app's identity has exactly:

| Role                            | Scope                          | Why                                    |
| ------------------------------- | ------------------------------ | -------------------------------------- |
| `Key Vault Secrets User`        | The module's Key Vault         | Resolve the app's secret references    |
| `Storage Blob Data Contributor` | The `storybook` Blob container | Read, write and delete Storybook files |

A secret in another vault (an existing database URL, a Playwright Workspace) needs `Key Vault Secrets
User` for `identity_principal_id` on that vault; the module does not grant it.

## Blob access

Blob access uses the app's managed identity, not the account key. The image gets `AZURE_STORAGE_ACCOUNT`,
`AZURE_STORAGE_CONTAINER` and `AZURE_CLIENT_ID`, and `storage-azure` signs in with
`DefaultAzureCredential` (the user-assigned identity, by client id), which holds `Storage Blob Data
Contributor` on the container. No connection string or account key is stored in Key Vault, passed to
the app or written to the Terraform state by this module. The account itself still allows shared-key
access (Terraform's own provider and your operators may use it); turn it off yourself if neither does.
Outside Azure, the image also takes `AZURE_STORAGE_CONNECTION` (a connection string) instead.

## Capture, scaling and shutdown

- **Capture runs in the container** (the image ships Chromium).
- **Azure Playwright Workspace** (optional, experimental): put the workspace's browser endpoint and an
  access token in Key Vault and pass both secret ids. They become `PLAYWRIGHT_SERVICE_URL` and
  `PLAYWRIGHT_SERVICE_ACCESS_TOKEN`, which add the `chromium@azure` target. The module attaches an
  existing workspace only; it creates none and builds no browser service.
- **Scaling** is more identical copies between `min_instances` and `max_instances`, scaled on
  concurrent requests. `min_instances` is at least 1: the capture and notify consumers poll in the
  background, and Container Apps stops a scaled-to-zero app until a request arrives.
- **Shutdown.** On a new revision the app gets SIGTERM and drains running captures for
  `shutdown_grace_seconds` (`SHUTDOWN_GRACE_SECONDS`), then hands the rest back to the queue. The
  container's termination grace is the grace plus 10 seconds, so it is never killed mid-drain.

## Image contract

| Variable                                                              | Source                          | Status |
| --------------------------------------------------------------------- | ------------------------------- | ------ |
| `PUBLIC_BASE_URL`, `TRUST_PROXY`, `SHUTDOWN_GRACE_SECONDS`            | module                          | read   |
| `SECRET`, `ADMIN_TOKEN`, `OIDC_CLIENT_SECRET`                         | Key Vault                       | read   |
| `DATABASE_URL`, `DATABASE_POOL_MAX`                                   | Key Vault, `database_pool_size` | read   |
| `PLAYWRIGHT_SERVICE_URL`, `PLAYWRIGHT_SERVICE_ACCESS_TOKEN`           | Key Vault references (optional) | read   |
| `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_CONTAINER`, `AZURE_CLIENT_ID` | the module                      | read   |

The image stores uploads in the Blob container when `AZURE_STORAGE_ACCOUNT` is set (managed identity),
or `AZURE_STORAGE_CONNECTION` for a host without one. Setting more than one storage backend refuses to
boot. The module's live apply stays behind the repository variable `LIVE_AZURE_MODULE_APPLY`: it is
billed, so the owner turns it on. No live Azure run has confirmed this path yet; the adapter is tested
against a faked SDK.

## Existing database

With `existing_database_url_secret_id` the module creates no database, subnet or private DNS zone and
passes the URL as `DATABASE_URL`. The network path to that database is yours.

## Destroying

Turn `deletion_protection` off and apply first (it removes the delete lock and purge protection), then
destroy. A destroyed Key Vault stays soft-deleted for 7 days unless the provider purges it
(`features { key_vault { purge_soft_delete_on_destroy = true } }`, as the example does).

## Checks

CI runs `terraform fmt -check`, `terraform validate` and `tflint` on every module under
`deploy/terraform`. The nightly live-cloud workflow applies `examples/minimal` with the current
release image, smoke-tests it and destroys it.
