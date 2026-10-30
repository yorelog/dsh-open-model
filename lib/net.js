/**
 * Minimal HTTP layer with proxy support.
 *
 * Node's global fetch ignores `HTTP_PROXY`, so when a proxy is configured this
 * module shells out to curl (present on Windows 10+ and macOS) with `-x`. That
 * keeps proxy behavior identical for API calls, release downloads and the
 * model CLIs, all of which receive the same proxy environment.
 * @module @local/open-model/lib/net
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ensureDir } from './paths.js';
import { resolveExecutable } from './process.js';
import { sleep } from './util.js';

/**
 * @param {{ http: string, https: string, all: string, noProxy: string } | null | undefined} proxy
 * @returns {string}
 */
export function proxyUrlOf(proxy) {
  if (proxy === null || proxy === undefined) return '';
  return proxy.https || proxy.http || proxy.all || '';
}

/**
 * @returns {string | null}
 */
let curlPathCache;
export function curlPath() {
  if (curlPathCache === undefined) curlPathCache = resolveExecutable('curl');
  return curlPathCache;
}

/**
 * @param {number} timeoutMs
 * @param {AbortSignal | undefined} signal
 * @returns {{ signal: AbortSignal, dispose: () => void }}
 */
function timeoutSignal(timeoutMs, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
  const onAbort = () => controller.abort(signal?.reason ?? new Error('aborted'));
  if (signal !== undefined) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  };
}

/**
 * @param {string} url
 * @param {{
 *   method?: string,
 *   headers?: Record<string, string>,
 *   body?: string,
 *   timeoutMs?: number,
 *   signal?: AbortSignal,
 *   proxy?: { http: string, https: string, all: string, noProxy: string } | null,
 *   maxBytes?: number
 * }} [options]
 * @returns {Promise<{ status: number, text: string, headers: Record<string, string> }>}
 */
export async function httpRequest(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const proxy = proxyUrlOf(options.proxy);
  if (proxy.length > 0) {
    const curl = curlPath();
    if (curl === null) throw new Error('curl is required when an HTTP proxy is configured');
    const args = [
      curl,
      '--silent',
      '--show-error',
      '--location',
      '--compressed',
      '--max-time',
      String(Math.max(1, Math.ceil(timeoutMs / 1000))),
      '--proxy',
      proxy,
      '--write-out',
      '\n__OPEN_MODEL_STATUS__%{http_code}',
      '--request',
      options.method ?? 'GET'
    ];
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      args.push('--header', `${name}: ${value}`);
    }
    if (options.body !== undefined) args.push('--data-binary', options.body);
    args.push(url);
    const { runCommand } = await import('./process.js');
    const result = await runCommand(args, { timeoutMs: timeoutMs + 5_000, signal: options.signal });
    if (result.aborted) throw new Error('aborted');
    if (result.spawnError !== null) throw result.spawnError;
    const marker = result.stdout.lastIndexOf('__OPEN_MODEL_STATUS__');
    const text = marker >= 0 ? result.stdout.slice(0, marker) : result.stdout;
    const status = marker >= 0 ? Number.parseInt(result.stdout.slice(marker + '__OPEN_MODEL_STATUS__'.length).trim(), 10) : 0;
    if (status === 0) {
      throw new Error((result.stderr || result.stdout || 'curl failed').trim());
    }
    return { status, text: text.replace(/\n$/u, ''), headers: {} };
  }

  const timeout = timeoutSignal(timeoutMs, options.signal);
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
      signal: timeout.signal,
      redirect: 'follow'
    });
    const text = await response.text();
    const headers = {};
    response.headers.forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });
    return { status: response.status, text, headers };
  } finally {
    timeout.dispose();
  }
}

/**
 * GET a JSON document with a status check.
 * @param {string} url
 * @param {{ timeoutMs?: number, signal?: AbortSignal, proxy?: any, headers?: Record<string, string> }} [options]
 * @returns {Promise<{ status: number, json: any, text: string, headers: Record<string, string> }>}
 */
export async function httpJson(url, options = {}) {
  const response = await httpRequest(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'dsh-open-model/1.0',
      ...(options.headers ?? {})
    }
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status} from ${url}: ${response.text.slice(0, 500)}`);
  }
  let json;
  try {
    json = JSON.parse(response.text);
  } catch {
    throw new Error(`invalid JSON from ${url}`);
  }
  return { ...response, json };
}

/**
 * Read a resource's total length without downloading it.
 * @param {string} url
 * @param {{ timeoutMs?: number, signal?: AbortSignal, proxy?: any }} [options]
 * @returns {Promise<number | null>}
 */
export async function contentLength(url, options = {}) {
  const proxy = proxyUrlOf(options.proxy);
  try {
    if (proxy.length > 0) {
      const curl = curlPath();
      if (curl === null) return null;
      const { runCommand } = await import('./process.js');
      const result = await runCommand(
        [
          curl, '--silent', '--show-error', '--location', '--head',
          '--max-time', String(Math.max(1, Math.ceil((options.timeoutMs ?? 20_000) / 1000))),
          '--proxy', proxy, url
        ],
        { timeoutMs: (options.timeoutMs ?? 20_000) + 5_000, signal: options.signal }
      );
      const match = /content-length:\s*(\d+)/iu.exec(result.stdout);
      return match === null ? null : Number.parseInt(match[1], 10);
    }
    const timeout = timeoutSignal(options.timeoutMs ?? 20_000, options.signal);
    try {
      const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: timeout.signal });
      if (!response.ok) return null;
      const length = response.headers.get('content-length');
      return length === null ? null : Number.parseInt(length, 10);
    } finally {
      timeout.dispose();
    }
  } catch {
    return null;
  }
}

/**
 * Probe reachability and latency of a URL (used before a GitHub download to
 * decide whether the configured proxy prefix is needed).
 * @param {string} url
 * @param {{ timeoutMs?: number, signal?: AbortSignal, proxy?: any }} [options]
 * @returns {Promise<{ ok: boolean, status: number, elapsedMs: number, error?: string }>}
 */
export async function probe(url, options = {}) {
  const startedAt = Date.now();
  try {
    const response = await httpRequest(url, {
      method: 'GET',
      timeoutMs: options.timeoutMs ?? 20_000,
      signal: options.signal,
      proxy: options.proxy
    });
    return { ok: response.status >= 200 && response.status < 400, status: response.status, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Download a file with resume, progress and cancellation.
 *
 * @param {{
 *   url: string,
 *   dest: string,
 *   totalBytes?: number | null,
 *   timeoutMs?: number,
 *   signal?: AbortSignal,
 *   proxy?: any,
 *   onProgress?: (progress: { bytes: number, totalBytes: number | null }) => void,
 *   resume?: boolean
 * }} options
 * @returns {Promise<{ bytes: number, totalBytes: number | null, resumed: boolean }>}
 */
export async function downloadFile(options) {
  const proxy = proxyUrlOf(options.proxy);
  const resume = options.resume !== false;
  let existing = 0;
  try {
    const stat = await fsp.stat(options.dest);
    if (resume && stat.isFile()) existing = stat.size;
  } catch {
    existing = 0;
  }
  await ensureDir(path.dirname(options.dest));

  const total = options.totalBytes ?? (await contentLength(options.url, {
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    proxy: options.proxy
  }));
  if (existing > 0 && total !== null && existing >= total) {
    return { bytes: existing, totalBytes: total, resumed: true };
  }

  if (proxy.length > 0) return downloadWithCurl({ ...options, existing, total });
  return downloadWithFetch({ ...options, existing, total });
}

/**
 * @param {any} options
 * @returns {Promise<{ bytes: number, totalBytes: number | null, resumed: boolean }>}
 */
async function downloadWithFetch(options) {
  const { existing, total } = options;
  const headers = {};
  if (existing > 0) headers.Range = `bytes=${existing}-`;
  const timeout = timeoutSignal(options.timeoutMs ?? 60 * 60 * 1000, options.signal);
  try {
    const response = await fetch(options.url, {
      headers: { ...headers, 'User-Agent': 'dsh-open-model/1.0' },
      redirect: 'follow',
      signal: timeout.signal
    });
    if (response.status === 416) {
      const size = (await fsp.stat(options.dest)).size;
      return { bytes: size, totalBytes: size, resumed: true };
    }
    if (response.status >= 300 && response.status !== 304) {
      throw new Error(`HTTP ${response.status} for ${options.url}`);
    }
    const append = existing > 0 && response.status === 206;
    const resolvedTotal = total ?? (response.headers.get('content-length') === null
      ? null
      : Number.parseInt(response.headers.get('content-length'), 10) + (append ? existing : 0));
    let bytes = append ? existing : 0;
    if (!append && existing > 0) await fsp.rm(options.dest, { force: true });
    const file = fs.createWriteStream(options.dest, { flags: append ? 'a' : 'w' });
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error('empty response body');
    let lastReport = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (!file.write(Buffer.from(value))) {
        await new Promise((resolve) => file.once('drain', resolve));
      }
      const now = Date.now();
      if (now - lastReport >= 400) {
        lastReport = now;
        options.onProgress?.({ bytes, totalBytes: resolvedTotal });
      }
    }
    await new Promise((resolve, reject) => {
      file.end((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    options.onProgress?.({ bytes, totalBytes: resolvedTotal });
    return { bytes, totalBytes: resolvedTotal, resumed: append && existing > 0 };
  } finally {
    timeout.dispose();
  }
}

/**
 * @param {any} options
 * @returns {Promise<{ bytes: number, totalBytes: number | null, resumed: boolean }>}
 */
async function downloadWithCurl(options) {
  const curl = curlPath();
  if (curl === null) throw new Error('curl is required when an HTTP proxy is configured');
  const { existing, total } = options;
  const resumeFlag = existing > 0 ? ['--continue-at', '-'] : [];
  const args = [
    curl,
    '--silent',
    '--show-error',
    '--location',
    '--fail',
    '--retry',
    '3',
    '--retry-delay',
    '2',
    '--proxy',
    proxyUrlOf(options.proxy),
    '--output',
    options.dest,
    ...resumeFlag,
    options.url
  ];
  const child = spawn(args[0], args.slice(1), { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let stderr = '';
  let spawnError = null;
  child.on('error', (error) => {
    spawnError = error;
  });
  child.stderr?.on('data', (chunk) => {
    stderr = `${stderr}${chunk.toString('utf8')}`.slice(-4_000);
  });
  let aborted = false;
  const onAbort = () => {
    aborted = true;
    try {
      child.kill('SIGKILL');
    } catch {
      // Already gone.
    }
  };
  if (options.signal !== undefined) {
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener('abort', onAbort, { once: true });
  }
  const deadline = Date.now() + (options.timeoutMs ?? 60 * 60 * 1000);
  const exitPromise = new Promise((resolve) => child.once('close', (code) => resolve(code)));
  for (;;) {
    await sleep(400);
    if (spawnError !== null) throw spawnError;
    let bytes = existing;
    try {
      bytes = (await fsp.stat(options.dest)).size;
    } catch {
      bytes = 0;
    }
    options.onProgress?.({ bytes, totalBytes: total });
    const code = await Promise.race([exitPromise, sleep(1).then(() => undefined)]);
    if (code !== undefined) {
      if (aborted || (code !== 0 && abortRequested(options.signal))) throw new Error('aborted');
      if (code !== 0) throw new Error(`curl exited with ${code}: ${stderr.trim()}`);
      const finalSize = (await fsp.stat(options.dest)).size;
      options.onProgress?.({ bytes: finalSize, totalBytes: total ?? finalSize });
      return { bytes: finalSize, totalBytes: total ?? finalSize, resumed: existing > 0 };
    }
    if (Date.now() > deadline) {
      onAbort();
      throw new Error('download timed out');
    }
  }
}

/**
 * @param {AbortSignal | undefined} signal
 * @returns {boolean}
 */
function abortRequested(signal) {
  return signal?.aborted === true;
}
