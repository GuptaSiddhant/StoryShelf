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
  description = "SAML metadata URL for Cognito federation (Entra, Okta). Empty skips federation."
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
  description = "Most database connections each copy opens (DATABASE_POOL_MAX). Keep max_instances x this below the database's connection limit."
  type        = number
  default     = 10
}

variable "shutdown_grace_seconds" {
  description = "How long a stopping copy drains running captures before it hands them back to the queue (SHUTDOWN_GRACE_SECONDS). The ECS stop timeout and the load balancer deregistration delay are set from it."
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

variable "remote_browser_endpoint_secret_arn" {
  description = "Optional Secrets Manager ARN of a remote-browser endpoint, passed as REMOTE_BROWSER_ENDPOINT. Capture runs in the container when unset. The module builds no browser service."
  type        = string
  default     = ""
}

variable "remote_browser_token_secret_arn" {
  description = "Optional Secrets Manager ARN of the remote-browser access token, passed as REMOTE_BROWSER_TOKEN."
  type        = string
  default     = ""
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
