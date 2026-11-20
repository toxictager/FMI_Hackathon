// Small JSON POST helper. Throws on non-2xx so React Query marks the query as errored.
export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message = json && typeof json.error === "string" ? json.error : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return json as T;
}
