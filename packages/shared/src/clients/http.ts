/**
 * Minimal typed fetch wrapper for Jupiter Developer Platform.
 *
 * - Centralizes API key handling (`x-api-key` header)
 * - Surfaces structured errors
 * - Emits a "request observation" via the optional `onObservation` hook for the DX log
 *
 * Note: keyless access works at 0.5 RPS without an API key. For production we
 * pass the key via the x-api-key header per Jupiter docs.
 */

export interface JupiterClientOptions {
  baseUrl?: string;
  apiKey?: string | undefined;
  /** Hook for the orchestrator's DX log to capture every API call. */
  onObservation?: (obs: ApiObservation) => void;
}

export interface ApiObservation {
  method: string;
  path: string;
  startedAt: number;
  durationMs: number;
  status: number;
  ok: boolean;
  errorMessage?: string;
}

export class JupiterApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    message: string,
    public readonly bodyText?: string,
  ) {
    super(`[${status}] ${path}: ${message}`);
    this.name = 'JupiterApiError';
  }
}

export class JupiterHttpClient {
  readonly baseUrl: string;
  readonly apiKey: string | undefined;
  private readonly onObservation: ((obs: ApiObservation) => void) | undefined;

  constructor(opts: JupiterClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? 'https://api.jup.ag').replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.onObservation = opts.onObservation;
  }

  async get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const qs = params ? buildQueryString(params) : '';
    const url = `${this.baseUrl}${path}${qs}`;
    return this.request<T>('GET', path, url);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    return this.request<T>('POST', path, url, body);
  }

  async delete<T>(path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    return this.request<T>('DELETE', path, url, body);
  }

  private async request<T>(method: string, path: string, url: string, body?: unknown): Promise<T> {
    const startedAt = Date.now();
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (this.apiKey) headers['x-api-key'] = this.apiKey;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (cause) {
      const durationMs = Date.now() - startedAt;
      const message = cause instanceof Error ? cause.message : 'unknown network error';
      this.onObservation?.({
        method,
        path,
        startedAt,
        durationMs,
        status: 0,
        ok: false,
        errorMessage: message,
      });
      throw new JupiterApiError(0, path, `Network error: ${message}`);
    }

    const durationMs = Date.now() - startedAt;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.onObservation?.({
        method,
        path,
        startedAt,
        durationMs,
        status: res.status,
        ok: false,
        errorMessage: text.slice(0, 500),
      });
      throw new JupiterApiError(res.status, path, res.statusText, text);
    }

    const json = (await res.json()) as T;
    this.onObservation?.({
      method,
      path,
      startedAt,
      durationMs,
      status: res.status,
      ok: true,
    });
    return json;
  }
}

function buildQueryString(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '';
  const usp = new URLSearchParams();
  for (const [k, v] of entries) usp.set(k, String(v));
  return `?${usp.toString()}`;
}
