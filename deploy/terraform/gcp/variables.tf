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
  description = "Public origin of the app (SHELF_PUBLIC_BASE_URL), e.g. when you map your own domain to the service. Empty means the service's deterministic Cloud Run URL (https://<name>-app-<project number>.<region>.run.app)."
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
  description = "Most database connections each copy opens (SHELF_DATABASE_POOL_MAX). Keep max_instances x this below the database's connection limit."
  type        = number
  default     = 10
}

variable "shutdown_grace_seconds" {
  description = "How long a stopping copy drains running captures before it hands them back to the queue (SHELF_SHUTDOWN_GRACE_SECONDS). Cloud Run sends SIGTERM and stops the container 10 seconds later and that is not configurable, so the grace must stay below it."
  type        = number
  default     = 8

  validation {
    condition     = var.shutdown_grace_seconds >= 1 && var.shutdown_grace_seconds <= 8
    error_message = "shutdown_grace_seconds must be 1-8: Cloud Run stops a container 10 seconds after SIGTERM, and the grace bounds the whole shutdown, leaving a margin."
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

variable "database_init_image" {
  description = "Image of the db-init job that creates the app's database role (it needs psql 15 or later). It receives the admin password, so the default (postgres 16-alpine from Docker Hub) is pinned by digest; pin a mirror by digest too."
  type        = string
  default     = "docker.io/library/postgres@sha256:1d5b02d3a9941fbd52437db4107f8c52d6297dac553ca1e5c299ebb3756b4857"
}

variable "deletion_protection" {
  description = "Protect the created database from deletion; with false the bucket is also emptied on destroy. Turn it off for throwaway stacks."
  type        = bool
  default     = true
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

variable "admin_email" {
  description = "Email of the local admin login created from the generated SHELF_ADMIN_PASSWORD (SHELF_ADMIN_EMAIL)."
  type        = string
  default     = "admin@example.com"
}

# Remote browsers (ADR 0050): the image reads the SHELF_REMOTE_BROWSER_* variables. The endpoint can
# carry a key, so both it and the token are Secret Manager secrets you create outside Terraform:
# their values never enter configuration or state. protocol and reach are declared, never inferred.
variable "remote_browser_endpoint_secret_id" {
  description = "Secret Manager secret id holding the remote browser's endpoint (ws(s)://...), passed as SHELF_REMOTE_BROWSER_ENDPOINT. Empty leaves remote browsers off (capture runs in the container). Set with remote_browser_protocol and remote_browser_reach."
  type        = string
  default     = ""

  validation {
    condition     = var.remote_browser_endpoint_secret_id == "" || (var.remote_browser_protocol != "" && var.remote_browser_reach != "")
    error_message = "Set remote_browser_protocol and remote_browser_reach with remote_browser_endpoint_secret_id."
  }
}

variable "remote_browser_token_secret_id" {
  description = "Secret Manager secret id holding the remote browser's access token, sent as a Bearer header and passed as SHELF_REMOTE_BROWSER_TOKEN. Optional (an endpoint can carry the key); needs the endpoint."
  type        = string
  default     = ""

  validation {
    condition     = var.remote_browser_token_secret_id == "" || var.remote_browser_endpoint_secret_id != ""
    error_message = "Set remote_browser_endpoint_secret_id with remote_browser_token_secret_id."
  }
}

variable "remote_browser_protocol" {
  description = "How the runner talks to the remote browser: playwright or cdp (Chromium only), passed as SHELF_REMOTE_BROWSER_PROTOCOL. Empty with no endpoint."
  type        = string
  default     = ""

  validation {
    condition     = contains(["", "playwright", "cdp"], var.remote_browser_protocol)
    error_message = "remote_browser_protocol must be playwright or cdp."
  }
}

variable "remote_browser_reach" {
  description = "How the remote browser reaches the Storybook: loopback (the service routes back to the host, playwright only) or url (a signed Storybook URL on the public origin), passed as SHELF_REMOTE_BROWSER_REACH. Empty with no endpoint."
  type        = string
  default     = ""

  validation {
    condition     = contains(["", "loopback", "url"], var.remote_browser_reach) && !(var.remote_browser_protocol == "cdp" && var.remote_browser_reach == "loopback")
    error_message = "remote_browser_reach must be loopback or url, and loopback needs the playwright protocol."
  }
}

variable "remote_browser_engines" {
  description = "Comma-separated engines the service offers (chromium, firefox, webkit, chrome), passed as SHELF_REMOTE_BROWSER_ENGINES. Empty means chromium."
  type        = string
  default     = ""
}

variable "remote_browser_sessions" {
  description = "Parallel pages the service's plan allows per copy, passed as SHELF_REMOTE_BROWSER_SESSIONS. 0 means the image's default (1)."
  type        = number
  default     = 0

  validation {
    condition     = var.remote_browser_sessions >= 0 && floor(var.remote_browser_sessions) == var.remote_browser_sessions
    error_message = "remote_browser_sessions must be a whole number of at least 0."
  }
}

variable "remote_browser_max_connections" {
  description = "Most connections each copy holds to the service at once, passed as SHELF_REMOTE_BROWSER_MAX_CONNECTIONS. 0 means no cap."
  type        = number
  default     = 0

  validation {
    condition     = var.remote_browser_max_connections >= 0 && floor(var.remote_browser_max_connections) == var.remote_browser_max_connections
    error_message = "remote_browser_max_connections must be a whole number of at least 0."
  }
}
