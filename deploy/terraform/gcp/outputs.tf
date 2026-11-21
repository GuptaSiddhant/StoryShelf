output "url" {
  description = "Public base URL of the app (public_base_url, or the service's deterministic Cloud Run URL)."
  value       = local.public_base_url
}

output "service_name" {
  description = "Cloud Run service name."
  value       = google_cloud_run_v2_service.app.name
}

output "gcs_bucket" {
  description = "Storybook bucket."
  value       = google_storage_bucket.storybook.name
}

output "db_instance" {
  description = "Cloud SQL instance connection name (null with an existing database URL)."
  value       = local.create_database ? google_sql_database_instance.main[0].connection_name : null
}

output "db_private_ip" {
  description = "Private IP of the database (null with an existing database URL). There is no public address."
  value       = local.create_database ? google_sql_database_instance.main[0].private_ip_address : null
}

output "database_url_secret_id" {
  description = "Secret Manager secret id holding the database URL (a reference, not a value)."
  value       = local.create_database ? google_secret_manager_secret.database_url[0].secret_id : var.existing_database_url_secret_id
}

output "admin_token_secret_id" {
  description = "Secret Manager secret id of the break-glass SHELF_ADMIN_TOKEN (read it with gcloud; it is not an output value)."
  value       = google_secret_manager_secret.admin_token.secret_id
}

output "service_account_email" {
  description = "Service account the app runs as."
  value       = google_service_account.app.email
}

output "service_account_roles" {
  description = "The exact grants of the app's service account, as resource and role. Nothing is granted at project level."
  value = concat(
    [{ resource = "bucket ${google_storage_bucket.storybook.name}", role = "roles/storage.objectUser" }],
    [for id in local.app_secret_ids : { resource = "secret ${id}", role = "roles/secretmanager.secretAccessor" }],
  )
}

output "admin_password_secret_id" {
  description = "Secret Manager id of the generated admin password (read it with gcloud; it is not an output value)."
  value       = google_secret_manager_secret.auth_password.secret_id
}
