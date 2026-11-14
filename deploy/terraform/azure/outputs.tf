output "url" {
  description = "Public base URL of the app (the Container Apps default domain, HTTPS)."
  value       = local.public_base_url
}

output "resource_group_name" {
  description = "Resource group of every resource."
  value       = azurerm_resource_group.main.name
}

output "container_app_name" {
  description = "Container App name."
  value       = azurerm_container_app.app.name
}

output "storage_account_name" {
  description = "Storage account of the Storybook container."
  value       = azurerm_storage_account.main.name
}

output "storage_container_name" {
  description = "Blob container of the uploaded Storybooks."
  value       = azurerm_storage_container.storybook.name
}

output "database_fqdn" {
  description = "Private FQDN of the Postgres server (null with an existing database URL). Reachable only from the VNet."
  value       = local.create_database ? azurerm_postgresql_flexible_server.main[0].fqdn : null
}

output "key_vault_name" {
  description = "Key Vault holding the app's secrets."
  value       = azurerm_key_vault.main.name
}

output "admin_token_secret_id" {
  description = "Versionless Key Vault id of the break-glass ADMIN_TOKEN (read it with the Azure CLI; it is not an output value)."
  value       = azurerm_key_vault_secret.admin_token.versionless_id
}

output "oidc_client_secret_id" {
  description = "Versionless Key Vault id to put the real OIDC client secret into."
  value       = azurerm_key_vault_secret.oidc_client_secret.versionless_id
}

output "identity_principal_id" {
  description = "Object id of the app's managed identity. Grant it Key Vault Secrets User on any other vault you reference (remote browser, existing database URL)."
  value       = azurerm_user_assigned_identity.app.principal_id
}

output "identity_client_id" {
  description = "Client id of the app's managed identity (AZURE_CLIENT_ID)."
  value       = azurerm_user_assigned_identity.app.client_id
}

output "role_assignments" {
  description = "Exactly what the app's identity may do: role and scope of each assignment."
  value = [
    {
      role  = azurerm_role_assignment.app_secrets.role_definition_name
      scope = azurerm_role_assignment.app_secrets.scope
    },
    {
      role  = azurerm_role_assignment.app_blobs.role_definition_name
      scope = azurerm_role_assignment.app_blobs.scope
    },
  ]
}
