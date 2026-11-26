terraform {
  required_version = ">= 1.9.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
  }
}

variable "name" {
  description = "Name prefix (unique per stack)."
  type        = string
  default     = "storyshelf"
}

variable "project_id" {
  description = "GCP project."
  type        = string
}

variable "region" {
  description = "GCP region."
  type        = string
  default     = "us-central1"
}

variable "image_version" {
  description = "Published image version, e.g. 0.12.0."
  type        = string
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# The module's db-init job uses google-beta; configure it like google.
provider "google-beta" {
  project = var.project_id
  region  = var.region
}

module "storyshelf" {
  # A real stack pins a release instead:
  #   source = "git::https://github.com/GuptaSiddhant/StoryShelf.git//deploy/terraform/gcp?ref=v0.12.0"
  source = "../.."

  name          = var.name
  project_id    = var.project_id
  region        = var.region
  image_version = var.image_version

  # A throwaway stack: delete the database and bucket on destroy.
  deletion_protection = false
}

output "url" {
  description = "Public base URL."
  value       = module.storyshelf.url
}

output "service_name" {
  description = "Cloud Run service name."
  value       = module.storyshelf.service_name
}
