data "azurerm_client_config" "current" {}

# A short random suffix keeps the globally unique names (Key Vault, storage account) from colliding.
resource "random_string" "suffix" {
  length  = 6
  upper   = false
  special = false
}

resource "azurerm_resource_group" "main" {
  name     = "${var.name}-rg"
  location = var.location

  tags = var.tags
}

locals {
  alnum            = replace(var.name, "-", "")
  app_name         = "${var.name}-app"
  image            = "${var.image_repository}:${var.image_version}"
  create_database  = var.existing_database_url_secret_id == ""
  public_base_url  = "https://${local.app_name}.${azurerm_container_app_environment.main.default_domain}"
  playwright       = var.playwright_workspace_endpoint_secret_id != ""
  termination_secs = var.shutdown_grace_seconds + 10
}
