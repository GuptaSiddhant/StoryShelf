import { main } from "./cli.ts";

const code = await main(process.argv.slice(2));
// The executable owns the final exit: an open prompt stream cannot keep the process alive.
// oxlint-disable-next-line unicorn/no-process-exit -- the executable owns the final exit
process.exit(code);
