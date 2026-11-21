# Cloud Run: one service of identical copies. Every copy serves the app and consumes the capture
# queue in the database, and renders in the container (the image ships Chromium). The module
# deploys the published image and never builds one.
locals {
  use_remote_repo = var.image_repository == ""
  image = local.use_remote_repo ? (
    "${var.region}-docker.pkg.dev/${var.project_id}/${var.name}-ghcr/guptasiddhant/storyshelf:${var.image_version}"
  ) : "${var.image_repository}:${var.image_version}"

  secret_env = merge(
    {
      SHELF_SECRET         = google_secret_manager_secret.shelf_secret.secret_id
      SHELF_ADMIN_TOKEN    = google_secret_manager_secret.admin_token.secret_id
      SHELF_ADMIN_PASSWORD = google_secret_manager_secret.auth_password.secret_id
      DATABASE_URL         = local.create_database ? google_secret_manager_secret.database_url[0].secret_id : var.existing_database_url_secret_id
    },
    var.github_app_private_key_secret_id == "" ? {} : { SHELF_GITHUB_APP_PRIVATE_KEY = var.github_app_private_key_secret_id },
    var.gitlab_token_secret_id == "" ? {} : { SHELF_GITLAB_TOKEN = var.gitlab_token_secret_id },
  )

  # The created database's CA (a public certificate, not a secret): the app verifies the server
  # certificate against it (SHELF_DATABASE_CA), so the password is never sent to an unverified peer.
  database_env = local.create_database ? { SHELF_DATABASE_CA = google_sql_database_instance.main[0].server_ca_cert[0].cert } : {}

  # Git connections (ADR 0054): plain values only; the key and the token are in secret_env.
  git_env = { for name, value in {
    SHELF_GITHUB_APP_ID        = var.github_app_id
    SHELF_GITHUB_API_URL       = var.github_api_url
    SHELF_GITLAB_TOKEN_EXPIRES = var.gitlab_token_expires
    SHELF_GITLAB_HOST          = var.gitlab_host
  } : name => value if value != "" }
}

# Cloud Run cannot pull from ghcr.io. A remote repository proxies the published image through
# Artifact Registry, so the module still deploys exactly the published bytes.
resource "google_artifact_registry_repository" "ghcr" {
  count = local.use_remote_repo ? 1 : 0

  project       = var.project_id
  location      = var.region
  repository_id = "${var.name}-ghcr"
  format        = "DOCKER"
  mode          = "REMOTE_REPOSITORY"
  description   = "Proxy of ghcr.io for the published StoryShelf image."
  labels        = local.labels

  remote_repository_config {
    docker_repository {
      custom_repository {
        uri = "https://ghcr.io"
      }
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_cloud_run_v2_service" "app" {
  project             = var.project_id
  name                = "${var.name}-app"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = var.deletion_protection
  labels              = local.labels

  template {
    service_account = google_service_account.app.email
    labels          = local.labels

    scaling {
      # The queue consumers poll in the background: a copy must always exist, and CPU must stay
      # allocated between requests (cpu_idle = false), or captures stall.
      min_instance_count = var.min_instances
      max_instance_count = max(var.min_instances, var.max_instances)
    }

    dynamic "vpc_access" {
      for_each = local.use_vpc ? [1] : []

      content {
        egress = "PRIVATE_RANGES_ONLY"

        network_interfaces {
          network    = local.network
          subnetwork = local.subnetwork
        }
      }
    }

    containers {
      image = local.image

      ports {
        container_port = 3000
      }

      resources {
        cpu_idle = false
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
      }

      startup_probe {
        http_get {
          path = "/api/v1/health"
        }

        period_seconds    = 5
        failure_threshold = 24
      }

      env {
        name  = "SHELF_GCS_BUCKET"
        value = google_storage_bucket.storybook.name
      }

      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }

      env {
        name  = "SHELF_TRUST_PROXY"
        value = "1"
      }

      env {
        name  = "SHELF_SHUTDOWN_GRACE_SECONDS"
        value = tostring(var.shutdown_grace_seconds)
      }

      env {
        name  = "SHELF_DATABASE_POOL_MAX"
        value = tostring(var.database_pool_size)
      }

      env {
        name  = "SHELF_PUBLIC_BASE_URL"
        value = local.public_base_url
      }

      env {
        name  = "SHELF_ADMIN_EMAIL"
        value = var.admin_email
      }

      dynamic "env" {
        for_each = local.database_env

        content {
          name  = env.key
          value = env.value
        }
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
          name = env.key

          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
    }
  }

  # The service account must be able to read the secrets, and the secrets must have a version,
  # before the first revision starts.
  depends_on = [
    google_secret_manager_secret_iam_member.app,
    google_storage_bucket_iam_member.app,
    google_secret_manager_secret_version.shelf_secret,
    google_secret_manager_secret_version.admin_token,
    google_secret_manager_secret_version.auth_password,
    google_secret_manager_secret_version.database_url,
    google_artifact_registry_repository.ghcr,
  ]
}

# Anyone can reach the service; the app's sign-in gates it (the generated SHELF_ADMIN_PASSWORD, plus the
# break-glass SHELF_ADMIN_TOKEN), and the image refuses to boot without it.
resource "google_cloud_run_v2_service_iam_member" "public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
