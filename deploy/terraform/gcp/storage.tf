# Private bucket for Storybook bundles.
resource "google_storage_bucket" "storybook" {
  project                     = var.project_id
  name                        = "${var.project_id}-${var.name}-storybook"
  location                    = var.region
  force_destroy               = !var.deletion_protection
  public_access_prevention    = "enforced"
  uniform_bucket_level_access = true
  labels                      = local.labels

  versioning {
    enabled = true
  }

  depends_on = [google_project_service.apis]
}
