# Secret Manager holds every app secret. Cloud Run receives them as secret references; no module
# output carries a value.
resource "google_secret_manager_secret" "shelf_secret" {
  project   = var.project_id
  secret_id = "${var.name}-secret"
  labels    = local.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret" "auth_password" {
  project   = var.project_id
  secret_id = "${var.name}-auth-password"
  labels    = local.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret" "admin_token" {
  project   = var.project_id
  secret_id = "${var.name}-admin-token"
  labels    = local.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

# SECRET, AUTH_PASSWORD and ADMIN_TOKEN are generated, so their values also sit in the Terraform
# state: keep the state in an encrypted backend with restricted access.
resource "random_password" "shelf_secret" {
  length  = 48
  special = false
}

resource "random_password" "auth_password" {
  length  = 32
  special = false
}

resource "random_password" "admin_token" {
  length  = 48
  special = false
}

resource "google_secret_manager_secret_version" "auth_password" {
  secret      = google_secret_manager_secret.auth_password.id
  secret_data = random_password.auth_password.result
}

resource "google_secret_manager_secret_version" "shelf_secret" {
  secret      = google_secret_manager_secret.shelf_secret.id
  secret_data = random_password.shelf_secret.result
}

resource "google_secret_manager_secret_version" "admin_token" {
  secret      = google_secret_manager_secret.admin_token.id
  secret_data = random_password.admin_token.result
}

# The created database's URL (with its password) lives only in Secret Manager. verify-full plus
# DATABASE_CA: the app checks the server certificate, whose CAS-issued SAN covers the private IP.
resource "google_secret_manager_secret" "database_url" {
  count = local.create_database ? 1 : 0

  project   = var.project_id
  secret_id = "${var.name}-database-url"
  labels    = local.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "database_url" {
  count = local.create_database ? 1 : 0

  secret = google_secret_manager_secret.database_url[0].id
  secret_data = format(
    "postgresql://%s:%s@%s:5432/%s?sslmode=verify-full",
    google_sql_user.shelf[0].name,
    random_password.database[0].result,
    google_sql_database_instance.main[0].private_ip_address,
    google_sql_database.shelf[0].name,
  )
}
