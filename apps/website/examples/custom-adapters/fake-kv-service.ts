/** An in-memory stand-in for the key-value service, installed as `fetch` in tests. */
export function fakeKvService(token: string): typeof fetch {
  const objects = new Map<string, string>();
  return (input, init) => {
    const url = new URL(String(input));
    const authorized = new Headers(init?.headers).get("authorization") === `Bearer ${token}`;
    return Promise.resolve(authorized ? respond(objects, url, init) : deny());
  };
}

function deny(): Response {
  return new Response("denied", { status: 401 });
}

function respond(objects: Map<string, string>, url: URL, init?: RequestInit): Response {
  if (url.pathname === "/v1/health") return new Response("ok");
  if (url.pathname === "/v1/objects") {
    const prefix = url.searchParams.get("prefix") ?? "";
    return Response.json({
      keys: [...objects.keys()].filter((k) => k.startsWith(prefix)).toSorted(),
    });
  }
  return respondToObject(
    objects,
    decodeURIComponent(url.pathname.slice("/v1/objects/".length)),
    init,
  );
}

function respondToObject(objects: Map<string, string>, key: string, init?: RequestInit): Response {
  const method = init?.method ?? "GET";
  if (method === "PUT") {
    objects.set(key, (JSON.parse(String(init?.body)) as { data: string }).data);
    return new Response("stored");
  }
  const data = objects.get(key);
  if (data === undefined) return new Response("not found", { status: 404 });
  if (method === "DELETE") objects.delete(key);
  return method === "GET" ? Response.json({ data }) : new Response(null);
}
