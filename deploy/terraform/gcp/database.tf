# Cloud SQL for PostgreSQL on a private IP only: no public address, TLS required. The app reaches it
# through Direct VPC egress. The password is generated and kept in Secret Manager as part of the
# DATABASE_URL secret (see secrets.tf); it is never a module output.
resource "random_password" "database" {
  count = local.create_database ? 1 : 0

  length  = 32
  special = false
}

resource "google_sql_database_instance" "main" {
  count = local.create_database ? 1 : 0

  project             = var.project_id
  name                = "${var.name}-db"
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = var.deletion_protection

  settings {
    tier              = var.database_tier
    disk_size         = var.database_disk_size_gb
    disk_autoresize   = true
    availability_type = "ZONAL"
    user_labels       = local.labels

    backup_configuration {
      enabled = true
    }

    ip_configuration {
      ipv4_enabled    = false
      private_network = local.network
      ssl_mode        = "ENCRYPTED_ONLY"

      # A CAS-issued server certificate names the instance's IP addresses, so the app can verify it
      # (verify-full against SHELF_DATABASE_CA) while connecting over the private IP.
      server_ca_mode = "GOOGLE_MANAGED_CAS_CA"
    }
  }

  depends_on = [google_service_networking_connection.private_services]
}

resource "google_sql_database" "shelf" {
  count = local.create_database ? 1 : 0

  project  = var.project_id
  name     = "shelf"
  instance = google_sql_database_instance.main[0].name
}

resource "google_sql_user" "shelf" {
  count = local.create_database ? 1 : 0

  project  = var.project_id
  name     = "shelf"
  instance = google_sql_database_instance.main[0].name
  password = random_password.database[0].result
}
