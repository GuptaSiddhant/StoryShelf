# A VPC for Direct VPC egress (the app reaches the database over private IP) and the private
# services range Cloud SQL attaches to. With `network` set the module creates none of it.
resource "google_compute_network" "main" {
  count = local.create_network && local.use_vpc ? 1 : 0

  project                 = var.project_id
  name                    = "${var.name}-vpc"
  auto_create_subnetworks = false

  depends_on = [google_project_service.apis]
}

resource "google_compute_subnetwork" "main" {
  count = local.create_network && local.use_vpc ? 1 : 0

  project                  = var.project_id
  name                     = "${var.name}-subnet"
  region                   = var.region
  network                  = google_compute_network.main[0].id
  ip_cidr_range            = "10.20.0.0/24"
  private_ip_google_access = true
}

# Private services access: the range Cloud SQL takes its private IP from.
resource "google_compute_global_address" "private_services" {
  count = local.create_database ? 1 : 0

  project       = var.project_id
  name          = "${var.name}-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = local.network
}

resource "google_service_networking_connection" "private_services" {
  count = local.create_database ? 1 : 0

  network                 = local.network
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services[0].name]

  depends_on = [google_project_service.apis]
}
