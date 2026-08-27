/**
 * Lynceus API client — thin typed wrapper over the REST surface.
 *
 * Auth: `Authorization: Bearer <LYNCEUS_API_KEY>`.
 * Base URL: LYNCEUS_API_URL (default https://api.lynceus.ru).
 */

export interface LynceusSearchResult {
  url: string;
  title: string;
  snippet: string;
  rank: number;
  published_date?: string;
  cached?: boolean;
}

export interface SearchParams {
  query: string;
  freshness?: 'time' | 'day' | 'week' | 'month';
  max_results?: number;
}

export interface SearchResponse {
  results: LynceusSearchResult[];
  cached: boolean;
  degraded?: boolean;
}

export interface LynceusExtractResult {
  url: string;
  url_normalized?: string;
  status: string;
  http_code?: number;
  markdown: string;
  chars?: number;
  cached?: boolean;
  error_code?: string;
  truncated?: boolean;
  next_offset?: number;
}

export interface ExtractParams {
  urls: string[];
  allow_browser?: boolean;
  allow_captcha?: boolean;
  format?: 'markdown' | 'text';
  max_chars?: number;
  offset?: number;
}

export interface ExtractResponse {
  results: LynceusExtractResult[];
  credits_charged: number;
  credits_remaining?: number;
}

// --- deep research --------------------------------------------------------

export interface ResearchSubmitResponse {
  job_id: string;
  status: string;
  credits_held: number;
  poll_url?: string;
}

export interface ResearchJobState {
  job_id?: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  progress?: { at: string; kind: string; detail?: string }[];
  result?: {
    report?: {
      complete?: boolean;
      markdown?: string;
      queries_used?: number;
      urls_read?: number;
      prompt_tokens?: number;
      completion_tokens?: number;
    };
    credits_charged?: number;
    credits_refunded?: number;
    error?: { code?: string; message?: string };
  };
}

export interface ResearchParams {
  query: string;
  /** false → submit and return job_id immediately (default true) */
  wait?: boolean;
}

export class LynceusApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryable: boolean,
  ) {
    super(message);
    this.name = 'LynceusApiError';
  }
}

export interface ApiClient {
  search(p: SearchParams, signal?: AbortSignal): Promise<SearchResponse>;
  extract(p: ExtractParams, signal?: AbortSignal): Promise<ExtractResponse>;
  usage(signal?: AbortSignal): Promise<{ credits_remaining?: number }>;
  /** Submit a research job; resolves fast with the job_id. */
  researchSubmit(query: string, signal?: AbortSignal): Promise<ResearchSubmitResponse>;
  /** Poll a research job to a terminal state (11 min budget). */
  researchWait(jobId: string, signal: AbortSignal | undefined, onProgress?: (elapsedS: number, status: string, lastStep?: string) => void): Promise<ResearchJobState>;
  /** Legacy combined call retained for compatibility with older embedders. */
  research(p: ResearchParams, signal?: AbortSignal): Promise<ResearchJobState>;
}

export function createClient(baseUrl?: string, apiKey?: string): ApiClient {
  const base = (baseUrl ?? process.env.LYNCEUS_API_URL ?? 'https://api.lynceus.ru').replace(/\/+$/, '');
  const key = apiKey ?? process.env.LYNCEUS_API_KEY ?? '';
  const timeoutMs = Number(process.env.LYNCEUS_TIMEOUT_MS ?? 120_000);

  async function call<T>(path: string, body: unknown, signal?: AbortSignal, method: 'POST' | 'GET' = 'POST'): Promise<T> {
    const maxAttempts = Number(process.env.LYNCEUS_RETRIES ?? 2); // 1 try + 1 retry on retryable failures
    let lastErr: LynceusApiError | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      if (signal) signal.addEventListener('abort', () => ac.abort(), { once: true });
      let res: Response;
      try {
        res = await fetch(base + path, {
          method,
          headers: {
            'content-type': 'application/json',
            ...(key ? { authorization: `Bearer ${key}` } : {}),
          },
          body: JSON.stringify(body),
          signal: ac.signal,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        lastErr = new LynceusApiError(0, 'network_error', `Lynceus unreachable at ${base}: ${msg}`, true);
        if (attempt < maxAttempts && (signal?.aborted !== true)) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
          continue;
        }
        throw lastErr;
      } finally {
        clearTimeout(timer);
      }
      const text = await res.text();
      let parsed: any = undefined;
      try { parsed = text ? JSON.parse(text) : undefined; } catch { /* non-JSON error body */ }
      if (!res.ok) {
        const err = parsed?.error;
        const apiErr = new LynceusApiError(
          res.status,
          err?.code ?? `http_${res.status}`,
          err?.message ?? `HTTP ${res.status}`,
          Boolean(err?.retryable),
        );
        // Retry only what the API declares retryable (timeout / 502 /
        // 504); 4xx (auth, credits, validation) fail fast.
        if (apiErr.retryable && attempt < maxAttempts) {
          lastErr = apiErr;
          await new Promise((r) => setTimeout(r, 500 * attempt));
          continue;
        }
        throw apiErr;
      }
      return parsed as T;
    }
    throw lastErr ?? new LynceusApiError(0, 'unreachable', 'Lynceus unreachable', true);
  }

  return {
    search: (p, signal) => call<SearchResponse>('/v1/search', p, signal),
    extract: (p, signal) => call<ExtractResponse>('/v1/extract', p, signal),
    usage: (signal) => call<{ credits_remaining?: number }>('/v1/usage', undefined, signal, 'GET'),
    researchSubmit: (query, signal) => call<ResearchSubmitResponse>('/v1/research', { query }, signal),
    researchWait: (jobId, signal, onProgress) => runResearchWait(jobId, signal, onProgress),
    research: (p, signal) => runResearch(p, signal),
  };

  // Poll a submitted job to a terminal state. Emits onProgress every
  // ~20s so the MCP layer can keep the client's timers alive (a plain
  // blocking call dies at the client's ~60s request timeout while the
  // job keeps running — field report 2026-08-27).
  async function runResearchWait(
    jobId: string,
    signal: AbortSignal | undefined,
    onProgress?: (elapsedS: number, status: string, lastStep?: string) => void,
  ): Promise<ResearchJobState> {
    const started = Date.now();
    const deadline = started + 11 * 60_000;
    let lastTick = 0;
    for (;;) {
      const st = await call<ResearchJobState>(`/v1/research/jobs/${jobId}`, undefined, signal, 'GET');
      if (st.status === 'done' || st.status === 'failed') return st;
      const elapsedS = Math.round((Date.now() - started) / 1000);
      if (onProgress && elapsedS - lastTick >= 20) {
        lastTick = elapsedS;
        const steps = st.progress ?? [];
        const last = steps.length ? `${steps[steps.length - 1].kind}: ${steps[steps.length - 1].detail ?? ''}`.slice(0, 80) : undefined;
        onProgress(elapsedS, st.status, last);
      }
      if (signal?.aborted) return st;
      if (Date.now() > deadline) {
        throw new LynceusApiError(
          0, 'research_timeout',
          `job ${jobId} still ${st.status} after 11 min; poll GET ${base}/v1/research/jobs/${jobId}`,
          false,
        );
      }
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }

  // Deep research is asynchronous: submit, then poll the job until a
  // terminal state. Budgets mirror the server (≤10 min run).
  async function runResearch(p: ResearchParams, signal?: AbortSignal): Promise<ResearchJobState> {
    const submitted = await call<ResearchSubmitResponse>('/v1/research', { query: p.query }, signal);
    const job: ResearchJobState = { job_id: submitted.job_id, status: 'queued' as const };
    if (p.wait === false) return job;
    return runResearchWait(submitted.job_id, signal);
  }
}
