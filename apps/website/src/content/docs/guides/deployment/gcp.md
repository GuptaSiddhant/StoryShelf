---
title: GCP deployment
description: Deploy StoryShelf on Google Cloud with Cloud Run, GCS, Cloud SQL, and Identity Platform.
---

For Google Cloud enterprise deployments, `storyshelf server init` offers a `gcp` deploy target that pins the full reference stack — one Cloud Run service (it serves the UI and runs the captures from the database queue, with CPU always allocated), GCS bucket, Cloud SQL Postgres (`db-f1-micro` shared-core default), Secret Manager, Identity Platform tenant, and optional Cloud DNS with automatic managed TLS via the domain mapping — and writes it as Terraform under `terraform/`.

## Scaffold

```bash
storyshelf server init
# ? Deploy target? Google Cloud (Cloud Run + GCS + Postgres + Identity Platform)
# ? GCP project ID? my-gcp-project
# ? GCP region? us-central1
# ? Public domain for the app? (empty skips DNS)
# ? Identity Platform tenant display name? (empty skips it)
```

## Apply

```bash
cd my-server
gcloud auth login
gcloud config set project my-gcp-project
terraform -chdir=terraform init
terraform -chdir=terraform plan -out=tfplan   # review before applying
terraform -chdir=terraform apply tfplan       # or: npm run infra:apply
```

## Wiring outputs

Wire the outputs into env (`terraform output -json` / `npm run infra:outputs`): `GCS_BUCKET` + `GOOGLE_CLOUD_PROJECT`, `DATABASE_URL` (`?sslmode=require`), `OIDC_*`, `SECRET`. Output keys (`run_url`, `gcs_bucket`, `database_url`, `identity_tenant_id`) are a stable contract parsed by CI — always present. Grant the runtime service account the Cloud SQL Client and Secret Manager accessor roles post-apply — Terraform creates the resources, IAM bindings stay with your org policy.

See the generated `terraform/README.md` for the CI test profile (unique project prefix per run, documented destroy).

Pair with [@storyshelf/storage-gcs](/packages/storage-gcs/) and [@storyshelf/db-postgres](/packages/db-postgres/). The database is also the capture queue, so there is no topic, subscription or worker service to provision.

## Related

- [Deployment overview](/guides/deployment/) — Docker Compose, subdomains, auth, other clouds
