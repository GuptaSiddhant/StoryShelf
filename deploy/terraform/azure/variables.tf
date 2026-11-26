variable "name" {
  description = "Name prefix for every resource (lowercase letters, digits and hyphens)."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,19}$", var.name))
    error_message = "name must be 2-20 characters: lowercase letters, digits and hyphens, starting with a letter."
  }
}

variable "location" {
  description = "Azure region of every resource."
  type        = string
  default     = "eastus"
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
  description = "Registry path of the published image. Override it to pull from a mirror (for example a private ACR)."
  type        = string
  default     = "ghcr.io/guptasiddhant/storyshelf"
}

variable "allowed_cidr_blocks" {
  description = "IPv4 CIDR blocks allowed to reach the app. Required, with no default, so exposure is always a decision: use your office or VPN ranges, or [\"0.0.0.0/0\"] to publish the app."
  type        = list(string)

  validation {
    condition     = length(var.allowed_cidr_blocks) > 0 && alltrue([for cidr in var.allowed_cidr_blocks : can(cidrhost(cidr, 0))])
    error_message = "allowed_cidr_blocks must list at least one valid IPv4 CIDR block."
  }
}

variable "cpu" {
  description = "vCPU of each copy. Capture renders in the container, so keep at least 2."
  type        = number
  default     = 2
}

variable "memory" {
  description = "Memory of each copy, e.g. \"4Gi\". It must be twice the vCPU on the Consumption profile."
  type        = string
  default     = "4Gi"
}

variable "min_instances" {
  description = "Fewest identical app copies. At least 1: with zero copies Container Apps stops the capture and notify consumers until a request arrives. Every copy serves the app and consumes the database queue (ADR 0006)."
  type        = number
  default     = 1

  validation {
    condition     = var.min_instances >= 1
    error_message = "min_instances must be at least 1."
  }
}

variable "max_instances" {
  description = "Most identical app copies. Equal to min_instances disables scaling out."
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
  description = "How long a stopping copy drains running captures before it hands them back to the queue (SHELF_SHUTDOWN_GRACE_SECONDS). The container's termination grace is this plus 10 seconds."
  type        = number
  default     = 30

  validation {
    condition     = var.shutdown_grace_seconds >= 5 && var.shutdown_grace_seconds <= 110
    error_message = "shutdown_grace_seconds must be 5-110."
  }
}

variable "existing_database_url_secret_id" {
  description = "Versionless Key Vault secret id of a secret holding a postgres:// URL. When set, the module creates no database and passes the URL as DATABASE_URL. The identity needs Key Vault Secrets User on that vault, and the network path to the database is yours."
  type        = string
  default     = ""
}

variable "database_sku_name" {
  description = "Flexible Server SKU, used only when the module creates the database."
  type        = string
  default     = "B_Standard_B1ms"
}

variable "database_storage_mb" {
  description = "Flexible Server storage in MB, used only when the module creates the database."
  type        = number
  default     = 32768
}

variable "database_init_image" {
  description = "Image of the db-init init container that creates the app's database role (it needs psql 16 or later, for sslrootcert=system). It receives the administrator's password, so the default (postgres 16-alpine from the ECR Public mirror of Docker Hub) is pinned by digest; pin a mirror by digest too."
  type        = string
  default     = "public.ecr.aws/docker/library/postgres@sha256:1d5b02d3a9941fbd52437db4107f8c52d6297dac553ca1e5c299ebb3756b4857"
}

variable "deletion_protection" {
  description = "Put a CanNotDelete lock on the created database and turn on purge protection for the Key Vault. Turn it off (and apply) before destroying a throwaway stack."
  type        = bool
  default     = true
}

variable "playwright_workspace_endpoint_secret_id" {
  description = "Optional versionless Key Vault secret id holding the browser endpoint of an existing Azure Playwright Workspace (wss://...), passed as PLAYWRIGHT_SERVICE_URL. With the token it adds the experimental chromium@azure target (the azurePlaywright preset); capture runs in the container when unset. The module creates no workspace and builds no browser service."
  type        = string
  default     = ""
}

variable "playwright_workspace_token_secret_id" {
  description = "Optional versionless Key Vault secret id holding the workspace access token, passed as PLAYWRIGHT_SERVICE_ACCESS_TOKEN. Set both or neither."
  type        = string
  default     = ""

  validation {
    condition     = (var.playwright_workspace_endpoint_secret_id == "") == (var.playwright_workspace_token_secret_id == "")
    error_message = "Set both playwright_workspace_endpoint_secret_id and playwright_workspace_token_secret_id, or neither."
  }
}

variable "log_retention_days" {
  description = "Log Analytics retention."
  type        = number
  default     = 30
}

variable "tags" {
  description = "Tags added to every resource that supports them."
  type        = map(string)
  default     = {}
}

# Git connections (ADR 0054, decision 9). The App ID is plain configuration; the private key and the
# GitLab token are Key Vault secrets you create outside Terraform (az keyvault secret set), so their
# values never enter configuration or state. The app's identity reads only this stack's vault, so put
# them there or grant the identity Key Vault Secrets User on yours. Empty keeps a connection off.
variable "github_app_id" {
  description = "GitHub App ID of the server's git connection, passed as SHELF_GITHUB_APP_ID. Empty leaves it off."
  type        = string
  default     = ""
}

variable "github_app_private_key_secret_id" {
  description = "Versionless Key Vault secret id holding the GitHub App private key (PEM), passed as SHELF_GITHUB_APP_PRIVATE_KEY. Set with github_app_id."
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
  description = "Versionless Key Vault secret id holding a GitLab group or project access token (api scope), passed as SHELF_GITLAB_TOKEN. Empty leaves GitLab off."
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
