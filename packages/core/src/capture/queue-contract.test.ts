import { queueContractSuite } from "../test-helpers/queue-contract.ts";
import { InMemoryCaptureQueue } from "./queue.ts";

// The gate never opens: background jobs stay queued/running while the suite
// asserts, and a bare pending promise holds no timer or socket.
const gate = new Promise<void>(() => {});

queueContractSuite(
  "memory",
  () =>
    new InMemoryCaptureQueue({
      concurrency: 1,
      runJob: () => gate,
    }),
);
