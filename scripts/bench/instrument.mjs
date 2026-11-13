// oxlint-disable-next-line unicorn/no-abusive-eslint-disable
/* oxlint-disable */
/**
 * Counting wrappers for the adapters under test (issue #853). `instrument` returns a Proxy that
 * forwards every method of an adapter unchanged and records one entry per call: the method, a
 * short detail (a storage path, a table name), the wall time until the promise settles and the
 * time the call started. Properties that are not functions (`tables`, `lifecycle`) pass through.
 */

/** The table a drizzle handle stands for, or the value itself when it is not a table. */
function describeArg(arg) {
  if (typeof arg === "string") return arg;
  const name = arg?.[Symbol.for("drizzle:Name")];
  return typeof name === "string" ? name : "";
}

/** Wrap `target`; every call lands in `calls` as `{ name, detail, ms, at }`. */
export function instrument(target, calls) {
  // Adapters are frozen; a proxy over a frozen target must return its exact values, so proxy an
  // empty object that inherits from the adapter instead.
  return new Proxy(Object.create(target), {
    get(_shadow, key) {
      const value = Reflect.get(target, key);
      if (typeof value !== "function" || typeof key !== "string") return value;
      return (...args) => {
        const at = performance.now();
        const record = () => {
          calls.push({ name: key, detail: describeArg(args[0]), ms: performance.now() - at, at });
        };
        const result = value.apply(target, args);
        if (result && typeof result.then === "function") {
          return result.finally(record);
        }
        record();
        return result;
      };
    },
  });
}

/** Calls per method name. */
export function countByName(calls) {
  const counts = {};
  for (const call of calls) counts[call.name] = (counts[call.name] ?? 0) + 1;
  return counts;
}

/** The `limit` slowest calls, as `method detail` with whole-millisecond times. */
export function slowest(calls, limit = 3) {
  return calls
    .toSorted((a, b) => b.ms - a.ms)
    .slice(0, limit)
    .map((call) => ({ call: `${call.name} ${call.detail}`.trim(), ms: round(call.ms) }));
}

export function round(value, digits = 1) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
