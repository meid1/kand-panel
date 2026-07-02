// Тонкая обёртка над fetch (Node 18+). Все провайдеры ходят через неё.
export async function httpJson(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<any> {
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: opts.headers,
    body: opts.body,
  });
  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return data;
}
