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
      SECRET       = google_secret_manager_secret.shelf_secret.secret_id
      ADMIN_TOKEN  = google_secret_manager_secret.admin_token.secret_id
      DATABASE_URL = local.create_database ? google_secret_manager_secret.database_url[0].secret_id : var.existing_database_url_secret_id
    },
    var.remote_browser_endpoint_secret_id == "" ? {} : { REMOTE_BROWSER_ENDPOINT = var.remote_browser_endpoint_secret_id },
    var.remote_browser_token_secret_id == "" ? {} : { REMOTE_BROWSER_TOKEN = var.remote_browser_token_secret_id },
  )
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
        name  = "GCS_BUCKET"
        value = google_storage_bucket.storybook.name
      }

      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }

      env {
        name  = "TRUST_PROXY"
        value = "1"
      }

      env {
        name  = "SHUTDOWN_GRACE_SECONDS"
        value = tostring(var.shutdown_grace_seconds)
      }

      env {
        name  = "DATABASE_POOL_MAX"
        value = tostring(var.database_pool_size)
      }

      dynamic "env" {
        for_each = var.public_base_url == "" ? [] : [var.public_base_url]

        content {
          name  = "PUBLIC_BASE_URL"
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
    google_secret_manager_secret_version.database_url,
    google_artifact_registry_repository.ghcr,
  ]
}

# The app has its own sign-in (ADMIN_TOKEN, OIDC), so the service itself is public.
resource "google_cloud_run_v2_service_iam_member" "public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
