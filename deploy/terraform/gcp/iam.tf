locals {
  # Secrets the service reads, by secret id: the app's own, the database URL and the optional
  # remote-browser references.
  app_secret_ids = compact([
    google_secret_manager_secret.shelf_secret.secret_id,
    google_secret_manager_secret.admin_token.secret_id,
    local.create_database ? google_secret_manager_secret.database_url[0].secret_id : var.existing_database_url_secret_id,
    var.remote_browser_endpoint_secret_id,
    var.remote_browser_token_secret_id,
  ])
}

# The app runs as its own service account, with exactly the grants below and nothing at project
# level. Cloud Run writes the container's logs itself; the app needs no logging role. The database
# is reached over private IP with a password from Secret Manager, so no Cloud SQL role is needed.
resource "google_service_account" "app" {
  project      = var.project_id
  account_id   = "${var.name}-app"
  display_name = "StoryShelf app (${var.name})"
}

resource "google_storage_bucket_iam_member" "app" {
  bucket = google_storage_bucket.storybook.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.app.email}"
}

resource "google_secret_manager_secret_iam_member" "app" {
  for_each = toset(local.app_secret_ids)

  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app.email}"

  depends_on = [
    google_secret_manager_secret.shelf_secret,
    google_secret_manager_secret.admin_token,
    google_secret_manager_secret.database_url,
  ]
}
