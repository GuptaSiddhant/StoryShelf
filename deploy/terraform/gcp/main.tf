# Shared locals and the APIs the module needs. Nothing here builds an image: the module deploys the
# published one by version.
locals {
  create_database = var.existing_database_url_secret_id == ""
  create_network  = var.network == ""

  # Direct VPC egress is needed for the private database, and for an existing database the
  # operator placed on a network.
  use_vpc = local.create_database || var.network != ""

  network    = local.create_network ? google_compute_network.main[0].id : var.network
  subnetwork = var.subnetwork != "" ? var.subnetwork : (local.create_network ? google_compute_subnetwork.main[0].id : "")

  apis = toset(concat(
    [
      "run.googleapis.com",
      "storage.googleapis.com",
      "secretmanager.googleapis.com",
      "artifactregistry.googleapis.com",
    ],
    local.create_database ? ["sqladmin.googleapis.com", "servicenetworking.googleapis.com", "compute.googleapis.com"] : [],
    local.use_vpc ? ["compute.googleapis.com"] : [],
  ))

  labels = merge(var.labels, { app = "storyshelf" })

  # Cloud Run's deterministic URL, known before the service exists, so the app always gets an https
  # SHELF_PUBLIC_BASE_URL (secure session cookies, correct links) even without public_base_url.
  public_base_url = var.public_base_url != "" ? var.public_base_url : "https://${var.name}-app-${data.google_project.this.number}.${var.region}.run.app"
}

data "google_project" "this" {
  project_id = var.project_id
}

resource "google_project_service" "apis" {
  for_each = local.apis

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
