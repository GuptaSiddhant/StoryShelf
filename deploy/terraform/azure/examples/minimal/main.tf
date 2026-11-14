terraform {
  required_version = ">= 1.9.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

variable "name" {
  description = "Name prefix (unique per stack)."
  type        = string
  default     = "storyshelf"
}

variable "location" {
  description = "Azure region."
  type        = string
  default     = "eastus"
}

variable "image_version" {
  description = "Published image version, e.g. 0.12.0."
  type        = string
}

# The subscription comes from ARM_SUBSCRIPTION_ID (and the credentials from `az login` or ARM_*).
provider "azurerm" {
  features {
    resource_group {
      # A throwaway stack: let destroy remove the group with everything in it.
      prevent_deletion_if_contains_resources = false
    }
    key_vault {
      purge_soft_delete_on_destroy = true
    }
  }
}

module "storyshelf" {
  # A real stack pins a release instead:
  #   source = "git::https://github.com/GuptaSiddhant/StoryShelf.git//deploy/terraform/azure?ref=v0.12.0"
  source = "../.."

  name          = var.name
  location      = var.location
  image_version = var.image_version

  # A throwaway stack that anyone can reach; a real stack lists its office or VPN ranges.
  allowed_cidr_blocks = ["0.0.0.0/0"]

  # A throwaway stack: no delete lock and no Key Vault purge protection.
  deletion_protection = false
}

output "url" {
  description = "Public base URL."
  value       = module.storyshelf.url
}

output "resource_group_name" {
  description = "Resource group."
  value       = module.storyshelf.resource_group_name
}

output "container_app_name" {
  description = "Container App name."
  value       = module.storyshelf.container_app_name
}
