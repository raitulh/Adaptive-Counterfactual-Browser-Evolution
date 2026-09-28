# ----------------------------------------------------------------------------- identity / placement

variable "project_id" {
  description = "Google Cloud project that hosts AgentOS."
  type        = string
}

variable "region" {
  description = "Region for the cluster, database, Redis, KMS and the default bucket location."
  type        = string
  default     = "europe-west1"
}

variable "environment" {
  description = "Environment name used in resource names and labels (e.g. prod, staging)."
  type        = string
  default     = "prod"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,15}$", var.environment))
    error_message = "environment must be 2-16 lowercase letters, digits or dashes, starting with a letter."
  }
}

variable "name" {
  description = "Base name for resources."
  type        = string
  default     = "agentos"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}$", var.name))
    error_message = "name must be 2-21 lowercase letters, digits or dashes, starting with a letter."
  }
}

variable "labels" {
  description = "Extra labels applied to every labelled resource."
  type        = map(string)
  default     = {}
}

variable "deletion_protection" {
  description = "Protect the cluster and the database from `terraform destroy`."
  type        = bool
  default     = true
}

# ----------------------------------------------------------------------------- network

variable "subnet_cidr" {
  description = "Primary range of the GKE subnet (nodes)."
  type        = string
  default     = "10.10.0.0/20"
}

variable "pods_cidr" {
  description = "Secondary range for Pods."
  type        = string
  default     = "10.64.0.0/14"
}

variable "services_cidr" {
  description = "Secondary range for Services."
  type        = string
  default     = "10.68.0.0/20"
}

variable "private_services_cidr" {
  description = "Private services access range (Cloud SQL + Memorystore). Kubernetes NetworkPolicies allow egress to it."
  type        = string
  default     = "10.100.0.0/16"

  validation {
    condition     = can(cidrhost(var.private_services_cidr, 0))
    error_message = "private_services_cidr must be a valid CIDR block."
  }
}

# ----------------------------------------------------------------------------- GKE

variable "gke_release_channel" {
  description = "GKE release channel (RAPID, REGULAR, STABLE)."
  type        = string
  default     = "REGULAR"
}

variable "gke_master_cidr" {
  description = "/28 range for the private control plane."
  type        = string
  default     = "172.16.0.32/28"
}

variable "gke_master_authorized_networks" {
  description = "CIDR blocks allowed to reach the cluster's public control-plane endpoint (e.g. your CI runners, VPN)."
  type = list(object({
    cidr_block   = string
    display_name = string
  }))
  default = []
}

variable "k8s_namespace" {
  description = "Kubernetes namespace of the AgentOS workloads (Workload Identity bindings)."
  type        = string
  default     = "agentos"
}

# ----------------------------------------------------------------------------- Cloud SQL

variable "db_tier" {
  description = "Cloud SQL machine tier."
  type        = string
  default     = "db-custom-2-7680"
}

variable "db_edition" {
  description = "Cloud SQL edition (ENTERPRISE or ENTERPRISE_PLUS; the latter needs a db-perf-optimized tier)."
  type        = string
  default     = "ENTERPRISE"
}

variable "db_high_availability" {
  description = "Regional (HA) instance with automatic failover."
  type        = bool
  default     = true
}

variable "db_disk_size_gb" {
  description = "Initial SSD size; storage auto-grows."
  type        = number
  default     = 50
}

variable "db_max_connections" {
  description = "PostgreSQL max_connections. Budget: replicas x (DATABASE_POOL_SIZE + DATABASE_MAX_OVERFLOW) per process type."
  type        = number
  default     = 400
}

variable "db_backup_retention_count" {
  description = "Number of daily automated backups to keep (point-in-time recovery is always on)."
  type        = number
  default     = 14
}

# ----------------------------------------------------------------------------- Memorystore

variable "redis_tier" {
  description = "Memorystore tier: BASIC or STANDARD_HA."
  type        = string
  default     = "STANDARD_HA"
}

variable "redis_memory_gb" {
  description = "Memorystore capacity in GB (Redis holds only transient state)."
  type        = number
  default     = 2
}

variable "redis_version" {
  description = "Memorystore Redis version."
  type        = string
  default     = "REDIS_7_2"
}

variable "redis_transit_encryption" {
  description = "Enable in-transit encryption (TLS on port 6378; clients need the server CA, see outputs)."
  type        = bool
  default     = true
}

# ----------------------------------------------------------------------------- object storage

variable "bucket_name" {
  description = "Object storage bucket name. Empty = <project_id>-<name>-<environment>-objects."
  type        = string
  default     = ""
}

variable "bucket_location" {
  description = "Bucket location. Empty = the region."
  type        = string
  default     = ""
}

variable "bucket_noncurrent_version_days" {
  description = "Days to keep overwritten/deleted object versions before permanent deletion."
  type        = number
  default     = 30
}

variable "bucket_soft_delete_days" {
  description = "Soft-delete window for deleted objects, in days (0 disables; max 90)."
  type        = number
  default     = 7
}

# ----------------------------------------------------------------------------- secrets / KMS

variable "secret_names" {
  description = "Secret Manager secrets to create (without values), prefixed with `<name>-`. Keys match deploy/k8s/secret.example.yaml."
  type        = list(string)
  default = [
    "database-url",
    "redis-url",
    "jwt-secret",
    "token-encryption-key",
    "token-encryption-previous-keys",
    "gemini-api-key",
    "google-client-secret",
    "object-storage-access-key",
    "object-storage-secret-key",
    "search-api-key",
    "smtp-password",
    "webhook-signing-secret",
    "metrics-bearer-token",
    "sentry-dsn",
  ]
}

variable "kms_rotation_period" {
  description = "Automatic rotation period for the KMS keys."
  type        = string
  default     = "7776000s"
}

variable "enable_kms_token_encryption" {
  description = "Grant the API and worker identities encrypt/decrypt on the token key-encryption key. Enable only with a build that implements KMS_PROVIDER=gcp."
  type        = bool
  default     = false
}
