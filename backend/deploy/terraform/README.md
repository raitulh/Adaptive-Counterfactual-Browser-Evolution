# AgentOS infrastructure (Terraform, Google Cloud reference)

This directory is a **Terraform module** that provisions the infrastructure AgentOS needs
on Google Cloud. It is a *reference implementation*: the application is cloud-agnostic and
the same boundaries map onto any provider.

## Boundaries: what the application actually depends on

The domain code has **no cloud SDK dependency and no cloud-specific code path**. Every
process is configured with environment variables only (see `backend/.env.example`):

| Contract | Setting(s) | GCP (this module) | AWS | Azure / self-hosted |
|---|---|---|---|---|
| PostgreSQL 16 with the `vector` extension | `DATABASE_URL` (`postgresql+asyncpg://…`) | Cloud SQL for PostgreSQL 16 (private IP, TLS) | RDS / Aurora PostgreSQL 16 | Azure Database for PostgreSQL Flexible Server (allow-list `vector` in `azure.extensions`); CloudNativePG |
| Redis 7 (transient state only) | `REDIS_URL` | Memorystore for Redis | ElastiCache | Azure Cache for Redis; Redis |
| S3-compatible object storage | `OBJECT_STORAGE_*` | GCS via its S3-compatible XML API + HMAC key | S3 | MinIO / Ceph RGW (Azure Blob has no S3 API: put an S3-compatible layer in front) |
| Secrets delivered as environment variables | `JWT_SECRET`, `TOKEN_ENCRYPTION_KEY`, API keys | Secret Manager → External Secrets Operator | Secrets Manager → ESO | Key Vault → ESO; Vault |
| Key management | `KMS_PROVIDER`, `KMS_KEY_ID` | Cloud KMS (bucket CMEK; token KEK prepared) | KMS | Key Vault keys |
| Container runtime | images from `backend/Dockerfile` | GKE Autopilot | EKS | AKS; any Kubernetes |
| Telemetry | `OTEL_EXPORTER_OTLP_ENDPOINT`, `/metrics` | any OTLP collector / Managed Prometheus | ADOT / AMP | Azure Monitor OTLP; Prometheus |

Only `KMS_PROVIDER=local` (Fernet keys supplied as secrets) is implemented in the current
build; the `token-kek` key created here is the landing zone for a cloud KMS implementation
behind `app.core.crypto.KeyManager` (see `enable_kms_token_encryption`).

## What the module creates

* VPC, a GKE subnet with Pod/Service secondary ranges, **private services access**
  (`private_services_cidr`, default `10.100.0.0/16`) for Cloud SQL and Memorystore, and
  Cloud Router + Cloud NAT for egress from private nodes.
* **Cloud SQL for PostgreSQL 16**: private IP only, `ENCRYPTED_ONLY` connections, regional
  HA, automated backups with point-in-time recovery, Query Insights, slow-query logging.
  pgvector is available as the `vector` extension (no database flag required at the time of
  writing — check the Cloud SQL extension documentation for your version).
* **Memorystore for Redis** (`STANDARD_HA`, AUTH enabled, optional in-transit encryption,
  `volatile-lru` eviction — every key AgentOS writes has a TTL).
* **GCS bucket**: uniform bucket-level access, public access prevention, versioning,
  soft delete, CMEK, lifecycle rules for non-current versions and abandoned multipart
  uploads. There is intentionally **no retention lock** — the right-to-delete workflow must
  be able to remove objects; data retention is enforced by the `maintenance.retention` job.
* **Secret Manager** secrets for every key of the `agentos-secrets` Kubernetes Secret —
  **containers only, no values**.
* **Cloud KMS** key ring with a bucket CMEK key and a token key-encryption key (both
  rotating, `prevent_destroy`).
* **Artifact Registry** Docker repository with immutable tags.
* **GKE Autopilot**, private nodes, release channel, authorized networks for the control
  plane, a minimal node service account.
* **Least-privilege identities** (Workload Identity):
  * `agentos-api`, `agentos-worker` — no project roles (they use private IP + secrets; KMS
    access only when `enable_kms_token_encryption = true`);
  * `agentos-secrets-sync` — `secretAccessor` on the AgentOS secrets only (for ESO);
  * `agentos-storage` — `storage.objectAdmin` on the bucket only (owner of the HMAC key);
  * the browser worker, scheduler and migration Job get **no** Google identity.

Assumes one environment per project (service-account IDs are not environment-suffixed).

## Usage

```hcl
# infra/prod/main.tf (your root module)
terraform {
  backend "gcs" {
    bucket = "your-tf-state-bucket"   # versioned, access-restricted
    prefix = "agentos/prod"
  }
}

provider "google" {
  project = "your-gcp-project"
  region  = "europe-west1"
}

module "agentos" {
  source      = "../../backend/deploy/terraform"
  project_id  = "your-gcp-project"
  region      = "europe-west1"
  environment = "prod"

  gke_master_authorized_networks = [
    { cidr_block = "203.0.113.0/24", display_name = "office-vpn" },
  ]
}

output "agentos" {
  value = module.agentos
}
```

```bash
terraform init
terraform plan -out plan.tfplan
terraform apply plan.tfplan
```

## After `apply`: values Terraform deliberately does not hold

Secrets never pass through Terraform. Add them as Secret Manager versions:

```bash
P=your-gcp-project; I=agentos-prod-pg
# 1. Database user (cloudsqlsuperuser, so the first migration can CREATE EXTENSION vector)
DB_PASS="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
gcloud sql users create agentos --instance "$I" --password "$DB_PASS" --project "$P"
DB_IP="$(terraform output -json agentos | jq -r .database_private_ip)"
printf 'postgresql+asyncpg://agentos:%s@%s:5432/agentos?ssl=require' "$DB_PASS" "$DB_IP" |
  gcloud secrets versions add agentos-database-url --data-file=- --project "$P"

# 2. Redis (AUTH string; with in-transit encryption also store the CA as a K8s secret)
AUTH="$(gcloud redis instances get-auth-string agentos-prod-redis --region europe-west1 --project "$P" --format='value(authString)')"
printf 'rediss://:%s@%s:6378/0?ssl_ca_certs=/etc/agentos/redis-ca/server-ca.pem' "$AUTH" "<redis_host>" |
  gcloud secrets versions add agentos-redis-url --data-file=- --project "$P"

# 3. Object storage HMAC key for the storage service account
gcloud storage hmac create agentos-storage@$P.iam.gserviceaccount.com --project "$P"
#    → store accessId / secret as agentos-object-storage-access-key / -secret-key

# 4. Application secrets
python3 -c 'import secrets; print(secrets.token_urlsafe(64), end="")' |
  gcloud secrets versions add agentos-jwt-secret --data-file=- --project "$P"
python3 -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode(), end="")' |
  gcloud secrets versions add agentos-token-encryption-key --data-file=- --project "$P"
#    + agentos-gemini-api-key, agentos-google-client-secret, and any optional ones you use
```

Then: install External Secrets Operator, apply documents 1–3 of
`deploy/k8s/secret.example.yaml`, push the images to the Artifact Registry output, point a
kustomize overlay of `deploy/k8s` at them (images, ConfigMap hosts/bucket/OAuth client ID,
`private_services_cidr` in the NetworkPolicies, Workload Identity annotations from
`workload_service_accounts`), run the migration Job, then apply. The full sequence is in
`backend/docs/deployment.md`.

## State and safety

* The only secret material in the state is the Memorystore AUTH string that the provider
  reads back. Keep the state in a versioned, access-restricted, encrypted GCS backend.
* `deletion_protection` (default `true`) guards the cluster and the database; the KMS keys
  have `prevent_destroy`, and key rings cannot be deleted in Google Cloud at all.
* Validated with `terraform fmt -check` and `terraform validate` (Terraform 1.16,
  `hashicorp/google` 8.4). It has not been applied from this repository's CI; run `plan`
  in a sandbox project before adopting it.
