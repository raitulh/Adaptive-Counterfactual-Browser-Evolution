output "gke_cluster_name" {
  description = "GKE Autopilot cluster name."
  value       = google_container_cluster.autopilot.name
}

output "gke_get_credentials_command" {
  description = "Command that configures kubectl for the cluster."
  value       = "gcloud container clusters get-credentials ${google_container_cluster.autopilot.name} --region ${var.region} --project ${var.project_id}"
}

output "database_instance_connection_name" {
  description = "Cloud SQL connection name (project:region:instance)."
  value       = google_sql_database_instance.postgres.connection_name
}

output "database_private_ip" {
  description = "Private IP for DATABASE_URL (postgresql+asyncpg://<user>:<password>@<ip>:5432/<db>?ssl=require)."
  value       = google_sql_database_instance.postgres.private_ip_address
}

output "database_name" {
  description = "Application database name."
  value       = google_sql_database.agentos.name
}

output "redis_host" {
  description = "Memorystore private IP."
  value       = google_redis_instance.cache.host
}

output "redis_port" {
  description = "Memorystore port (6378 with in-transit encryption, 6379 without)."
  value       = google_redis_instance.cache.port
}

output "redis_server_ca_certificates" {
  description = "PEM CA certificates to trust when in-transit encryption is enabled (public material)."
  value       = [for ca in google_redis_instance.cache.server_ca_certs : ca.cert]
}

output "bucket_name" {
  description = "Object storage bucket (OBJECT_STORAGE_BUCKET)."
  value       = google_storage_bucket.objects.name
}

output "storage_service_account" {
  description = "Service account that owns the HMAC key used as OBJECT_STORAGE_ACCESS_KEY/SECRET_KEY."
  value       = google_service_account.storage.email
}

output "artifact_registry_repository" {
  description = "Docker repository for the agentos-backend and agentos-browser-worker images."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "secret_ids" {
  description = "Secret Manager secret IDs (add versions with `gcloud secrets versions add`)."
  value       = { for key, secret in google_secret_manager_secret.app : key => secret.secret_id }
}

output "kms_key_ids" {
  description = "KMS keys: bucket CMEK and the token key-encryption key."
  value = {
    storage   = google_kms_crypto_key.storage.id
    token_kek = google_kms_crypto_key.token_kek.id
  }
}

output "workload_service_accounts" {
  description = "Google service accounts to put in the iam.gke.io/gcp-service-account annotations."
  value       = { for key, sa in google_service_account.workload : key => sa.email }
}

output "private_services_cidr" {
  description = "Range to allow in the Kubernetes NetworkPolicies for PostgreSQL/Redis egress."
  value       = var.private_services_cidr
}
