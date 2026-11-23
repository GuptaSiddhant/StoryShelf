/** Test helpers: a recording `fetch` stub and request-body reader shared by the provider tests. */
import { vi } from "vitest";

/** One request the stubbed `fetch` saw. */
export interface FetchCall {
  url: string;
  init: RequestInit;
}

/** Replace `fetch` with a recorder that answers through `respond`. */
export function stubFetch(respond: (url: string, init: RequestInit) => Response): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      await Promise.resolve();
      calls.push({ url, init });
      return respond(url, init);
    }),
  );
  return calls;
}

/** The JSON body of a recorded request. */
export function bodyOf(call: FetchCall | undefined): Record<string, unknown> {
  return JSON.parse(typeof call?.init.body === "string" ? call.init.body : "{}") as Record<
    string,
    unknown
  >;
}
