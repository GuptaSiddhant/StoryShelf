variable "name" {
  description = "Name prefix for every resource (lowercase letters, digits and hyphens)."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,19}$", var.name))
    error_message = "name must be 2-20 characters: lowercase letters, digits and hyphens, starting with a letter."
  }
}

variable "project_id" {
  description = "GCP project that holds every resource. Billing must be on; the module enables the APIs it needs."
  type        = string
}

variable "region" {
  description = "Region of every resource. It must match the provider's region."
  type        = string
  default     = "us-central1"
}

variable "image_version" {
  description = "Version tag of the published image, e.g. \"0.12.0\" (without a leading v). Required: the module never deploys \"latest\"."
  type        = string

  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+\\.[0-9]+([-+][0-9A-Za-z.-]+)?$", var.image_version))
    error_message = "image_version must be a release version such as 0.12.0."
  }
}

variable "image_repository" {
  description = "Full registry path of the image, for a mirror in Artifact Registry. Empty (the default) creates an Artifact Registry remote repository that proxies ghcr.io/guptasiddhant/storyshelf, because Cloud Run cannot pull from ghcr.io directly."
  type        = string
  default     = ""
}

variable "public_base_url" {
  description = "Public origin of the app (PUBLIC_BASE_URL), e.g. when you map your own domain to the service. Empty lets the app use the Cloud Run origin."
  type        = string
  default     = ""
}

variable "network" {
  description = "Self link of an existing VPC network for Direct VPC egress and the database's private IP. Empty creates a VPC. Set together with subnetwork."
  type        = string
  default     = ""
}

variable "subnetwork" {
  description = "Self link of an existing subnetwork in var.region (Direct VPC egress needs a /26 or larger). Empty creates one."
  type        = string
  default     = ""
}

variable "cpu" {
  description = "CPU limit of each copy. Capture renders in the container, so keep at least 2."
  type        = string
  default     = "2"
}

variable "memory" {
  description = "Memory limit of each copy."
  type        = string
  default     = "4Gi"
}

variable "min_instances" {
  description = "Fewest identical app copies. Every copy serves the app and consumes the database queue (ADR 0006), so it must stay at 1 or more."
  type        = number
  default     = 1

  validation {
    condition     = var.min_instances >= 1
    error_message = "min_instances must be at least 1: the queue consumers run inside the service."
  }
}

variable "max_instances" {
  description = "Most identical app copies. Equal to min_instances disables autoscaling."
  type        = number
  default     = 1

  validation {
    condition     = var.max_instances >= 1
    error_message = "max_instances must be at least 1."
  }
}

variable "database_pool_size" {
  description = "Most database connections each copy opens (DATABASE_POOL_MAX). Keep max_instances x this below the database's connection limit."
  type        = number
  default     = 10
}

variable "shutdown_grace_seconds" {
  description = "How long a stopping copy drains running captures before it hands them back to the queue (SHUTDOWN_GRACE_SECONDS). Cloud Run sends SIGTERM and stops the container 10 seconds later and that is not configurable, so the grace must stay below it."
  type        = number
  default     = 8

  validation {
    condition     = var.shutdown_grace_seconds >= 1 && var.shutdown_grace_seconds <= 9
    error_message = "shutdown_grace_seconds must be 1-9: Cloud Run stops a container 10 seconds after SIGTERM."
  }
}

variable "existing_database_url_secret_id" {
  description = "Secret Manager secret id of a secret holding a postgres:// URL. When set, the module creates no database and passes the URL as DATABASE_URL; the network path to it is yours (set network and subnetwork if it is private)."
  type        = string
  default     = ""
}

variable "database_tier" {
  description = "Cloud SQL machine tier, used only when the module creates the database."
  type        = string
  default     = "db-custom-1-3840"
}

variable "database_disk_size_gb" {
  description = "Cloud SQL disk in GiB, used only when the module creates the database."
  type        = number
  default     = 10
}

variable "deletion_protection" {
  description = "Protect the created database from deletion; with false the bucket is also emptied on destroy. Turn it off for throwaway stacks."
  type        = bool
  default     = true
}

variable "remote_browser_endpoint_secret_id" {
  description = "Optional Secret Manager secret id of a remote-browser endpoint, passed as REMOTE_BROWSER_ENDPOINT. Capture runs in the container when unset. The module builds no browser service."
  type        = string
  default     = ""
}

variable "remote_browser_token_secret_id" {
  description = "Optional Secret Manager secret id of the remote-browser access token, passed as REMOTE_BROWSER_TOKEN."
  type        = string
  default     = ""
}

variable "labels" {
  description = "Labels added to every resource that supports them."
  type        = map(string)
  default     = {}
}

# Git connections (ADR 0054, decision 9). The App ID is plain configuration; the private key and the
# GitLab token are Secret Manager secrets you create outside Terraform (same project), so their
# values never enter configuration or state. Empty keeps a connection off.
variable "github_app_id" {
  description = "GitHub App ID of the server's git connection, passed as SHELF_GITHUB_APP_ID. Empty leaves it off."
  type        = string
  default     = ""
}

variable "github_app_private_key_secret_id" {
  description = "Secret Manager secret id holding the GitHub App private key (PEM), passed as SHELF_GITHUB_APP_PRIVATE_KEY. Set with github_app_id."
  type        = string
  default     = ""

  validation {
    condition     = (var.github_app_id == "") == (var.github_app_private_key_secret_id == "")
    error_message = "Set both github_app_id and github_app_private_key_secret_id, or neither."
  }
}

variable "github_api_url" {
  description = "GitHub Enterprise Server API base (https://ghe.example.com/api/v3), passed as SHELF_GITHUB_API_URL. Empty means github.com."
  type        = string
  default     = ""
}

variable "gitlab_token_secret_id" {
  description = "Secret Manager secret id holding a GitLab group or project access token (api scope), passed as SHELF_GITLAB_TOKEN. Empty leaves GitLab off."
  type        = string
  default     = ""
}

variable "gitlab_token_expires" {
  description = "Expiry of the GitLab token (YYYY-MM-DD), passed as SHELF_GITLAB_TOKEN_EXPIRES; the System page warns 30 days before. Set with gitlab_token_secret_id."
  type        = string
  default     = ""

  validation {
    condition     = (var.gitlab_token_secret_id == "") == (var.gitlab_token_expires == "")
    error_message = "Set both gitlab_token_secret_id and gitlab_token_expires, or neither."
  }
}

variable "gitlab_host" {
  description = "GitLab base URL, passed as SHELF_GITLAB_HOST. Empty means https://gitlab.com."
  type        = string
  default     = ""
}
