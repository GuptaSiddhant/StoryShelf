import {
  TERRAFORM_REQUIRED_VERSION,
  terraformHeader,
  type TerraformFiles,
} from "./terraform-common.ts";

/**
 * Terraform scaffolding for the Azure reference stack.
 *
 * Pure string builders — no runtime dependencies. Emitted by
 * `storyshelf server init` when the deploy target is `azure`, alongside the
 * standard `src/index.ts` / `package.json` files.
 *
 * Reference stack: one Container App (serves the UI and consumes capture
 * jobs from the database queue) + Azure Blob Storage (storybook bundles) +
 * Postgres Flexible Server + Key Vault +
 * Microsoft Entra app (only when `entra_tenant_id` is set) + DNS zone
 * (only when `domain_name` is set). Hostname binding + managed TLS is a
 * post-apply step (see the generated README); the scaffold stops at the
 * DNS records plus domain-verification TXT.
 *
 * Output contract (stable keys, parsed by CI — see `AZURE_TERRAFORM_OUTPUT_KEYS`):
 * keys are always present; values are `""` when the resource is not
 * provisioned for the optional inputs.
 */

/** Options for the Azure Terraform scaffold. */
export interface AzureTerraformOptions {
  /** Project slug, used as a name prefix for all resources. */
  project: string;
  /** Azure region, e.g. `eastus`. */
  location: string;
  /** Public domain for the app. Empty leaves DNS out entirely. */
  domainName?: string;
  /** Entra tenant ID for the app registration. Empty skips identity. */
  entraTenantId?: string;
}

/**
 * Stable `terraform output -json` keys. CI (`live-cloud.yml`) parses these;
 * renaming a key is a breaking change — the unit tests pin this list.
 */
export const AZURE_TERRAFORM_OUTPUT_KEYS: readonly string[] = [
  "app_fqdn",
  "database_url",
  "entra_application_id",
  "entra_tenant_id",
  "storage_connection_string",
];

function header(): string {
  return terraformHeader("azure");
}

export function generateAzureVersions(): string {
  return `${header()}terraform {
  required_version = "${TERRAFORM_REQUIRED_VERSION}"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
}
`;
}

/** Git connections (ADR 0054, decision 9): the App ID, and references to secrets, never values. */
function gitVariables(): string {
  return `
# Git connections (ADR 0054, decision 9). The App ID is plain configuration; the private key and the
# GitLab token are names of secrets you create in this stack's Key Vault outside Terraform
# (az keyvault secret set), so their values never enter configuration or state. Empty keeps the
# connection off.
variable "github_app_id" {
  description = "GitHub App ID of the server's git connection. Empty leaves it off."
  type        = string
  default     = ""
}

variable "github_app_private_key_secret_name" {
  description = "Name of the Key Vault secret holding the GitHub App private key (PEM). Required with github_app_id."
  type        = string
  default     = ""
}

variable "github_api_url" {
  description = "GitHub Enterprise Server API base (https://ghe.example.com/api/v3). Empty means github.com."
  type        = string
  default     = ""
}

variable "gitlab_token_secret_name" {
  description = "Name of the Key Vault secret holding a GitLab group or project access token (api scope). Empty leaves GitLab off."
  type        = string
  default     = ""
}

variable "gitlab_token_expires" {
  description = "Expiry of the GitLab token (YYYY-MM-DD); the System page warns 30 days before. Required with gitlab_token_secret_name."
  type        = string
  default     = ""
}

variable "gitlab_host" {
  description = "GitLab base URL. Empty means https://gitlab.com."
  type        = string
  default     = ""
}
`;
}

export function generateAzureVariables(): string {
  return `${header()}variable "project" {
  description = "Project slug, used as a name prefix for all resources."
  type        = string
}

variable "location" {
  description = "Azure region for all resources."
  type        = string
  default     = "eastus"
}

variable "domain_name" {
  description = "Public domain for the app (DNS zone + records). Empty skips DNS."
  type        = string
  default     = ""
}

variable "entra_tenant_id" {
  description = "Entra tenant ID for the app registration. Empty skips identity."
  type        = string
  default     = ""
}

${gitVariables()}`;
}

export function generateAzureMain(): string {
  return `${header()}# One resource group per project. Storage account names allow only
# lowercase alphanumerics, so alphanum is the sanitized prefix.
resource "azurerm_resource_group" "main" {
  name     = "\${local.slug}-rg"
  location = var.location
}

locals {
  slug     = lower(var.project)
  alphanum = substr(replace(local.slug, "/[^a-z0-9]/", ""), 0, 16)

  # Git connections: plain values, and Key Vault references read by the app's identity at start.
  git_env = { for k, v in {
    SHELF_GITHUB_APP_ID        = var.github_app_id
    SHELF_GITHUB_API_URL       = var.github_api_url
    SHELF_GITLAB_TOKEN_EXPIRES = var.gitlab_token_expires
    SHELF_GITLAB_HOST          = var.gitlab_host
  } : k => v if v != "" }
  git_secrets = { for k, v in {
    SHELF_GITHUB_APP_PRIVATE_KEY = var.github_app_private_key_secret_name
    SHELF_GITLAB_TOKEN           = var.gitlab_token_secret_name
  } : k => v if v != "" }
}
`;
}

export function generateAzureMonitoring(): string {
  return `${header()}resource "azurerm_log_analytics_workspace" "main" {
  name                = "\${local.slug}-law"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
}

resource "azurerm_container_app_environment" "main" {
  name                       = "\${local.slug}-cae"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
}
`;
}

/** The identity and Key Vault secret references of the app (git-access.tf holds the identity). */
function gitAppBlocks(): string {
  return `  # Reads the git secrets from Key Vault (git-access.tf). Only added when one is configured.
  dynamic "identity" {
    for_each = length(local.git_secrets) > 0 ? [1] : []
    content {
      type         = "UserAssigned"
      identity_ids = [azurerm_user_assigned_identity.git[0].id]
    }
  }

  dynamic "secret" {
    for_each = local.git_secrets
    content {
      name                = lower(replace(secret.key, "_", "-"))
      key_vault_secret_id = "\${azurerm_key_vault.main.vault_uri}secrets/\${secret.value}"
      identity            = azurerm_user_assigned_identity.git[0].id
    }
  }
`;
}

/** The git connection's environment: plain values, and secrets by name. */
function gitEnvBlocks(): string {
  return `      dynamic "env" {
        for_each = local.git_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.git_secrets
        content {
          name        = env.key
          secret_name = lower(replace(env.key, "_", "-"))
        }
      }`;
}

export function generateAzureApp(): string {
  return `${header()}# App with external ingress. Image is a placeholder: push the
# scaffolded Dockerfile to ACR and update it before applying. The same
# app consumes capture jobs from the database and renders with Playwright,
# so it keeps one replica running and gets browser-sized resources.
resource "azurerm_container_app" "app" {
  name                         = "\${local.slug}-app"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"

${gitAppBlocks()}
  template {
    min_replicas = 1

    container {
      name   = "app"
      image  = "storyshelf:latest"
      cpu    = 2
      memory = "4Gi"

${gitEnvBlocks()}
    }
  }

  ingress {
    external_enabled = true
    target_port      = 3000

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }
}
`;
}

export function generateAzureDatabase(): string {
  return `${header()}# Postgres Flexible Server, smallest burstable SKU (test-profile
# default — raise sku_name for production). The server connects with
# createPostgresDatabase({ url: <db_endpoint output> }).
resource "random_password" "db" {
  length  = 32
  special = true
}

resource "azurerm_postgresql_flexible_server" "main" {
  name                   = "\${local.slug}-db"
  resource_group_name    = azurerm_resource_group.main.name
  location               = azurerm_resource_group.main.location
  version                = "16"
  administrator_login    = "shelfadmin"
  administrator_password = random_password.db.result
  storage_mb             = 32768
  sku_name               = "B_Standard_B1ms"
  backup_retention_days  = 7
}

resource "azurerm_postgresql_flexible_server_firewall_rule" "azure_services" {
  name             = "allow-azure-services"
  server_id        = azurerm_postgresql_flexible_server.main.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

resource "azurerm_postgresql_flexible_server_database" "shelf" {
  name      = "shelf"
  server_id = azurerm_postgresql_flexible_server.main.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}
`;
}

export function generateAzureStorage(): string {
  return `${header()}# Blob container for storybook bundles.
resource "azurerm_storage_account" "main" {
  name                     = "\${local.alphanum}shlf"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"
}

resource "azurerm_storage_container" "storybook" {
  name               = "storybook"
  storage_account_id = azurerm_storage_account.main.id
}
`;
}

export function generateAzureIdentity(): string {
  return `${header()}# Microsoft Entra app registration for OIDC. Skipped entirely
# when var.entra_tenant_id is empty (use any OIDC provider instead).
data "azurerm_client_config" "current" {}

resource "azuread_application" "shelf" {
  count        = var.entra_tenant_id == "" ? 0 : 1
  display_name = "\${var.project}-shelf"
}

resource "azuread_service_principal" "shelf" {
  count     = var.entra_tenant_id == "" ? 0 : 1
  client_id = azuread_application.shelf[0].client_id
}
`;
}

export function generateAzureSecrets(): string {
  return `${header()}# Key Vault: session secret, OIDC secret, break-glass admin
# token, and the Postgres password. Never check these into env files.
resource "azurerm_key_vault" "main" {
  name                       = "\${local.slug}-kv"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  enable_rbac_authorization  = true
  soft_delete_retention_days = 7
}

resource "azurerm_key_vault_secret" "shelf_secret" {
  name         = "SECRET"
  value        = "change-me"
  key_vault_id = azurerm_key_vault.main.id
}

resource "azurerm_key_vault_secret" "oidc_client_secret" {
  name         = "OIDC-CLIENT-SECRET"
  value        = "change-me"
  key_vault_id = azurerm_key_vault.main.id
}

resource "azurerm_key_vault_secret" "admin_token" {
  name         = "ADMIN-TOKEN"
  value        = "change-me"
  key_vault_id = azurerm_key_vault.main.id
}

resource "azurerm_key_vault_secret" "db_password" {
  name         = "DB-PASSWORD"
  value        = random_password.db.result
  key_vault_id = azurerm_key_vault.main.id
}
`;
}

/** The identity the app reads its git secrets with: Key Vault Secrets User on this stack's vault. */
export function generateAzureGitAccess(): string {
  return `${header()}resource "azurerm_user_assigned_identity" "git" {
  count               = length(local.git_secrets) > 0 ? 1 : 0
  name                = "\${local.slug}-git"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
}

resource "azurerm_role_assignment" "git" {
  count                = length(local.git_secrets) > 0 ? 1 : 0
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.git[0].principal_id
}
`;
}

export function generateAzureDns(): string {
  return `${header()}# DNS zone + verification TXT + app CNAME. Skipped entirely when
# var.domain_name is empty. Hostname binding + managed TLS is a
# post-apply step (see README): the records below are its prerequisite.
resource "azurerm_dns_zone" "main" {
  count               = var.domain_name == "" ? 0 : 1
  name                = var.domain_name
  resource_group_name = azurerm_resource_group.main.name
}

resource "azurerm_dns_txt_record" "verify" {
  count               = var.domain_name == "" ? 0 : 1
  name                = "asuid.app"
  zone_name           = azurerm_dns_zone.main[0].name
  resource_group_name = azurerm_resource_group.main.name
  ttl                 = 300

  record {
    value = azurerm_container_app_environment.main.custom_domain_verification_id
  }
}

resource "azurerm_dns_cname_record" "app" {
  count               = var.domain_name == "" ? 0 : 1
  name                = "app"
  zone_name           = azurerm_dns_zone.main[0].name
  resource_group_name = azurerm_resource_group.main.name
  ttl                 = 300
  record              = azurerm_container_app.app.latest_revision_fqdn
}
`;
}

export function generateAzureOutputs(): string {
  return `${header()}# Outputs feed directly into the scaffolded server's env. Keys are
# a stable contract parsed by CI — do not rename (tests pin the set).
# Values are "" when the optional resource is not provisioned.
output "app_fqdn" {
  value = azurerm_container_app.app.latest_revision_fqdn
}

output "storage_connection_string" {
  value     = azurerm_storage_account.main.primary_connection_string
  sensitive = true
}

output "database_url" {
  value     = "postgresql://shelfadmin:\${random_password.db.result}@\${azurerm_postgresql_flexible_server.main.fqdn}:5432/shelf?sslmode=require"
  sensitive = true
}

output "entra_application_id" {
  value = var.entra_tenant_id == "" ? "" : azuread_application.shelf[0].client_id
}

output "entra_tenant_id" {
  value = var.entra_tenant_id
}
`;
}

export function generateAzureTfvarsExample(): string {
  return `# Copy to terraform.tfvars and fill in per environment.
# CI test profile: pass a unique project per run instead —
#   terraform plan -var "project=shelf-ci-$GITHUB_RUN_ID"
project         = "my-storyshelf"
location        = "eastus"
domain_name     = ""
entra_tenant_id = ""
`;
}

function generateAzureEnvTable(): string {
  return `| Output | Env var | Adapter |
|---|---|---|
| \`storage_connection_string\` | \`AZURE_STORAGE_CONNECTION\` | \`storage-azure\` (Blob container) |
| \`database_url\` | \`DATABASE_URL\` | \`db-postgres\` |
| \`entra_application_id\` / \`entra_tenant_id\` | \`OIDC_CLIENT_ID\` / \`OIDC_ISSUER\` (\`https://login.microsoftonline.com/{tenant}/v2.0\`) | \`auth\` (keycloak recipe) |
| Key Vault entries \`SECRET\` / \`OIDC-CLIENT-SECRET\` / \`ADMIN-TOKEN\` | \`SECRET\` / \`OIDC_CLIENT_SECRET\` / \`ADMIN_TOKEN\` | sessions / OIDC / bootstrap |
| \`github_app_id\` + \`github_app_private_key_secret_name\` (optional) | \`SHELF_GITHUB_APP_ID\` / \`SHELF_GITHUB_APP_PRIVATE_KEY\` | server git connection (ADR 0054) |
| \`gitlab_token_secret_name\` + \`gitlab_token_expires\` (optional) | \`SHELF_GITLAB_TOKEN\` / \`SHELF_GITLAB_TOKEN_EXPIRES\` | server git connection (ADR 0054) |
`;
}

function generateAzureCiProfile(): string {
  return `## CI test profile

Smallest footprint, unique resources per run, documented destroy:

\`\`\`sh
export PROJECT="shelf-ci-$GITHUB_RUN_ID"   # unique prefix per run (all names derive from it)
terraform init
terraform plan -var "project=$PROJECT" -out=tfplan
terraform apply tfplan
terraform output -json   # or: npm run infra:outputs
# ... run live tests against the outputs ...
terraform destroy -var "project=$PROJECT" -auto-approve
\`\`\`

Cost notes: Postgres Flexible is the B1ms burstable SKU, Container Apps
run on consumption, and the app keeps a single replica running. Key Vault
uses 7-day soft-delete so re-running with the same project name within a
week reuses the vault (prefer a fresh unique prefix per run).
`;
}

export function generateAzureReadme(project: string): string {
  return `# ${project} on Azure

Scaffolded by \`storyshelf server init --target azure\`.

## Next steps

\`\`\`sh
az login
cd terraform
terraform init
terraform plan -out=tfplan   # review before applying
terraform apply tfplan
\`\`\`

## Wire outputs into env

\`\`\`sh
terraform output -json   # or: npm run infra:outputs
\`\`\`

${generateAzureEnvTable()}
\`\`\`sh
npm install
npm start
\`\`\`

Authenticate with \`az login\` (or a service principal / managed identity) —
never check connection strings into env files.

## Custom domain

The scaffold creates the DNS zone plus verification records. After
applying, bind the hostname and let Container Apps issue the managed
certificate (portal, or \`az containerapp hostname add\` once the CNAME
resolves).

${generateAzureCiProfile()}`;
}

const AZURE_FILES: ReadonlyArray<readonly [string, (options: AzureTerraformOptions) => string]> = [
  ["terraform/versions.tf", () => generateAzureVersions()],
  ["terraform/variables.tf", () => generateAzureVariables()],
  ["terraform/main.tf", () => generateAzureMain()],
  ["terraform/compute.tf", () => `${generateAzureMonitoring()}${generateAzureApp()}`],
  ["terraform/database.tf", () => generateAzureDatabase()],
  ["terraform/storage.tf", () => generateAzureStorage()],
  ["terraform/identity.tf", () => generateAzureIdentity()],
  ["terraform/secrets.tf", () => generateAzureSecrets()],
  ["terraform/git-access.tf", () => generateAzureGitAccess()],
  ["terraform/dns.tf", () => generateAzureDns()],
  ["terraform/outputs.tf", () => generateAzureOutputs()],
  ["terraform/terraform.tfvars.example", () => generateAzureTfvarsExample()],
];

/** Generate every Terraform file for the Azure reference stack. */
export function generateAzureTerraformFiles(options: AzureTerraformOptions): TerraformFiles {
  const files: TerraformFiles = {};
  for (const [path, generate] of AZURE_FILES) {
    files[path] = generate(options);
  }
  files["terraform/README.md"] = generateAzureReadme(options.project);
  return files;
}
