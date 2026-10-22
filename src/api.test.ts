import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { createClient } from './api.js';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('API request lifecycle', () => {
  it('keeps the configured deadline active while a real HTTP response body stalls', async () => {
    vi.stubEnv('LYNCEUS_TIMEOUT_MS', '120');
    vi.stubEnv('LYNCEUS_RETRIES', '1');
    let headersSent!: () => void;
    const headers = new Promise<void>((resolve) => { headersSent = resolve; });
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"credits_remaining":');
      headersSent();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing local fixture address');
    const controller = new AbortController();
    const pending = createClient(`http://127.0.0.1:${address.port}`, 'local-fixture-only').usage(controller.signal);
    const outcome = pending.then(() => 'resolved', () => 'rejected');
    try {
      await headers;
      const result = await Promise.race([outcome, new Promise<string>((resolve) => setTimeout(() => resolve('still waiting'), 500))]);
      expect(result).toBe('rejected');
    } finally {
      controller.abort();
      await pending.catch(() => {});
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('does not send a request when the caller was already cancelled', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ credits_remaining: 1 }));
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    controller.abort();
    await expect(createClient('http://fixture.invalid').usage(controller.signal)).rejects.toHaveProperty('name', 'AbortError');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cancels retry backoff promptly without issuing the next attempt', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValueOnce(new Error('network failure')).mockResolvedValue(json({ credits_remaining: 1 }));
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const pending = createClient('http://fixture.invalid').usage(controller.signal);
    let error: unknown;
    let settled = false;
    const handled = pending.then(() => { settled = true; }, (e) => { error = e; settled = true; });
    try {
      await vi.advanceTimersByTimeAsync(0);
      controller.abort();
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(true);
      expect(error).toHaveProperty('name', 'AbortError');
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      await vi.runAllTimersAsync();
      await handled;
    }
  });

  it('removes caller abort listeners after successful requests', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(json({ credits_remaining: 1 }))));
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const client = createClient('http://fixture.invalid');
    for (let i = 0; i < 3; i++) await client.usage(controller.signal);
    expect(remove.mock.calls.filter(([type]) => type === 'abort')).toHaveLength(add.mock.calls.filter(([type]) => type === 'abort').length);
  });

  it('cancels research polling sleep without cancelling or polling the server job again', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(json({ job_id: 'owned-job', status: 'running' })).mockResolvedValueOnce(json({ job_id: 'owned-job', status: 'done' }));
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    let error: unknown;
    let settled = false;
    const handled = createClient('http://fixture.invalid').researchWait('owned-job', controller.signal).then(() => { settled = true; }, (e) => { error = e; settled = true; });
    try {
      await vi.advanceTimersByTimeAsync(0);
      controller.abort();
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(true);
      expect(error).toHaveProperty('name', 'AbortError');
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][0]).toBe('http://fixture.invalid/v1/research/jobs/owned-job');
    } finally {
      await vi.runAllTimersAsync();
      await handled;
    }
  });
  it('reuses one research idempotency key after a lost response and a new key for a new submission', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValueOnce(new Error('response lost')).mockImplementation(() => Promise.resolve(json({ job_id: 'job-replayed', status: 'queued', credits_held: 300 })));
    vi.stubGlobal('fetch', fetch);
    const client = createClient('http://fixture.invalid');
    const pending = client.researchSubmit('same question');
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toHaveProperty('job_id', 'job-replayed');
    await client.researchSubmit('same question');
    const keys = fetch.mock.calls.map(([, options]) => new Headers(options.headers).get('Idempotency-Key'));
    expect(keys[0]).toMatch(/^[a-f0-9-]{36}$/);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('retries an interrupted research body with the same key instead of creating a second job', async () => {
    vi.useFakeTimers();
    const jobs = new Map<string, object>();
    const fetch = vi.fn().mockImplementation((_url: string, options: RequestInit) => {
      const key = new Headers(options.headers).get('Idempotency-Key')!;
      if (!jobs.has(key)) {
        jobs.set(key, { job_id: 'only-job', status: 'queued', credits_held: 300 });
        return Promise.resolve(new Response(new ReadableStream({ start(controller) { controller.error(new Error('response body disconnected')); } })));
      }
      return Promise.resolve(json(jobs.get(key), 202));
    });
    vi.stubGlobal('fetch', fetch);
    const pending = createClient('http://fixture.invalid').researchSubmit('question');
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toHaveProperty('job_id', 'only-job');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(jobs.size).toBe(1);
  });

  it('handles a pending research claim using the same bounded retry policy', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(json({ error: { code: 'idempotency_pending', message: 'operation pending', retryable: true } }, 409)));
    vi.stubGlobal('fetch', fetch);
    const pending = createClient('http://fixture.invalid').researchSubmit('question');
    const failure = expect(pending).rejects.toMatchObject({ status: 409, code: 'idempotency_pending', retryable: true });
    await vi.runAllTimersAsync();
    await failure;
    expect(fetch).toHaveBeenCalledTimes(2);
    const keys = fetch.mock.calls.map(([, options]) => new Headers(options.headers).get('Idempotency-Key'));
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it('keeps retryable search responses and GETs free of research idempotency keys', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(json({ error: { code: 'engine_upstream', message: 'retry', retryable: true } }, 503)).mockImplementation(() => Promise.resolve(json({ results: [], cached: false })));
    vi.stubGlobal('fetch', fetch);
    const client = createClient('http://fixture.invalid');
    const pending = client.search({ query: 'question' });
    await vi.runAllTimersAsync();
    await pending;
    await client.usage();
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const [, options] of fetch.mock.calls) expect(new Headers(options.headers).has('Idempotency-Key')).toBe(false);
  });

  it('does not retry non-retryable API errors or ordinary response-body failures', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ error: { code: 'unauthorized', message: 'bad key', retryable: false } }, 401));
    vi.stubGlobal('fetch', fetch);
    const client = createClient('http://fixture.invalid');
    await expect(client.search({ query: 'question' })).rejects.toMatchObject({ status: 401, code: 'unauthorized', retryable: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    const bodyError = new Error('body disconnected');
    fetch.mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.error(bodyError); } })));
    await expect(client.extract({ urls: ['https://example.com'] })).rejects.toBe(bodyError);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('aborts an in-flight request without retrying and removes its caller listener', async () => {
    const fetch = vi.fn().mockImplementation((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = createClient('http://fixture.invalid').search({ query: 'question' }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toHaveProperty('name', 'AbortError');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

});
