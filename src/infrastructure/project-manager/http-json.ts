// Small fetch wrapper shared by the read-only project sources: a timeout, a
// readable error, and no body logging (bodies carry project data).
export const DEFAULT_TIMEOUT_MS = 25_000;

export async function getJson<T>(
  url: string,
  headers: Record<string, string>,
  init: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number } = {},
): Promise<{ data: T; headers: Headers }> {
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(init.body !== undefined
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...headers,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${new URL(url).host} responded ${response.status}`);
  }
  return { data: (await response.json()) as T, headers: response.headers };
}

export const basicAuth = (user: string, token: string): string =>
  `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`;

export const shortDate = (iso?: string | null): string =>
  iso ? iso.slice(5, 10) : '—';

export const oneLine = (text: string | null | undefined, max: number): string =>
  (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
