/** An in-memory stand-in for the key-value service, installed as `fetch` in tests. */
export function fakeKvService(token: string): typeof fetch {
  const objects = new Map<string, string>();
  return async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const method = init?.method ?? "GET";
    if (headers.get("authorization") !== `Bearer ${token}`)
      return new Response("denied", { status: 401 });
    if (url.pathname === "/v1/health") return new Response("ok");
    if (url.pathname === "/v1/objects") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).toSorted();
      return Response.json({ keys });
    }
    const key = decodeURIComponent(url.pathname.slice("/v1/objects/".length));
    if (method === "PUT") {
      objects.set(key, (JSON.parse(String(init?.body)) as { data: string }).data);
      return new Response("stored");
    }
    const data = objects.get(key);
    if (data === undefined) return new Response("not found", { status: 404 });
    if (method === "DELETE") {
      objects.delete(key);
      return new Response("deleted");
    }
    return method === "HEAD" ? new Response(null) : Response.json({ data });
  };
}
