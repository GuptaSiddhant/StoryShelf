terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

variable "name" {
  description = "Name prefix (unique per stack)."
  type        = string
  default     = "storyshelf"
}

variable "region" {
  description = "AWS region."
  type        = string
  default     = "us-east-1"
}

variable "image_version" {
  description = "Published image version, e.g. 0.12.0."
  type        = string
}

provider "aws" {
  region = var.region
}

module "storyshelf" {
  # A real stack pins a release instead:
  #   source = "git::https://github.com/GuptaSiddhant/StoryShelf.git//deploy/terraform/aws?ref=v0.12.0"
  source = "../.."

  name          = var.name
  region        = var.region
  image_version = var.image_version

  # A throwaway stack: delete the database and bucket on destroy.
  deletion_protection = false
}

output "url" {
  description = "Public base URL."
  value       = module.storyshelf.url
}

output "cluster_name" {
  description = "ECS cluster name."
  value       = module.storyshelf.cluster_name
}

output "service_name" {
  description = "ECS service name."
  value       = module.storyshelf.service_name
}
