/**
 * Test doubles for adapter-contract and router tests.
 *
 * In-memory fakes only — never shipped to production bundles, but published
 * so out-of-tree adapter implementations can run the same contract tests.
 */
export { createTestBuild, createTestProject } from "./create-project.ts";
export { databaseContractSuite, REQUIRED_TABLES } from "./database-contract.ts";
export { makeDatabase, makeStorage, type FakeStorage } from "./fake-adapters.ts";
export { queueContractSuite } from "./queue-contract.ts";
export { runnerContractSuite } from "./runner-contract.ts";
export { storageContractSuite } from "./storage-contract.ts";
