resource "azurerm_log_analytics_workspace" "main" {
  name                = "${var.name}-logs"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = var.log_retention_days

  tags = var.tags
}

resource "azurerm_container_app_environment" "main" {
  name                       = "${var.name}-env"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  infrastructure_subnet_id   = azurerm_subnet.apps.id

  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
  }

  tags = var.tags
}

# One app of identical copies: every copy serves the UI and consumes the database queue (ADR 0006).
# min_replicas stays at 1 or more: the capture and notify consumers poll in the background, and
# Container Apps stops a scaled-to-zero app until a request arrives.
resource "azurerm_container_app" "app" {
  name                         = local.app_name
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  dynamic "secret" {
    for_each = local.app_secrets

    content {
      name                = secret.key
      key_vault_secret_id = secret.value
      identity            = azurerm_user_assigned_identity.app.id
    }
  }

  template {
    min_replicas = var.min_instances
    max_replicas = max(var.min_instances, var.max_instances)

    # SIGTERM arrives, the app drains for shutdown_grace_seconds, then the process is killed.
    termination_grace_period_seconds = local.termination_secs

    container {
      name   = "app"
      image  = local.image
      cpu    = var.cpu
      memory = var.memory

      env {
        name  = "PUBLIC_BASE_URL"
        value = local.public_base_url
      }
      env {
        name  = "TRUST_PROXY"
        value = "1"
      }
      env {
        name  = "AUTH_EMAIL"
        value = var.auth_email
      }
      env {
        name  = "SHUTDOWN_GRACE_SECONDS"
        value = tostring(var.shutdown_grace_seconds)
      }
      env {
        name  = "DATABASE_POOL_MAX"
        value = tostring(var.database_pool_size)
      }
      env {
        name  = "AZURE_STORAGE_ACCOUNT"
        value = azurerm_storage_account.main.name
      }
      env {
        name  = "AZURE_STORAGE_CONTAINER"
        value = azurerm_storage_container.storybook.name
      }
      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.app.client_id
      }

      dynamic "env" {
        for_each = local.git_env

        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.secret_env

        content {
          name        = env.key
          secret_name = env.value
        }
      }

      startup_probe {
        transport               = "HTTP"
        port                    = 3000
        path                    = "/api/v1/health"
        interval_seconds        = 5
        failure_count_threshold = 24
      }

      liveness_probe {
        transport               = "HTTP"
        port                    = 3000
        path                    = "/api/v1/health"
        interval_seconds        = 30
        failure_count_threshold = 3
      }
    }

    http_scale_rule {
      name                = "requests"
      concurrent_requests = "50"
    }
  }

  ingress {
    external_enabled = true
    target_port      = 3000
    transport        = "auto"

    dynamic "ip_security_restriction" {
      for_each = var.allowed_cidr_blocks

      content {
        name             = "allow-${replace(replace(ip_security_restriction.value, ".", "-"), "/", "-")}"
        action           = "Allow"
        ip_address_range = ip_security_restriction.value
      }
    }

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  depends_on = [
    azurerm_role_assignment.app_secrets,
    azurerm_role_assignment.app_blobs,
  ]

  tags = var.tags
}
