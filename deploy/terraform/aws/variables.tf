variable "name" {
  description = "Name prefix for every resource (lowercase letters, digits and hyphens)."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,19}$", var.name))
    error_message = "name must be 2-20 characters: lowercase letters, digits and hyphens, starting with a letter."
  }
}

variable "region" {
  description = "AWS region of every resource. It must match the provider's region."
  type        = string
  default     = "us-east-1"
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
  description = "Registry path of the published image. Override it to pull from a mirror (for example a private ECR pull-through cache)."
  type        = string
  default     = "ghcr.io/guptasiddhant/storyshelf"
}

variable "vpc_id" {
  description = "Existing VPC id. Empty creates a new VPC. An existing VPC needs subnets tagged Tier=public (2+, different zones) and Tier=private (2+, different zones)."
  type        = string
  default     = ""
}

variable "domain_name" {
  description = "Public domain for the load balancer (Route 53 zone + ACM certificate). Empty leaves the load balancer HTTP-only."
  type        = string
  default     = ""
}

variable "allowed_cidr_blocks" {
  description = "IPv4 CIDR blocks allowed to reach the load balancer. Required, with no default, so exposure is always a decision: use your office or VPN ranges, or [\"0.0.0.0/0\"] to publish the app."
  type        = list(string)

  validation {
    condition     = length(var.allowed_cidr_blocks) > 0 && alltrue([for cidr in var.allowed_cidr_blocks : can(cidrhost(cidr, 0))])
    error_message = "allowed_cidr_blocks must list at least one valid IPv4 CIDR block."
  }
}

variable "allow_http" {
  description = "Serve plain HTTP when domain_name is empty. Off by default: without a domain the load balancer has no certificate, and passwords and session cookies would cross the network unencrypted. Turn it on only for a throwaway stack."
  type        = bool
  default     = false
}

variable "saml_metadata_url" {
  description = "SAML metadata URL for Cognito federation (Entra, Okta). Empty skips federation. Used only with enable_cognito."
  type        = string
  default     = ""
}

variable "task_cpu" {
  description = "Fargate task CPU units. Capture renders in the container, so keep at least 2048."
  type        = number
  default     = 2048
}

variable "task_memory" {
  description = "Fargate task memory in MiB."
  type        = number
  default     = 4096
}

variable "min_instances" {
  description = "Fewest identical app copies. Every copy serves the app and consumes the database queue (ADR 0006)."
  type        = number
  default     = 1

  validation {
    condition     = var.min_instances >= 1
    error_message = "min_instances must be at least 1."
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
  description = "How long a stopping copy drains running captures before it hands them back to the queue (SHELF_SHUTDOWN_GRACE_SECONDS). The ECS stop timeout and the load balancer deregistration delay are set from it."
  type        = number
  default     = 30

  validation {
    condition     = var.shutdown_grace_seconds >= 5 && var.shutdown_grace_seconds <= 110
    error_message = "shutdown_grace_seconds must be 5-110 (Fargate allows a stop timeout of at most 120 seconds)."
  }
}

variable "existing_database_url_secret_arn" {
  description = "Secrets Manager ARN of a secret holding a postgres:// URL. When set, the module creates no database and passes the URL as DATABASE_URL; the network path to it is yours."
  type        = string
  default     = ""
}

variable "database_instance_class" {
  description = "RDS instance class, used only when the module creates the database."
  type        = string
  default     = "db.t4g.micro"
}

variable "database_allocated_storage" {
  description = "RDS storage in GiB, used only when the module creates the database."
  type        = number
  default     = 20
}

variable "deletion_protection" {
  description = "Protect the created database from deletion and keep a final snapshot; with false the bucket is also emptied on destroy. Turn it off for throwaway stacks."
  type        = bool
  default     = true
}

variable "database_backup_retention_days" {
  description = "Days RDS keeps automated backups (point-in-time recovery). The database holds baselines and reviews, so 0 (off) is refused."
  type        = number
  default     = 7

  validation {
    condition     = var.database_backup_retention_days >= 1 && var.database_backup_retention_days <= 35
    error_message = "database_backup_retention_days must be 1-35."
  }
}

variable "database_init_image" {
  description = "Image of the db-init container that creates the app's database user before the app starts (it needs psql). It receives the RDS master credentials, so the default is pinned by digest; pin a mirror by digest too."
  type        = string
  default     = "public.ecr.aws/docker/library/postgres:16-alpine@sha256:1d5b02d3a9941fbd52437db4107f8c52d6297dac553ca1e5c299ebb3756b4857"
}

variable "enable_cognito" {
  description = "Create the Cognito user pool, client and SHELF_OIDC_CLIENT_SECRET. Off by default: the image does not read OIDC yet, so they would be unused."
  type        = bool
  default     = false
}

variable "admin_email" {
  description = "Email of the local admin login created from SHELF_ADMIN_PASSWORD (SHELF_ADMIN_EMAIL)."
  type        = string
  default     = "admin@example.com"
}

variable "log_retention_days" {
  description = "CloudWatch log retention."
  type        = number
  default     = 30
}

variable "tags" {
  description = "Tags added to every resource that supports them."
  type        = map(string)
  default     = {}
}

# Git connections (ADR 0054, decision 9). The App ID is plain configuration; the private key and the
# GitLab token are Secrets Manager secrets you create outside Terraform, so their values never enter
# configuration or state. Empty keeps a connection off.
variable "github_app_id" {
  description = "GitHub App ID of the server's git connection, passed as SHELF_GITHUB_APP_ID. Empty leaves it off."
  type        = string
  default     = ""
}

variable "github_app_private_key_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the GitHub App private key (PEM), passed as SHELF_GITHUB_APP_PRIVATE_KEY. Set with github_app_id."
  type        = string
  default     = ""

  validation {
    condition     = (var.github_app_id == "") == (var.github_app_private_key_secret_arn == "")
    error_message = "Set both github_app_id and github_app_private_key_secret_arn, or neither."
  }
}

variable "github_api_url" {
  description = "GitHub Enterprise Server API base (https://ghe.example.com/api/v3), passed as SHELF_GITHUB_API_URL. Empty means github.com."
  type        = string
  default     = ""
}

variable "gitlab_token_secret_arn" {
  description = "ARN of the Secrets Manager secret holding a GitLab group or project access token (api scope), passed as SHELF_GITLAB_TOKEN. Empty leaves GitLab off."
  type        = string
  default     = ""
}

variable "gitlab_token_expires" {
  description = "Expiry of the GitLab token (YYYY-MM-DD), passed as SHELF_GITLAB_TOKEN_EXPIRES; the System page warns 30 days before. Set with gitlab_token_secret_arn."
  type        = string
  default     = ""

  validation {
    condition     = (var.gitlab_token_secret_arn == "") == (var.gitlab_token_expires == "")
    error_message = "Set both gitlab_token_secret_arn and gitlab_token_expires, or neither."
  }
}

variable "gitlab_host" {
  description = "GitLab base URL, passed as SHELF_GITLAB_HOST. Empty means https://gitlab.com."
  type        = string
  default     = ""
}

# Remote browsers (ADR 0050): the image reads the SHELF_REMOTE_BROWSER_* variables. The endpoint can
# carry a key, so both it and the token are Secrets Manager secrets you create outside Terraform:
# their values never enter configuration or state. protocol and reach are declared, never inferred.
variable "remote_browser_endpoint_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the remote browser's endpoint (ws(s)://...), passed as SHELF_REMOTE_BROWSER_ENDPOINT. Empty leaves remote browsers off (capture runs in the container). Set with remote_browser_protocol and remote_browser_reach."
  type        = string
  default     = ""

  validation {
    condition     = var.remote_browser_endpoint_secret_arn == "" || (var.remote_browser_protocol != "" && var.remote_browser_reach != "")
    error_message = "Set remote_browser_protocol and remote_browser_reach with remote_browser_endpoint_secret_arn."
  }
}

variable "remote_browser_token_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the remote browser's access token, sent as a Bearer header and passed as SHELF_REMOTE_BROWSER_TOKEN. Optional (an endpoint can carry the key); needs the endpoint."
  type        = string
  default     = ""

  validation {
    condition     = var.remote_browser_token_secret_arn == "" || var.remote_browser_endpoint_secret_arn != ""
    error_message = "Set remote_browser_endpoint_secret_arn with remote_browser_token_secret_arn."
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
