# AgentOS reference infrastructure on Google Cloud.
#
# Provisions: VPC + private services access + Cloud NAT, Cloud SQL for PostgreSQL 16,
# Memorystore for Redis, a GCS bucket (uniform access, versioning, lifecycle, CMEK),
# Secret Manager secrets (containers only — no values), a KMS key ring, an Artifact
# Registry repository, a private GKE Autopilot cluster and least-privilege service
# accounts with Workload Identity bindings.
#
# The application itself has no cloud SDK dependency: it needs a PostgreSQL URL, a Redis
# URL, an S3-compatible bucket and (optionally) an OTLP endpoint. Everything here can be
# replaced by the equivalent service of another provider (see README.md).
#
# No secret value is written by this module. The only secret material that reaches the
# Terraform state is the Memorystore AUTH string the provider reads back; keep state in an
# access-restricted, encrypted backend.

locals {
  prefix        = "${var.name}-${var.environment}"
  workload_pool = "${var.project_id}.svc.id.goog"
  bucket_name   = var.bucket_name != "" ? var.bucket_name : "${var.project_id}-${var.name}-${var.environment}-objects"

  labels = merge({
    app         = var.name
    environment = var.environment
    managed-by  = "terraform"
  }, var.labels)

  required_services = [
    "artifactregistry.googleapis.com",
    "cloudkms.googleapis.com",
    "compute.googleapis.com",
    "container.googleapis.com",
    "iam.googleapis.com",
    "redis.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "sqladmin.googleapis.com",
    "storage.googleapis.com",
  ]

  # Minimal roles for GKE node service accounts.
  gke_node_roles = [
    "roles/artifactregistry.reader",
    "roles/autoscaling.metricsWriter",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/monitoring.viewer",
    "roles/stackdriver.resourceMetadata.writer",
  ]

  # Kubernetes service accounts (namespace/name) mapped to Google service accounts.
  workload_identities = {
    api          = "agentos-api"
    worker       = "agentos-worker"
    secrets_sync = "agentos-secrets-sync"
  }
}

# ============================================================================ APIs

resource "google_project_service" "required" {
  for_each = toset(local.required_services)

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# ============================================================================ network

resource "google_compute_network" "vpc" {
  project                 = var.project_id
  name                    = "${local.prefix}-vpc"
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"

  depends_on = [google_project_service.required]
}

resource "google_compute_subnetwork" "gke" {
  project                  = var.project_id
  name                     = "${local.prefix}-gke"
  region                   = var.region
  network                  = google_compute_network.vpc.id
  ip_cidr_range            = var.subnet_cidr
  private_ip_google_access = true

  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = var.pods_cidr
  }

  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = var.services_cidr
  }

  log_config {
    aggregation_interval = "INTERVAL_5_MIN"
    flow_sampling        = 0.5
    metadata             = "INCLUDE_ALL_METADATA"
  }
}

# Private services access: Cloud SQL and Memorystore get private IPs from this range.
resource "google_compute_global_address" "private_services" {
  project       = var.project_id
  name          = "${local.prefix}-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  address       = split("/", var.private_services_cidr)[0]
  prefix_length = tonumber(split("/", var.private_services_cidr)[1])
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
}

# Egress for private nodes (model/Google APIs over Private Google Access; the public web
# for web fetch, search and MCP through NAT).
resource "google_compute_router" "nat" {
  project = var.project_id
  name    = "${local.prefix}-router"
  region  = var.region
  network = google_compute_network.vpc.id
}

resource "google_compute_router_nat" "nat" {
  project                            = var.project_id
  name                               = "${local.prefix}-nat"
  router                             = google_compute_router.nat.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}

# ============================================================================ Cloud SQL (PostgreSQL 16)
# pgvector ships with Cloud SQL for PostgreSQL as the `vector` extension; no database flag
# is needed at the time of writing. The first migration runs CREATE EXTENSION vector, so
# the migration user needs the cloudsqlsuperuser role (the default for users created with
# gcloud/console). The application user and its password are created outside Terraform
# (README.md) so the password never enters the state.

resource "google_sql_database_instance" "postgres" {
  project             = var.project_id
  name                = "${local.prefix}-pg"
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = var.deletion_protection

  settings {
    tier              = var.db_tier
    edition           = var.db_edition
    availability_type = var.db_high_availability ? "REGIONAL" : "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = var.db_disk_size_gb
    disk_autoresize   = true
    user_labels       = local.labels

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.vpc.id
      ssl_mode        = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "02:00"
      transaction_log_retention_days = 7

      backup_retention_settings {
        retained_backups = var.db_backup_retention_count
        retention_unit   = "COUNT"
      }
    }

    maintenance_window {
      day          = 7
      hour         = 3
      update_track = "stable"
    }

    insights_config {
      query_insights_enabled  = true
      query_string_length     = 1024
      record_application_tags = true
      record_client_address   = false
    }

    database_flags {
      name  = "max_connections"
      value = tostring(var.db_max_connections)
    }

    database_flags {
      name  = "log_min_duration_statement"
      value = "1000"
    }

    database_flags {
      name  = "log_lock_waits"
      value = "on"
    }

    database_flags {
      name  = "log_temp_files"
      value = "0"
    }
  }

  depends_on = [google_service_networking_connection.private_services]
}

resource "google_sql_database" "agentos" {
  project  = var.project_id
  name     = var.name
  instance = google_sql_database_instance.postgres.name
}

# ============================================================================ Memorystore (Redis)
# Transient state only (rate limits, locks, OAuth state, SSE wake-ups): losing it is safe.

resource "google_redis_instance" "cache" {
  project                 = var.project_id
  name                    = "${local.prefix}-redis"
  region                  = var.region
  tier                    = var.redis_tier
  memory_size_gb          = var.redis_memory_gb
  redis_version           = var.redis_version
  authorized_network      = google_compute_network.vpc.id
  connect_mode            = "PRIVATE_SERVICE_ACCESS"
  reserved_ip_range       = google_compute_global_address.private_services.name
  auth_enabled            = true
  transit_encryption_mode = var.redis_transit_encryption ? "SERVER_AUTHENTICATION" : "DISABLED"
  labels                  = local.labels

  redis_configs = {
    "maxmemory-policy" = "volatile-lru"
  }

  maintenance_policy {
    weekly_maintenance_window {
      day = "SUNDAY"

      start_time {
        hours   = 3
        minutes = 0
      }
    }
  }

  depends_on = [google_service_networking_connection.private_services]
}

# ============================================================================ KMS

resource "google_kms_key_ring" "agentos" {
  project  = var.project_id
  name     = local.prefix
  location = var.region

  depends_on = [google_project_service.required]
}

# Customer-managed key for the object-storage bucket.
resource "google_kms_crypto_key" "storage" {
  name            = "storage-cmek"
  key_ring        = google_kms_key_ring.agentos.id
  purpose         = "ENCRYPT_DECRYPT"
  rotation_period = var.kms_rotation_period
  labels          = local.labels

  lifecycle {
    prevent_destroy = true
  }
}

# Key-encryption key for envelope encryption of stored provider credentials. The current
# build encrypts with Fernet keys from Secret Manager (KMS_PROVIDER=local); this key is the
# landing zone for a KMS_PROVIDER=gcp implementation behind app.core.crypto.KeyManager.
resource "google_kms_crypto_key" "token_kek" {
  name            = "token-kek"
  key_ring        = google_kms_key_ring.agentos.id
  purpose         = "ENCRYPT_DECRYPT"
  rotation_period = var.kms_rotation_period
  labels          = local.labels

  lifecycle {
    prevent_destroy = true
  }
}

data "google_storage_project_service_account" "gcs" {
  project = var.project_id
}

resource "google_kms_crypto_key_iam_member" "gcs_cmek" {
  crypto_key_id = google_kms_crypto_key.storage.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${data.google_storage_project_service_account.gcs.email_address}"
}

resource "google_kms_crypto_key_iam_member" "token_kek" {
  for_each = var.enable_kms_token_encryption ? toset(["api", "worker"]) : toset([])

  crypto_key_id = google_kms_crypto_key.token_kek.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.workload[each.value].email}"
}

# ============================================================================ object storage (GCS)
# Uniform bucket-level access, public access prevention, versioning and CMEK. Deliberately
# NO bucket retention *lock*: account deletion (right to delete) must be able to remove
# objects. Retention of application data is enforced by the maintenance.retention job;
# the lifecycle rules below only bound the recovery copies kept by versioning.

resource "google_storage_bucket" "objects" {
  project                     = var.project_id
  name                        = local.bucket_name
  location                    = var.bucket_location != "" ? upper(var.bucket_location) : upper(var.region)
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels

  versioning {
    enabled = true
  }

  soft_delete_policy {
    retention_duration_seconds = var.bucket_soft_delete_days * 86400
  }

  encryption {
    default_kms_key_name = google_kms_crypto_key.storage.id
  }

  lifecycle_rule {
    condition {
      days_since_noncurrent_time = var.bucket_noncurrent_version_days
      with_state                 = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

  lifecycle_rule {
    condition {
      age = 1
    }
    action {
      type = "AbortIncompleteMultipartUpload"
    }
  }

  depends_on = [google_kms_crypto_key_iam_member.gcs_cmek]
}

# The application talks to GCS through its S3-compatible XML API with an HMAC key owned by
# this service account (create the key out of band — README.md — so it never enters state).
resource "google_service_account" "storage" {
  project      = var.project_id
  account_id   = "${var.name}-storage"
  display_name = "AgentOS object storage (HMAC key owner)"
}

resource "google_storage_bucket_iam_member" "storage_object_admin" {
  bucket = google_storage_bucket.objects.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.storage.email}"
}

# ============================================================================ Secret Manager (no values)

resource "google_secret_manager_secret" "app" {
  for_each = toset(var.secret_names)

  project   = var.project_id
  secret_id = "${var.name}-${each.value}"
  labels    = local.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

# External Secrets Operator reads the secrets through this identity only.
resource "google_secret_manager_secret_iam_member" "sync_accessor" {
  for_each = google_secret_manager_secret.app

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.workload["secrets_sync"].email}"
}

# ============================================================================ Artifact Registry

resource "google_artifact_registry_repository" "images" {
  project       = var.project_id
  location      = var.region
  repository_id = var.name
  format        = "DOCKER"
  description   = "AgentOS container images"
  labels        = local.labels

  docker_config {
    immutable_tags = true
  }

  depends_on = [google_project_service.required]
}

# ============================================================================ service accounts

resource "google_service_account" "gke_nodes" {
  project      = var.project_id
  account_id   = "${var.name}-gke-nodes"
  display_name = "AgentOS GKE nodes (minimal)"
}

resource "google_project_iam_member" "gke_nodes" {
  for_each = toset(local.gke_node_roles)

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.gke_nodes.email}"
}

# Workload identities. The API and worker hold no project-level roles: they reach Cloud SQL
# and Memorystore over private IP with credentials from Secret Manager, and GCS with an HMAC
# key. The browser worker, scheduler and migration Job get no Google identity at all.
resource "google_service_account" "workload" {
  for_each = local.workload_identities

  project      = var.project_id
  account_id   = each.value
  display_name = "AgentOS ${each.key} (Kubernetes ${var.k8s_namespace}/${each.value})"
}

resource "google_service_account_iam_member" "workload_identity" {
  for_each = local.workload_identities

  service_account_id = google_service_account.workload[each.key].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${local.workload_pool}[${var.k8s_namespace}/${each.value}]"

  # The workload identity pool exists once the first cluster in the project is created.
  depends_on = [google_container_cluster.autopilot]
}

# ============================================================================ GKE Autopilot

resource "google_container_cluster" "autopilot" {
  project             = var.project_id
  name                = local.prefix
  location            = var.region
  enable_autopilot    = true
  network             = google_compute_network.vpc.id
  subnetwork          = google_compute_subnetwork.gke.id
  deletion_protection = var.deletion_protection
  resource_labels     = local.labels

  release_channel {
    channel = var.gke_release_channel
  }

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }

  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = var.gke_master_cidr
  }

  master_authorized_networks_config {
    dynamic "cidr_blocks" {
      for_each = var.gke_master_authorized_networks
      content {
        cidr_block   = cidr_blocks.value.cidr_block
        display_name = cidr_blocks.value.display_name
      }
    }
  }

  cluster_autoscaling {
    auto_provisioning_defaults {
      service_account = google_service_account.gke_nodes.email
      oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]
    }
  }

  depends_on = [
    google_project_service.required,
    google_project_iam_member.gke_nodes,
  ]
}
