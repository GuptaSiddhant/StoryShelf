resource "azurerm_key_vault" "main" {
  name                       = "${substr(local.alnum, 0, 12)}-kv-${random_string.suffix.result}"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  soft_delete_retention_days = 7
  purge_protection_enabled   = var.deletion_protection

  tags = var.tags
}

# Whoever runs Terraform writes the secrets once.
resource "azurerm_role_assignment" "deployer_secrets" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

# A new role assignment takes a while to reach the data plane.
resource "time_sleep" "role_propagation" {
  create_duration = "60s"

  depends_on = [azurerm_role_assignment.deployer_secrets]
}

resource "random_password" "shelf_secret" {
  length  = 48
  special = false
}

resource "random_password" "admin_token" {
  length  = 48
  special = false
}

resource "random_password" "auth_password" {
  length  = 32
  special = false
}

resource "azurerm_key_vault_secret" "shelf_secret" {
  name         = "SHELF-SECRET"
  value        = random_password.shelf_secret.result
  key_vault_id = azurerm_key_vault.main.id

  depends_on = [time_sleep.role_propagation]
}

resource "azurerm_key_vault_secret" "admin_token" {
  name         = "SHELF-ADMIN-TOKEN"
  value        = random_password.admin_token.result
  key_vault_id = azurerm_key_vault.main.id

  depends_on = [time_sleep.role_propagation]
}

# The local admin's password: sign-in is on from the first boot, and the image refuses to boot without it.
resource "azurerm_key_vault_secret" "auth_password" {
  name         = "SHELF-ADMIN-PASSWORD"
  value        = random_password.auth_password.result
  key_vault_id = azurerm_key_vault.main.id

  depends_on = [time_sleep.role_propagation]
}

# An operator step: Terraform writes "change-me" once and never overwrites the real value.
resource "azurerm_key_vault_secret" "oidc_client_secret" {
  name         = "SHELF-OIDC-CLIENT-SECRET"
  value        = "change-me"
  key_vault_id = azurerm_key_vault.main.id

  lifecycle {
    ignore_changes = [value]
  }

  depends_on = [time_sleep.role_propagation]
}

# verify-full: the server's certificate chains to a public root and names this FQDN, so the app
# checks it against the system CAs and never sends the password to an unverified peer.
resource "azurerm_key_vault_secret" "database_url" {
  count        = local.create_database ? 1 : 0
  name         = "DATABASE-URL"
  value        = "postgresql://shelf:${random_password.database[0].result}@${azurerm_postgresql_flexible_server.main[0].fqdn}:5432/shelf?sslmode=verify-full"
  key_vault_id = azurerm_key_vault.main.id

  depends_on = [time_sleep.role_propagation, azurerm_postgresql_flexible_server_database.shelf]
}

locals {
  # Container App secret name -> versionless Key Vault secret id.
  app_secrets = merge(
    {
      "shelf-secret"             = azurerm_key_vault_secret.shelf_secret.versionless_id
      "shelf-admin-token"        = azurerm_key_vault_secret.admin_token.versionless_id
      "shelf-admin-password"     = azurerm_key_vault_secret.auth_password.versionless_id
      "shelf-oidc-client-secret" = azurerm_key_vault_secret.oidc_client_secret.versionless_id
      "database-url"             = local.create_database ? azurerm_key_vault_secret.database_url[0].versionless_id : var.existing_database_url_secret_id
    },
    local.playwright ? {
      "playwright-endpoint" = var.playwright_workspace_endpoint_secret_id
      "playwright-token"    = var.playwright_workspace_token_secret_id
    } : {},
    var.github_app_private_key_secret_id == "" ? {} : { "github-app-private-key" = var.github_app_private_key_secret_id },
    var.gitlab_token_secret_id == "" ? {} : { "gitlab-token" = var.gitlab_token_secret_id },
  )

  # Environment variable -> Container App secret name.
  secret_env = merge(
    {
      "SHELF_SECRET"             = "shelf-secret"
      "SHELF_ADMIN_TOKEN"        = "shelf-admin-token"
      "SHELF_ADMIN_PASSWORD"     = "shelf-admin-password"
      "SHELF_OIDC_CLIENT_SECRET" = "shelf-oidc-client-secret"
      "DATABASE_URL"             = "database-url"
    },
    local.playwright ? {
      "PLAYWRIGHT_SERVICE_URL"          = "playwright-endpoint"
      "PLAYWRIGHT_SERVICE_ACCESS_TOKEN" = "playwright-token"
    } : {},
    var.github_app_private_key_secret_id == "" ? {} : { "SHELF_GITHUB_APP_PRIVATE_KEY" = "github-app-private-key" },
    var.gitlab_token_secret_id == "" ? {} : { "SHELF_GITLAB_TOKEN" = "gitlab-token" },
  )

  # Git connections (ADR 0054): plain values only; the key and the token are in secret_env.
  git_env = { for name, value in {
    SHELF_GITHUB_APP_ID        = var.github_app_id
    SHELF_GITHUB_API_URL       = var.github_api_url
    SHELF_GITLAB_TOKEN_EXPIRES = var.gitlab_token_expires
    SHELF_GITLAB_HOST          = var.gitlab_host
  } : name => value if value != "" }
}
