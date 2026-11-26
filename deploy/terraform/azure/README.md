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

The provider needs `features {}`, `storage_use_azuread = true` (the storage account refuses shared keys,
see "Blob access") and a subscription (`ARM_SUBSCRIPTION_ID`). Each stable release also
attaches `storyshelf-terraform-<version>.tar.gz` (the whole `deploy/terraform/` folder). Upgrade by
changing both versions together and reading the release notes. A runnable example is in
`examples/minimal/`.

## What it creates

| Part     | Resources                                                                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network  | VNet with a Container Apps subnet and a delegated Postgres subnet                                                                                    |
| Compute  | Container Apps environment (Consumption profile), one app of identical copies                                                                        |
| Database | Postgres Flexible Server 16, private access only, private DNS zone (or your own URL)                                                                 |
| Storage  | Storage account and a private `storybook` Blob container                                                                                             |
| Identity | One user-assigned managed identity for the app                                                                                                       |
| Secrets  | Key Vault (RBAC): `SHELF-SECRET`, `SHELF-ADMIN-PASSWORD`, `SHELF-ADMIN-TOKEN`, `SHELF-OIDC-CLIENT-SECRET`, `DATABASE-URL`, `DATABASE-ADMIN-PASSWORD` |
| Logs     | Log Analytics workspace                                                                                                                              |

The app is served on the Container Apps default domain over HTTPS; `allowed_cidr_blocks` becomes its
ingress IP restrictions. A custom domain and sign-in federation (Entra) are not part of the module.
The database has no public endpoint: only the VNet reaches it.

## Inputs

| Name                                                           | Default                                   | Meaning                                                                                                                       |
| -------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `name`                                                         | required                                  | Name prefix, 2-20 characters                                                                                                  |
| `image_version`                                                | required                                  | Release version of the image (no `v`)                                                                                         |
| `allowed_cidr_blocks`                                          | required                                  | Who may reach the app                                                                                                         |
| `location`                                                     | `eastus`                                  | Region                                                                                                                        |
| `image_repository`                                             | `ghcr.io/guptasiddhant/storyshelf`        | Registry path, for a mirror                                                                                                   |
| `cpu` / `memory`                                               | `2` / `4Gi`                               | Capture renders in the container: do not go much lower                                                                        |
| `min_instances` / `max_instances`                              | `1` / `1`                                 | Identical copies; at least 1 (see "Capture, scaling and shutdown")                                                            |
| `database_pool_size`                                           | `10`                                      | Connections per copy: `max_instances` x this must fit the database                                                            |
| `shutdown_grace_seconds`                                       | `30`                                      | See "Capture, scaling and shutdown"                                                                                           |
| `existing_database_url_secret_id`                              | `""`                                      | A Postgres URL in Key Vault; no database is created                                                                           |
| `database_sku_name` / `database_storage_mb`                    | `B_Standard_B1ms` / `32768`               | Created database only                                                                                                         |
| `deletion_protection`                                          | `true`                                    | Delete lock on the database, purge protection on the vault                                                                    |
| `database_init_image`                                          | ECR Public `postgres:16-alpine` by digest | Image of the `db-init` init container (needs `psql` 16+); it receives the administrator's password, so pin a mirror by digest |
| `playwright_workspace_endpoint_secret_id` / `_token_secret_id` | `""`                                      | Optional Azure Playwright Workspace (secret references, both or none)                                                         |
| `github_app_id` / `github_app_private_key_secret_id`           | `""`                                      | Server-wide GitHub App connection (both or none; see "Git connections")                                                       |
| `github_api_url`                                               | `""`                                      | GitHub Enterprise Server API base; empty means github.com                                                                     |
| `gitlab_token_secret_id` / `gitlab_token_expires`              | `""`                                      | Server-wide GitLab connection (both or none)                                                                                  |
| `gitlab_host`                                                  | `""`                                      | GitLab base URL; empty means gitlab.com                                                                                       |
| `admin_email`                                                  | `admin@example.com`                       | Local admin login email (`SHELF_ADMIN_EMAIL`)                                                                                 |
| `log_retention_days`                                           | `30`                                      | Log Analytics retention                                                                                                       |
| `tags`                                                         | `{}`                                      | Added to every taggable resource                                                                                              |

## Outputs

`url`, `resource_group_name`, `container_app_name`, `storage_account_name`, `storage_container_name`,
`database_fqdn`, `key_vault_name`, `admin_token_secret_id`, `admin_password_secret_id`, `database_admin_password_secret_id`, `oidc_client_secret_id`,
`identity_principal_id`, `identity_client_id` and `role_assignments`. Secret outputs are Key Vault
ids (references), never values.

## Secrets

The app gets every secret as a Container Apps secret that is a **Key Vault reference** resolved by its
managed identity. No output carries a value.

- **`SHELF-SECRET`, `SHELF-ADMIN-PASSWORD`, `SHELF-ADMIN-TOKEN`** are generated. What lands in the
  Terraform state: their values, both database passwords (the administrator's and the app role's,
  inside `DATABASE-URL`), the storage account's access keys and connection strings, and the Log
  Analytics workspace's shared keys (the provider records the keys as computed attributes, whether or
  not anything uses them). Keep the state in an encrypted backend with restricted access.
- **Sign-in.** The image turns sign-in on from `SHELF_ADMIN_PASSWORD` and `SHELF_SECRET`, and the module always
  sets both, so the app never boots open. Read the password with
  `az keyvault secret show --vault-name "$(terraform output -raw key_vault_name)" --name SHELF-ADMIN-PASSWORD --query value -o tsv`
  and sign in as `admin@example.com` (or `admin_email`).
- **`SHELF-OIDC-CLIENT-SECRET`** is an operator step. Terraform writes `change-me` once and never
  overwrites it:

  ```sh
  az keyvault secret set --vault-name "$(terraform output -raw key_vault_name)" --name SHELF-OIDC-CLIENT-SECRET --value "<client secret>"
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

Blob access uses the app's managed identity, not the account key. The image gets `SHELF_AZURE_ACCOUNT`,
`SHELF_AZURE_CONTAINER` and `AZURE_CLIENT_ID`, and `@storyshelf/storage/azure` signs in with
`DefaultAzureCredential` (the user-assigned identity, by client id), which holds `Storage Blob Data
Contributor` on the container. No connection string or account key is stored in Key Vault or passed to
the app.

The storage account sets `shared_access_key_enabled = false`, so no account key or account SAS works
against it, whoever holds one. The account keys and connection strings **remain in the Terraform
state**, because the provider records them as computed attributes, but they cannot be used. Keep the
state in an encrypted backend anyway.

Terraform therefore manages the account through Azure AD: set `storage_use_azuread = true` in your
`provider "azurerm"` block (the example does). The container, the role assignment and the account
itself are management-plane resources and need no key. The identity running Terraform also needs a
data-plane role on the account, because the provider reads the account's blob service settings through
the data plane: grant it `Storage Blob Data Contributor` on the resource group or subscription **before
the first apply**. The module cannot grant it, because the provider reads the account as soon as it is
created, before a role assignment could take effect. That identity already needs `Owner` or `User Access
Administrator` to create the module's role assignments. Operators who browse the container with `az
storage` or the portal need the same role (`--auth-mode login`), not a key.

Outside Azure, the image also takes `SHELF_AZURE_CONNECTION_STRING` (a connection string) instead; that
needs an account that allows shared keys, so it does not work against this module's account.

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
  `shutdown_grace_seconds` (`SHELF_SHUTDOWN_GRACE_SECONDS`), then hands the rest back to the queue. The
  container's termination grace is the grace plus 10 seconds, so it is never killed mid-drain.

## Git connections

Optional, for merge gates and pull-request comments without anyone pasting a key (ADR 0054). Create
the GitHub App's private key, or a GitLab group or project access token (`api` scope), as a
Key Vault secret yourself, then pass its reference. Terraform holds only the reference, so the key
and the token never enter configuration or state; the app reads them as
`SHELF_GITHUB_APP_PRIVATE_KEY` and `SHELF_GITLAB_TOKEN`. The app's identity reads only this stack's vault (`Key Vault Secrets User`), so create them there, or grant the identity that role on your own vault. A half-set connection fails the plan,
and the image refuses to boot on one too, naming the variable and never its value. Rotating a key is
a new secret version and a new revision.

```sh
az keyvault secret set --vault-name "$(terraform output -raw key_vault_name)" --name GITHUB-APP-PRIVATE-KEY --file app.private-key.pem
```

## Image contract

| Variable                                                                                         | Source                          | Status |
| ------------------------------------------------------------------------------------------------ | ------------------------------- | ------ |
| `SHELF_PUBLIC_BASE_URL`, `SHELF_TRUST_PROXY`, `SHELF_SHUTDOWN_GRACE_SECONDS`                     | module                          | read   |
| `SHELF_SECRET`, `SHELF_ADMIN_PASSWORD`, `SHELF_ADMIN_TOKEN`, `SHELF_OIDC_CLIENT_SECRET`          | Key Vault                       | read   |
| `SHELF_ADMIN_EMAIL`                                                                              | `admin_email`                   | read   |
| `DATABASE_URL`, `SHELF_DATABASE_POOL_MAX`                                                        | Key Vault, `database_pool_size` | read   |
| `PLAYWRIGHT_SERVICE_URL`, `PLAYWRIGHT_SERVICE_ACCESS_TOKEN`                                      | Key Vault references (optional) | read   |
| `SHELF_AZURE_ACCOUNT`, `SHELF_AZURE_CONTAINER`, `AZURE_CLIENT_ID`                                | the module                      | read   |
| `SHELF_GITHUB_APP_ID`, `SHELF_GITHUB_API_URL`, `SHELF_GITLAB_HOST`, `SHELF_GITLAB_TOKEN_EXPIRES` | git inputs (optional)           | read   |
| `SHELF_GITHUB_APP_PRIVATE_KEY`, `SHELF_GITLAB_TOKEN`                                             | Key Vault references (optional) | read   |

The image stores uploads in the Blob container when `SHELF_AZURE_ACCOUNT` is set (managed identity),
or `SHELF_AZURE_CONNECTION_STRING` for a host without one. Setting more than one storage backend refuses to
boot. The module's live apply stays behind the repository variable `LIVE_AZURE_MODULE_APPLY`: it is
billed, so the owner turns it on. No live Azure run has confirmed this path yet; the adapter is tested
against a faked SDK.

## Database TLS

The module's `DATABASE_URL` says `sslmode=verify-full` and connects by the server's FQDN. Flexible
Server certificates chain to public roots and name that FQDN, so the app verifies the certificate
against the system CAs and never sends the password to an unverified peer. _Unverified:_ no live run
has confirmed the check over the private DNS zone yet.

## Database roles

The app does not log in as the server's administrator. Two logins:

- **`shelf`** is the Flexible Server's `administrator_login` (a member of `azure_pg_admin`), kept for
  operators. Its password is `DATABASE-ADMIN-PASSWORD` in the vault (output
  `database_admin_password_secret_id`); the app container's environment never has it. The name stays
  `shelf` because a Flexible Server's administrator cannot be renamed without replacing the server.
- **`shelf_app`** is the app's role, in `DATABASE_URL`. It is an ordinary role (no `CREATEROLE`, no
  `CREATEDB`, not in `azure_pg_admin`) with all rights on the `shelf` database and its `public`
  schema, and it owns the tables the app creates.

**First boot needs no operator step.** Each replica runs a `db-init` init container before the app
container (`database_init_image`: `postgres:16-alpine` from the ECR Public mirror, which has `psql`,
pinned by digest because it receives the administrator's password). It logs in as `shelf` over TLS
verified against the system roots (`sslmode=verify-full`, `sslrootcert=system`, by the FQDN), then
idempotently creates `shelf_app` (or resets its password to the one in `DATABASE-URL`) and grants it the
database and the `public` schema. The app container starts only after `db-init` exits successfully;
its output is in the Log Analytics workspace under the `db-init` container.

**Upgrading a stack from 0.17 or earlier**, where the app logged in as `shelf` and so `shelf` owns its
tables: `db-init` also hands every table, view and sequence that `shelf` owns in `public` to
`shelf_app` (it grants `shelf_app` to `shelf` to be allowed to). The apply rewrites `DATABASE-URL` and
rolls a new revision; nothing else changes.

> **Unverified.** `db-init` has been run against a local Postgres 16 with a non-superuser
> administrator (fresh install, upgrade with existing tables, and a second run), and the module passes
> `terraform validate`, but it has not yet run against a real Flexible Server.

The init container gets the administrator's password through a Container Apps secret, so the app
container never sees it. The app's managed identity still holds `Key Vault Secrets User` on the whole
vault, so code running as the app could read `DATABASE-ADMIN-PASSWORD` from Key Vault directly; the
separation is from the app's environment, not from its identity.

## Existing database

With `existing_database_url_secret_id` the module creates no database, subnet or private DNS zone and
passes the URL as `DATABASE_URL`, and runs no `db-init`: give it a URL for an unprivileged role. The
network path to that database is yours.

## Destroying

Turn `deletion_protection` off and apply first (it removes the delete lock and purge protection), then
destroy. A destroyed Key Vault stays soft-deleted for 7 days unless the provider purges it
(`features { key_vault { purge_soft_delete_on_destroy = true } }`, as the example does).

## Checks

CI runs `terraform fmt -check`, `terraform validate` and `tflint` on every module under
`deploy/terraform`. The nightly live-cloud workflow applies `examples/minimal` with the current
release image, smoke-tests it and destroys it.
