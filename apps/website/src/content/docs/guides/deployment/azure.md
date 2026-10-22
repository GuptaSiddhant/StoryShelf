---
title: Azure deployment
description: Deploy StoryShelf on Azure with Container Apps, Blob Storage, Postgres, and Entra ID.
---

For Azure enterprise deployments, `storyshelf server init` offers an `azure` deploy target that pins the full reference stack — one Container Apps app (it serves the UI and runs the captures from the database queue, so it keeps a replica running), Blob storage, Postgres Flexible Server (B1ms burstable default), Key Vault, Microsoft Entra app registration, and an optional DNS zone — and writes it as Terraform under `terraform/`.

## Scaffold

```bash
storyshelf server init
# ? Deploy target? Azure (Container Apps + Blob + Postgres + Entra)
# ? Azure region? eastus
# ? Public domain for the app? (empty skips DNS)
# ? Entra tenant ID for the app registration? (empty skips it)
```

## Apply

```bash
cd my-server
az login
terraform -chdir=terraform init
terraform -chdir=terraform plan -out=tfplan   # review before applying
terraform -chdir=terraform apply tfplan       # or: npm run infra:apply
```

## Wiring outputs

Wire the outputs into env (`terraform output -json` / `npm run infra:outputs`): `AZURE_STORAGE_CONNECTION`, `DATABASE_URL`, `OIDC_CLIENT_ID` / `OIDC_ISSUER` (`https://login.microsoftonline.com/{tenant}/v2.0`), `SECRET`. Output keys (`app_fqdn`, `storage_connection_string`, `database_url`, `entra_application_id`, `entra_tenant_id`) are a stable contract parsed by CI — always present, `""` when an optional resource is not provisioned.

Authenticate with `az login` (or a service principal / managed identity) — never check connection strings into env files. Hostname binding + managed TLS is a post-apply step once the scaffolded DNS records resolve (see the generated `terraform/README.md`, including the CI test profile with unique project prefix per run and documented destroy).

Pair with [@storyshelf/storage-azure](/packages/storage-azure/) and [@storyshelf/db-postgres](/packages/db-postgres/). The database is also the capture queue, so there is no queue namespace or worker app to provision.

## Related

- [Deployment overview](/guides/deployment/) — Docker Compose, subdomains, auth, other clouds
