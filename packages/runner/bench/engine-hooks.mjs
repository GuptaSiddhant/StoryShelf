/** Resolve hook: maps `playwright-core` to the module in FLASHWRIGHT_CORE_ENTRY (a file URL). */
export async function resolve(specifier, context, next) {
  const target = process.env.FLASHWRIGHT_CORE_ENTRY;
  if (target && specifier === "playwright-core") return { url: target, shortCircuit: true };
  return await next(specifier, context);
}
