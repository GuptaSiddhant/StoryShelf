/**
 * Test doubles for adapter-contract and router tests.
 *
 * In-memory fakes only — never shipped to production bundles, but published
 * so out-of-tree adapter implementations can run the same contract tests.
 */
export { designContractSuite, type DesignContractSamples } from "./design-contract.ts";
export { createTestBuild, createTestProject } from "./create-project.ts";
export { databaseContractSuite, REQUIRED_TABLES } from "./database-contract.ts";
export { FAKE_PNG, fakeUrl, makeFakeDesign, type FakeDesign } from "./fake-design.ts";
export { makeDatabase, makeStorage, stubTables, type FakeStorage } from "./fake-adapters.ts";
export { notifierContractSuite, stateNotifierContractSuite } from "./notifier-contract.ts";
export {
  queueContractSuite,
  type PollableContractOptions,
  type QueueContractOptions,
  type QueueFactory,
} from "./queue-contract.ts";
export {
  databaseQueueMultiInstanceSuite,
  type MultiInstanceOptions,
  type SharedDatabaseFactory,
} from "./queue-multi-instance.ts";
export { createManualClock, type ManualClock } from "./manual-clock.ts";
export { runnerContractSuite } from "./runner-contract.ts";
export { storageContractSuite } from "./storage-contract.ts";
export { makeFakeStateNotifier, type FakeStateNotifier } from "./fake-notifier.ts";
