#!/usr/bin/env node
import { processIo } from "./io.ts";
import { runServerBin } from "./main.ts";

const code = await runServerBin(process.argv.slice(2), processIo);
// The executable owns the final exit: a handler that ignored its release (or an open exporter)
// cannot keep the process alive after `serve` has drained.
// oxlint-disable-next-line unicorn/no-process-exit -- the executable owns the final exit
process.exit(code);
