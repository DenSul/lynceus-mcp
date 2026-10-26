/**
 * Lynceus API client — thin typed wrapper over the REST surface.
 *
 * Auth: `Authorization: Bearer <LYNCEUS_API_KEY>`.
 * Base URL: LYNCEUS_API_URL (default https://api.lynceus.ru).
 */

import { randomUUID } from 'node:crypto';

/** Cancel only the local wait; submitted research jobs keep running remotely. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal?.reason ?? new DOMException('The operation was aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

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

// --- image search ----------------------------------------------------------

export interface LynceusImageResult {
  title: string;
  thumb_url: string;
  image_url: string;
  page_url: string;
  width: number;
  height: number;
  file_size?: number;
  mime_type?: string;
  domain: string;
}

export interface ImagesParams {
  query: string;
  max_results?: number;
}

export interface ImagesResponse {
  results: LynceusImageResult[];
  engine: string;
  cached?: boolean;
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

// --- Yandex Wordstat (search-demand statistics, RU audience) ---------------

export type WordstatDevice = 'all' | 'desktop' | 'phone' | 'tablet';

export interface WordstatTopParams {
  phrase: string;
  /** 1-2000, default 30 (compact) */
  num_phrases?: number;
  /** region IDs from wordstat_regions_tree (e.g. 225 = Россия, 213 = Москва) */
  regions?: string[];
  devices?: WordstatDevice[];
}

export interface WordstatPhraseCount {
  phrase: string;
  count: number;
}

export interface WordstatTopResponse {
  total_count: number;
  results: WordstatPhraseCount[];
  associations: WordstatPhraseCount[];
}

export type WordstatPeriod = 'monthly' | 'weekly' | 'daily';

export interface WordstatDynamicsParams {
  phrase: string;
  period: WordstatPeriod;
  /** YYYY-MM-DD or RFC3339; boundaries are snapped to valid period edges */
  from_date?: string;
  to_date?: string;
  regions?: string[];
  devices?: WordstatDevice[];
}

export interface WordstatDynamicsResponse {
  period: WordstatPeriod;
  from: string;
  to: string;
  results: { date: string; count: number; share: number }[];
}

export interface WordstatRegionsParams {
  phrase: string;
  granularity?: 'all' | 'cities' | 'regions';
  devices?: WordstatDevice[];
}

export interface WordstatRegionsResponse {
  granularity: string;
  results: { region: string; label: string; count: number; share: number; affinity_index: number }[];
}

export interface WordstatRegionNode {
  id: string;
  label: string;
  children?: WordstatRegionNode[];
}

export interface WordstatRegionsTreeResponse {
  regions: WordstatRegionNode[];
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
  images(p: ImagesParams, signal?: AbortSignal): Promise<ImagesResponse>;
  extract(p: ExtractParams, signal?: AbortSignal): Promise<ExtractResponse>;
  usage(signal?: AbortSignal): Promise<{ credits_remaining?: number }>;
  /** Submit a research job; resolves fast with the job_id. */
  researchSubmit(query: string, signal?: AbortSignal): Promise<ResearchSubmitResponse>;
  /** Poll a research job to a terminal state (11 min budget). */
  researchWait(jobId: string, signal: AbortSignal | undefined, onProgress?: (elapsedS: number, status: string, lastStep?: string) => void): Promise<ResearchJobState>;
  /** Legacy combined call retained for compatibility with older embedders. */
  research(p: ResearchParams, signal?: AbortSignal): Promise<ResearchJobState>;
  wordstatTop(p: WordstatTopParams, signal?: AbortSignal): Promise<WordstatTopResponse>;
  wordstatDynamics(p: WordstatDynamicsParams, signal?: AbortSignal): Promise<WordstatDynamicsResponse>;
  wordstatRegions(p: WordstatRegionsParams, signal?: AbortSignal): Promise<WordstatRegionsResponse>;
  wordstatRegionsTree(signal?: AbortSignal): Promise<WordstatRegionsTreeResponse>;
}

export function createClient(baseUrl?: string, apiKey?: string): ApiClient {
  const base = (baseUrl ?? process.env.LYNCEUS_API_URL ?? 'https://api.lynceus.ru').replace(/\/+$/, '');
  const key = apiKey ?? process.env.LYNCEUS_API_KEY ?? '';
  const timeoutMs = Number(process.env.LYNCEUS_TIMEOUT_MS ?? 120_000);

  async function call<T>(path: string, body: unknown, signal?: AbortSignal, method: 'POST' | 'GET' = 'POST'): Promise<T> {
    signal?.throwIfAborted();
    const maxAttempts = Number(process.env.LYNCEUS_RETRIES ?? 2); // 1 try + 1 retry on retryable failures
    // A lost submit response must not create a second research job/credit hold.
    // Other POST routes retain their existing retry semantics: the API caches
    // terminal errors as well as successes under an idempotency key.
    const idempotencyKey = method === 'POST' && path === '/v1/research' ? randomUUID() : undefined;
    const requestBody = JSON.stringify(body);
    let lastErr: LynceusApiError | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      signal?.throwIfAborted();
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      const onAbort = () => ac.abort(signal?.reason);
      signal?.addEventListener('abort', onAbort, { once: true });
      let receivedResponse = false;
      try {
        const res = await fetch(base + path, {
          method,
          headers: {
            'content-type': 'application/json',
            ...(key ? { authorization: `Bearer ${key}` } : {}),
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          },
          body: requestBody,
          signal: ac.signal,
        });
        receivedResponse = true;
        const text = await res.text();
        signal?.throwIfAborted();
        let parsed: any = undefined;
        try { parsed = text ? JSON.parse(text) : undefined; } catch { /* non-JSON error body */ }
        if (!res.ok) {
          const err = parsed?.error;
          throw new LynceusApiError(
            res.status,
            err?.code ?? `http_${res.status}`,
            err?.message ?? `HTTP ${res.status}`,
            Boolean(err?.retryable),
          );
        }
        return parsed as T;
      } catch (e) {
        // Caller cancellation is final, unlike the per-attempt network timeout.
        signal?.throwIfAborted();
        if (e instanceof LynceusApiError) {
          lastErr = e;
        } else {
          // Preserve existing body-error behavior for other endpoints. Research
          // may safely retry an uncertain body because all attempts share a key.
          if (receivedResponse && !idempotencyKey) throw e;
          const msg = e instanceof Error ? e.message : String(e);
          lastErr = new LynceusApiError(0, 'network_error', `Lynceus unreachable at ${base}: ${msg}`, true);
        }
        // HTTP failures retry only when the API declares them retryable.
        if (!lastErr.retryable || attempt >= maxAttempts) throw lastErr;
      } finally {
        // Keep the deadline through body consumption, and never retain a caller
        // listener after this attempt (including retries and aborted responses).
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
      await sleep(500 * attempt, signal);
    }
    throw lastErr ?? new LynceusApiError(0, 'unreachable', 'Lynceus unreachable', true);
  }

  return {
    search: (p, signal) => call<SearchResponse>('/v1/search', p, signal),
    images: (p, signal) => call<ImagesResponse>('/v1/images', p, signal),
    extract: (p, signal) => call<ExtractResponse>('/v1/extract', p, signal),
    usage: (signal) => call<{ credits_remaining?: number }>('/v1/usage', undefined, signal, 'GET'),
    researchSubmit: (query, signal) => call<ResearchSubmitResponse>('/v1/research', { query }, signal),
    researchWait: (jobId, signal, onProgress) => runResearchWait(jobId, signal, onProgress),
    research: (p, signal) => runResearch(p, signal),
    wordstatTop: (p, signal) => call<WordstatTopResponse>('/v1/wordstat/top', p, signal),
    wordstatDynamics: (p, signal) => call<WordstatDynamicsResponse>('/v1/wordstat/dynamics', p, signal),
    wordstatRegions: (p, signal) => call<WordstatRegionsResponse>('/v1/wordstat/regions', p, signal),
    wordstatRegionsTree: (signal) => call<WordstatRegionsTreeResponse>('/v1/wordstat/regions-tree', {}, signal),
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
      signal?.throwIfAborted();
      if (Date.now() > deadline) {
        throw new LynceusApiError(
          0, 'research_timeout',
          `job ${jobId} still ${st.status} after 11 min; poll GET ${base}/v1/research/jobs/${jobId}`,
          false,
        );
      }
      await sleep(5_000, signal);
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
