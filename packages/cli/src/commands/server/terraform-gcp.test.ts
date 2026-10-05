import { describe, expect, it } from "vitest";
import {
  GCP_TERRAFORM_OUTPUT_KEYS,
  generateGcpApp,
  generateGcpDatabase,
  generateGcpDns,
  generateGcpIdentity,
  generateGcpMain,
  generateGcpOutputs,
  generateGcpQueue,
  generateGcpReadme,
  generateGcpSecrets,
  generateGcpStorage,
  generateGcpTerraformFiles,
  generateGcpTfvarsExample,
  generateGcpVariables,
  generateGcpVersions,
  generateGcpWorker,
  type GcpTerraformOptions,
} from "./terraform-gcp.ts";

const options: GcpTerraformOptions = {
  project: "acme-shelf",
  gcpProjectId: "acme-gcp-project",
  location: "us-central1",
};

/** Frozen output contract parsed by CI — renames break live-cloud.yml. */
const FROZEN_OUTPUT_KEYS = [
  "database_url",
  "gcs_bucket",
  "identity_tenant_id",
  "pubsub_subscription",
  "pubsub_topic",
  "run_url",
];

function outputNames(outputsTf: string): string[] {
  const names: string[] = [];
  for (const match of outputsTf.matchAll(/^output "(?<name>[^"]+)" \{/gmu)) {
    const name = match.groups?.["name"];
    if (name !== undefined) {
      names.push(name);
    }
  }
  return names.toSorted();
}

describe("GCP Terraform modules", () => {
  it("pins terraform and provider versions", () => {
    const versions = generateGcpVersions();
    expect(versions).toContain(">= 1.9");
    expect(versions).toContain("hashicorp/google");
  });

  it("declares only live variables", () => {
    const variables = generateGcpVariables();
    expect(variables).toContain('variable "project"');
    expect(variables).toContain('variable "gcp_project_id"');
    expect(variables).toContain('variable "location"');
    expect(variables).toContain('variable "domain_name"');
    expect(variables).toContain('variable "identity_tenant"');
  });

  it("enables every API the stack touches", () => {
    const main = generateGcpMain();
    expect(main).toContain('resource "google_project_service" "apis"');
    for (const api of ["run", "sqladmin", "pubsub", "storage", "secretmanager", "dns"]) {
      expect(main).toContain(api);
    }
  });

  it("runs compute on Cloud Run, not GCE or Functions", () => {
    const compute = `${generateGcpApp()}${generateGcpWorker()}`;
    expect(compute).toContain('resource "google_cloud_run_v2_service" "app"');
    expect(compute).toContain('resource "google_cloud_run_v2_service" "worker"');
    expect(compute).toContain("INGRESS_TRAFFIC_ALL");
    expect(compute).not.toContain("compute_instance");
    expect(compute).not.toContain("cloudfunctions");
  });

  it("provisions a private GCS bucket with transient expiry", () => {
    const storage = generateGcpStorage();
    expect(storage).toContain('resource "google_storage_bucket" "storybook"');
    expect(storage).toContain("public_access_prevention");
    expect(storage).toContain("force_destroy");
    expect(storage).toContain("builds/");
  });

  it("provisions a Pub/Sub subscription with dead-lettering", () => {
    const queue = generateGcpQueue();
    expect(queue).toContain('resource "google_pubsub_topic" "capture"');
    expect(queue).toContain('resource "google_pubsub_topic" "capture_dlq"');
    expect(queue).toContain('resource "google_pubsub_subscription" "capture"');
    expect(queue).toContain("dead_letter_policy");
    expect(queue).toContain("max_delivery_attempts");
  });

  it("uses shared-core Cloud SQL Postgres", () => {
    const database = generateGcpDatabase();
    expect(database).toContain('resource "google_sql_database_instance" "main"');
    expect(database).toContain("db-f1-micro");
    expect(database).toContain('resource "google_sql_database" "shelf"');
  });

  it("gates Identity Platform on identity_tenant", () => {
    const identity = generateGcpIdentity();
    expect(identity).toContain('resource "google_identity_platform_tenant" "main"');
    expect(identity).toContain('var.identity_tenant == "" ? 0 : 1');
  });

  it("stores secrets in Secret Manager, never in env", () => {
    const secrets = generateGcpSecrets();
    expect(secrets).toContain("google_secret_manager_secret");
    expect(secrets).toContain('"admin_token"');
    expect(secrets).toContain('"db_password"');
    expect(secrets).toContain("change-me");
  });

  it("gates DNS on domain_name with a managed-cert mapping", () => {
    const dns = generateGcpDns();
    expect(dns).toContain('var.domain_name == "" ? 0 : 1');
    expect(dns).toContain("google_dns_managed_zone");
    expect(dns).toContain("google_cloud_run_domain_mapping");
  });

  it("emits a frozen output contract", () => {
    expect(outputNames(generateGcpOutputs())).toEqual(FROZEN_OUTPUT_KEYS);
    expect([...GCP_TERRAFORM_OUTPUT_KEYS].toSorted()).toEqual(FROZEN_OUTPUT_KEYS);
  });

  it("references no non-GCP provider", () => {
    const files = generateGcpTerraformFiles(options);
    const bodies = Object.values(files).join("\n").toLowerCase();
    expect(bodies).not.toContain("aws_");
    expect(bodies).not.toContain("azurerm");
    expect(bodies).not.toContain("azuread");
  });

  it("emits one file per module plus README and tfvars example", () => {
    const files = generateGcpTerraformFiles(options);
    for (const path of [
      "terraform/versions.tf",
      "terraform/variables.tf",
      "terraform/main.tf",
      "terraform/compute.tf",
      "terraform/database.tf",
      "terraform/storage.tf",
      "terraform/queue.tf",
      "terraform/identity.tf",
      "terraform/secrets.tf",
      "terraform/dns.tf",
      "terraform/outputs.tf",
      "terraform/terraform.tfvars.example",
      "terraform/README.md",
    ]) {
      expect(Object.keys(files)).toContain(path);
    }
    expect(files["terraform/README.md"]).toContain("terraform plan");
    expect(files["terraform/README.md"]).toContain("GCS_BUCKET");
    expect(files["terraform/README.md"]).toContain("terraform destroy");
    expect(files["terraform/terraform.tfvars.example"]).toContain("gcp_project_id");
  });
});

describe("GCP Terraform README", () => {
  it("documents plan-before-apply, gcloud auth, and the CI profile", () => {
    const readme = generateGcpReadme("acme-shelf");
    expect(readme).toContain("plan -out=tfplan");
    expect(readme).toContain("gcloud auth login");
    expect(readme).toContain("GOOGLE_CLOUD_PROJECT");
    expect(readme).toContain("CI test profile");
    expect(readme).toContain("shelf-ci-");
  });
});

describe("GCP Terraform tfvars example", () => {
  it("covers every variable with CI-friendly defaults", () => {
    const example = generateGcpTfvarsExample();
    expect(example).toContain("project");
    expect(example).toContain("gcp_project_id");
    expect(example).toContain("location");
    expect(example).toContain("domain_name");
    expect(example).toContain("identity_tenant");
  });
});
