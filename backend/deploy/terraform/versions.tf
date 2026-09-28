# Reference infrastructure module for AgentOS on Google Cloud.
# This is a MODULE (no provider block): configure the `google` provider in the root module
# that calls it (see README.md).

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 8.0, < 9.0"
    }
  }
}
