# Cloud SQL for PostgreSQL on a private IP only: no public address, TLS required. The app reaches it
# through Direct VPC egress.
#
# Two logins. `shelf` is created through the Cloud SQL API, which makes it a member of
# `cloudsqlsuperuser`: it is the operators' admin, and its password is in its own secret that the app
# cannot read. The app logs in as `shelf_app`, an ordinary role that the `db-init` job creates and
# grants rights on the `shelf` database and its `public` schema. Both passwords are generated and
# kept in Secret Manager (see secrets.tf); neither is a module output.
locals {
  database_name       = "shelf"
  database_admin_user = "shelf"
  database_app_user   = "shelf_app"
}

resource "random_password" "database" {
  count = local.create_database ? 1 : 0

  length  = 32
  special = false
}

resource "random_password" "database_app" {
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
  name     = local.database_name
  instance = google_sql_database_instance.main[0].name
}

# The admin. Its name stays `shelf` so an existing stack keeps its user (renaming would replace it,
# and the user owns the tables an earlier version of the module let the app create).
resource "google_sql_user" "shelf" {
  count = local.create_database ? 1 : 0

  project  = var.project_id
  name     = local.database_admin_user
  instance = google_sql_database_instance.main[0].name
  password = random_password.database[0].result
}

locals {
  # Idempotent, as the admin, over TLS verified against the instance's CA (verify-full by private
  # IP, which the CAS-issued certificate names). It creates the app role or resets its password,
  # grants it the database and the `public` schema, and hands it whatever the admin owns in
  # `public` (the tables an earlier version of the module let the app create as the admin). The
  # app's password comes from the DATABASE_URL secret, so it is stored once.
  db_init_script = <<-EOT
    set -e
    printf '%s\n' "$DATABASE_CA" > /tmp/server-ca.pem
    APP_PASSWORD=$(printf '%s' "$APP_DATABASE_URL" | sed -E 's#^[^:]*://[^:]*:([^@]*)@.*$#\1#')
    export APP_PASSWORD
    psql -v ON_ERROR_STOP=1 -v app_user=${local.database_app_user} -v app_db=${local.database_name} <<'SQL'
    \getenv app_password APP_PASSWORD
    SELECT format('CREATE ROLE %I LOGIN', :'app_user') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'app_user') \gexec
    SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'app_user', :'app_password') \gexec
    SELECT format('GRANT ALL ON DATABASE %I TO %I', :'app_db', :'app_user') \gexec
    SELECT format('GRANT ALL ON SCHEMA public TO %I', :'app_user') \gexec
    SELECT format('GRANT %I TO %I', :'app_user', current_user) WHERE NOT pg_has_role(current_user, :'app_user', 'SET') \gexec
    SELECT format('ALTER %s public.%I OWNER TO %I', CASE c.relkind WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END, c.relname, :'app_user')
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relowner = current_user::text::regrole AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
        AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype IN ('a', 'i')) \gexec
    SQL
  EOT

  # A new execution runs whenever anything the job reads changes; otherwise the job is not re-run.
  db_init_token = local.create_database ? substr(sha256(jsonencode([
    local.db_init_script,
    var.database_init_image,
    google_sql_database_instance.main[0].private_ip_address,
    google_secret_manager_secret_version.database_admin_password[0].version,
    google_secret_manager_secret_version.database_url[0].version,
  ])), 0, 12) : null
}

# db-init runs as its own service account, which reads exactly the admin password and the app's
# database URL. The app's service account cannot read the admin password.
resource "google_service_account" "db_init" {
  count = local.create_database ? 1 : 0

  project      = var.project_id
  account_id   = "${var.name}-db-init"
  display_name = "StoryShelf db-init (${var.name})"
}

resource "google_secret_manager_secret_iam_member" "db_init" {
  for_each = local.create_database ? {
    admin_password = google_secret_manager_secret.database_admin_password[0].secret_id
    database_url   = google_secret_manager_secret.database_url[0].secret_id
  } : {}

  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.db_init[0].email}"
}

# A one-shot Cloud Run job. `run_execution_token` makes Terraform start an execution when the job is
# created or changed and wait until it succeeds, and the service depends on it, so the app role
# exists before a revision that logs in as it starts.
resource "google_cloud_run_v2_job" "db_init" {
  count    = local.create_database ? 1 : 0
  provider = google-beta

  project  = var.project_id
  name     = "${var.name}-db-init"
  location = var.region
  labels   = local.labels

  # The job holds no data; destroying it with the stack is safe.
  deletion_protection = false
  run_execution_token = local.db_init_token

  template {
    labels     = local.labels
    task_count = 1

    template {
      service_account = google_service_account.db_init[0].email
      max_retries     = 3
      timeout         = "300s"

      vpc_access {
        egress = "PRIVATE_RANGES_ONLY"

        network_interfaces {
          network    = local.network
          subnetwork = local.subnetwork
        }
      }

      containers {
        image   = var.database_init_image
        command = ["sh", "-c", local.db_init_script]

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        env {
          name  = "PGHOST"
          value = google_sql_database_instance.main[0].private_ip_address
        }

        env {
          name  = "PGDATABASE"
          value = google_sql_database.shelf[0].name
        }

        env {
          name  = "PGUSER"
          value = google_sql_user.shelf[0].name
        }

        env {
          name  = "PGSSLMODE"
          value = "verify-full"
        }

        env {
          name  = "PGSSLROOTCERT"
          value = "/tmp/server-ca.pem"
        }

        # The instance's CA: a public certificate, not a secret.
        env {
          name  = "DATABASE_CA"
          value = google_sql_database_instance.main[0].server_ca_cert[0].cert
        }

        env {
          name = "PGPASSWORD"

          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_admin_password[0].secret_id
              version = google_secret_manager_secret_version.database_admin_password[0].version
            }
          }
        }

        env {
          name = "APP_DATABASE_URL"

          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url[0].secret_id
              version = google_secret_manager_secret_version.database_url[0].version
            }
          }
        }
      }
    }
  }

  depends_on = [
    google_secret_manager_secret_iam_member.db_init,
    google_sql_user.shelf,
    google_project_service.apis,
  ]
}
