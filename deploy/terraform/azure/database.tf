# The master password is generated, written only to Key Vault (secrets.tf) and, because Terraform
# manages it, to the state: keep the state in an encrypted backend with restricted access.
resource "random_password" "database" {
  count   = local.create_database ? 1 : 0
  length  = 32
  special = false
}

resource "azurerm_postgresql_flexible_server" "main" {
  count                         = local.create_database ? 1 : 0
  name                          = "${var.name}-db-${random_string.suffix.result}"
  resource_group_name           = azurerm_resource_group.main.name
  location                      = azurerm_resource_group.main.location
  version                       = "16"
  administrator_login           = "shelf"
  administrator_password        = random_password.database[0].result
  sku_name                      = var.database_sku_name
  storage_mb                    = var.database_storage_mb
  backup_retention_days         = 7
  delegated_subnet_id           = azurerm_subnet.database[0].id
  private_dns_zone_id           = azurerm_private_dns_zone.database[0].id
  public_network_access_enabled = false

  # Azure picks the zone; naming it back would force a replacement.
  lifecycle {
    ignore_changes = [zone]
  }

  depends_on = [azurerm_private_dns_zone_virtual_network_link.database]

  tags = var.tags
}

resource "azurerm_postgresql_flexible_server_database" "shelf" {
  count     = local.create_database ? 1 : 0
  name      = "shelf"
  server_id = azurerm_postgresql_flexible_server.main[0].id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

resource "azurerm_management_lock" "database" {
  count      = local.create_database && var.deletion_protection ? 1 : 0
  name       = "${var.name}-database-protect"
  scope      = azurerm_postgresql_flexible_server.main[0].id
  lock_level = "CanNotDelete"
  notes      = "deletion_protection of the StoryShelf module"
}
