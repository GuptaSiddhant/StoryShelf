import { describe, expect, it } from "vitest";
import {
  generateAwsCompute,
  generateAwsDatabase,
  generateAwsDns,
  generateAwsEndpoints,
  generateAwsIdentity,
  generateAwsOutputs,
  generateAwsQueue,
  generateAwsReadme,
  generateAwsSecrets,
  generateAwsSecurity,
  generateAwsStorage,
  generateAwsTerraformFiles,
  generateAwsVariables,
  generateAwsVersions,
  generateAwsVpc,
  TERRAFORM_REQUIRED_VERSION,
  type AwsTerraformOptions,
} from "./terraform-aws.ts";

const options: AwsTerraformOptions = {
  project: "acme-shelf",
  region: "us-east-1",
  dbEngine: "rds",
};

describe("AWS Terraform modules", () => {
  it("pins terraform and provider versions", () => {
    const versions = generateAwsVersions();
    expect(versions).toContain(TERRAFORM_REQUIRED_VERSION);
    expect(versions).toContain("hashicorp/aws");
  });

  it("declares db_engine with an rds/dsql validation", () => {
    const variables = generateAwsVariables();
    expect(variables).toContain('variable "db_engine"');
    expect(variables).toContain('"rds"');
    expect(variables).toContain('"dsql"');
    expect(variables).toContain('variable "vpc_id"');
    expect(variables).toContain('variable "domain_name"');
    expect(variables).toContain('variable "saml_metadata_url"');
  });

  it("provisions a private S3 bucket with transient expiry", () => {
    const storage = generateAwsStorage();
    expect(storage).toContain('resource "aws_s3_bucket" "storybook"');
    expect(storage).toContain("block_public_acls");
    expect(storage).toContain("expire-transient-builds");
  });

  it("provisions an SQS queue with a DLQ redrive", () => {
    const queue = generateAwsQueue();
    expect(queue).toContain('resource "aws_sqs_queue" "capture"');
    expect(queue).toContain('resource "aws_sqs_queue" "capture_dlq"');
    expect(queue).toContain("deadLetterTargetArn");
  });

  it("uses RDS by default and DSQL on request", () => {
    expect(generateAwsDatabase("rds")).toContain('resource "aws_db_instance" "main"');
    expect(generateAwsDatabase("rds")).not.toContain("aws_dsql_cluster");
    expect(generateAwsDatabase("dsql")).toContain('resource "aws_dsql_cluster" "main"');
    expect(generateAwsDatabase("dsql")).not.toContain("aws_db_instance");
  });

  it("keeps data-plane traffic private and compute on Fargate", () => {
    const network = `${generateAwsVpc()}${generateAwsSecurity()}${generateAwsEndpoints()}`;
    expect(network).toContain('resource "aws_vpc_endpoint" "s3"');
    expect(network).toContain('resource "aws_vpc_endpoint" "sqs"');
    const compute = generateAwsCompute();
    expect(compute).toContain('resource "aws_ecs_cluster" "main"');
    expect(compute).toContain('resource "aws_lb" "main"');
    expect(compute).not.toContain("lambda");
  });

  it("provisions Cognito with an admin group and optional SAML", () => {
    const identity = generateAwsIdentity();
    expect(identity).toContain('resource "aws_cognito_user_pool" "main"');
    expect(identity).toContain('"shelf-admins"');
    expect(identity).toContain("var.saml_metadata_url");
  });

  it("stores secrets in Secrets Manager, never in env", () => {
    const secrets = generateAwsSecrets();
    expect(secrets).toContain("aws_secretsmanager_secret");
    expect(secrets).toContain("ADMIN_TOKEN");
  });

  it("gates DNS on domain_name", () => {
    const dns = generateAwsDns();
    expect(dns).toContain('var.domain_name == "" ? 0 : 1');
    expect(dns).toContain("aws_acm_certificate");
    expect(dns).toContain("aws_route53_record");
  });

  it("outputs every env var the server needs", () => {
    const outputs = generateAwsOutputs();
    for (const name of [
      "alb_dns_name",
      "s3_bucket",
      "queue_url",
      "user_pool_id",
      "app_client_id",
    ]) {
      expect(outputs).toContain(`output "${name}"`);
    }
  });

  it("references no non-AWS provider", () => {
    const files = generateAwsTerraformFiles(options);
    const bodies = Object.values(files).join("\n").toLowerCase();
    expect(bodies).not.toContain("google");
    expect(bodies).not.toContain("azurerm");
    expect(bodies).not.toContain("cloudflare");
  });

  it("emits one file per module plus database and README", () => {
    const files = generateAwsTerraformFiles(options);
    for (const path of [
      "terraform/versions.tf",
      "terraform/variables.tf",
      "terraform/network.tf",
      "terraform/storage.tf",
      "terraform/queue.tf",
      "terraform/identity.tf",
      "terraform/compute.tf",
      "terraform/secrets.tf",
      "terraform/dns.tf",
      "terraform/outputs.tf",
      "terraform/database.tf",
      "terraform/README.md",
    ]) {
      expect(Object.keys(files)).toContain(path);
    }
    expect(files["terraform/README.md"]).toContain("terraform plan");
    expect(files["terraform/README.md"]).toContain("S3_BUCKET");
  });
});

describe("AWS Terraform README", () => {
  it("documents plan-before-apply and IAM credentials", () => {
    const readme = generateAwsReadme("acme-shelf");
    expect(readme).toContain("plan -out=tfplan");
    expect(readme).toContain("IAM");
  });
});
