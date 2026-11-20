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

resource "azurerm_key_vault_secret" "shelf_secret" {
  name         = "SECRET"
  value        = random_password.shelf_secret.result
  key_vault_id = azurerm_key_vault.main.id

  depends_on = [time_sleep.role_propagation]
}

resource "azurerm_key_vault_secret" "admin_token" {
  name         = "ADMIN-TOKEN"
  value        = random_password.admin_token.result
  key_vault_id = azurerm_key_vault.main.id

  depends_on = [time_sleep.role_propagation]
}

# An operator step: Terraform writes "change-me" once and never overwrites the real value.
resource "azurerm_key_vault_secret" "oidc_client_secret" {
  name         = "OIDC-CLIENT-SECRET"
  value        = "change-me"
  key_vault_id = azurerm_key_vault.main.id

  lifecycle {
    ignore_changes = [value]
  }

  depends_on = [time_sleep.role_propagation]
}

resource "azurerm_key_vault_secret" "database_url" {
  count        = local.create_database ? 1 : 0
  name         = "DATABASE-URL"
  value        = "postgresql://shelf:${random_password.database[0].result}@${azurerm_postgresql_flexible_server.main[0].fqdn}:5432/shelf?sslmode=require"
  key_vault_id = azurerm_key_vault.main.id

  depends_on = [time_sleep.role_propagation, azurerm_postgresql_flexible_server_database.shelf]
}

locals {
  # Container App secret name -> versionless Key Vault secret id.
  app_secrets = merge(
    {
      "shelf-secret"       = azurerm_key_vault_secret.shelf_secret.versionless_id
      "admin-token"        = azurerm_key_vault_secret.admin_token.versionless_id
      "oidc-client-secret" = azurerm_key_vault_secret.oidc_client_secret.versionless_id
      "database-url"       = local.create_database ? azurerm_key_vault_secret.database_url[0].versionless_id : var.existing_database_url_secret_id
    },
    local.playwright ? {
      "playwright-endpoint" = var.playwright_workspace_endpoint_secret_id
      "playwright-token"    = var.playwright_workspace_token_secret_id
    } : {},
  )

  # Environment variable -> Container App secret name.
  secret_env = merge(
    {
      "SECRET"                   = "shelf-secret"
      "ADMIN_TOKEN"              = "admin-token"
      "OIDC_CLIENT_SECRET"       = "oidc-client-secret"
      "DATABASE_URL"             = "database-url"
    },
    local.playwright ? {
      "PLAYWRIGHT_SERVICE_URL"          = "playwright-endpoint"
      "PLAYWRIGHT_SERVICE_ACCESS_TOKEN" = "playwright-token"
    } : {},
  )
}
