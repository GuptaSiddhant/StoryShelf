resource "azurerm_storage_account" "main" {
  name                            = "${substr(local.alnum, 0, 14)}${random_string.suffix.result}"
  resource_group_name             = azurerm_resource_group.main.name
  location                        = azurerm_resource_group.main.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false

  tags = var.tags
}

resource "azurerm_storage_container" "storybook" {
  name                  = "storybook"
  storage_account_id    = azurerm_storage_account.main.id
  container_access_type = "private"
}
