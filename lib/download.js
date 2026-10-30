/**
 * Model downloads with mirror/proxy injection, progress, cancellation and
 * resume.
 *
 * Transport choice follows the contract: the Hub CLI is preferred over the
 * Python SDK, and the environment reports which path was actually verified so
 * the prompt section can tell the model which one to prefer. Progress is
 * measured from the destination directory, which works for every CLI/SDK
 * without parsing private progress formats.
 * @module @local/open-model/lib/download
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildChildEnv, endpointFor } from './config.js';
import { httpJson } from './net.js';
import { downloadsPath, ensureDir, readJson, treeSize, writeJsonAtomic } from './paths.js';
import { killChild, resolveExecutable, runCommand } from './process.js';
import { fetchModelScopeFiles } from './search.js';
import { formatSpeed, isoNow, truncate } from './util.js';

const JOURNAL_VERSION = 1;
const POLL_MS = 800;

/** @typedef {'queued'|'running'|'completed'|'failed'|'cancelled'|'interrupted'} DownloadState */

/**
 * Detect the HF command line tools.
 * @returns {{ cli: string | null, cliKind: 'hf' | 'huggingface-cli' | null, python: string | null }}
 */
function detectHuggingFaceTools() {
  const hf = resolveExecutable('hf');
  const legacy = hf === null ? resolveExecutable('huggingface-cli') : null;
  const python = resolveExecutable('python3') ?? resolveExecutable('python') ?? resolveExecutable('py');
  return {
    cli: hf ?? legacy,
    cliKind: hf !== null ? 'hf' : (legacy !== null ? 'huggingface-cli' : null),
    python
  };
}

/**
 * Detect the ModelScope command line tools.
 * @returns {{ cli: string | null, cliKind: 'modelscope' | 'ms' | null, python: string | null }}
 */
function detectModelScopeTools() {
  const modelscope = resolveExecutable('modelscope');
  const ms = modelscope === null ? resolveExecutable('ms') : null;
  const python = resolveExecutable('python3') ?? resolveExecutable('python') ?? resolveExecutable('py');
  return {
    cli: modelscope ?? ms,
    cliKind: modelscope !== null ? 'modelscope' : (ms !== null ? 'ms' : null),
    python
  };
}

/**
 * @param {string | null} python
 * @param {string} moduleName
 * @returns {Promise<boolean>}
 */
async function pythonModuleAvailable(python, moduleName) {
  if (python === null) return false;
  const result = await runCommand([python, '-c', `import ${moduleName}`], { timeoutMs: 15_000 });
  return result.code === 0;
}

/** Cached verification result for the lifetime of the plugin instance. */
let toolingCache = null;

/**
 * Verify which download paths are usable. Runs at most once per instance after
 * the first call; failures are cached too so a missing tool does not spawn a
 * probe on every download.
 * @param {{ refresh?: boolean }} [options]
 * @returns {Promise<{
 *   hf: { cli: string | null, cliKind: string | null, sdk: boolean, python: string | null },
 *   modelscope: { cli: string | null, cliKind: string | null, sdk: boolean, python: string | null },
 *   preferred: { huggingface: string | null, modelscope: string | null }
 * }>}
 */
export async function detectDownloadTooling(options = {}) {
  if (toolingCache !== null && options.refresh !== true) return toolingCache;
  const hfTools = detectHuggingFaceTools();
  const msTools = detectModelScopeTools();
  const hfSdk = await pythonModuleAvailable(hfTools.python, 'huggingface_hub');
  const msSdk = await pythonModuleAvailable(msTools.python, 'modelscope');
  toolingCache = {
    hf: { cli: hfTools.cli, cliKind: hfTools.cliKind, sdk: hfSdk, python: hfTools.python },
    modelscope: { cli: msTools.cli, cliKind: msTools.cliKind, sdk: msSdk, python: msTools.python },
    preferred: {
      huggingface: hfTools.cli !== null ? 'hf-cli' : (hfSdk ? 'hf-sdk' : null),
      modelscope: msTools.cli !== null ? 'modelscope-cli' : (msSdk ? 'modelscope-sdk' : null)
    }
  };
  return toolingCache;
}

/**
 * Human-readable label of a download method.
 * @param {string} method
 * @returns {'hf-cli'|'hf-sdk'|'modelscope-cli'|'modelscope-sdk'|'unknown'}
 */
export function methodKey(method) {
  if (method === 'hf-cli' || method === 'hf-sdk' || method === 'modelscope-cli' || method === 'modelscope-sdk') return method;
  return 'unknown';
}

/**
 * Expected total bytes for a repository (best effort).
 * @param {{ repoId: string, source: string, include?: string, config: any, signal?: AbortSignal, proxy?: any }} params
 * @returns {Promise<{ totalBytes: number | null, files: Array<{ path: string, sizeBytes: number | null }> }>}
 */
export async function expectedDownloadBytes(params) {
  const endpoint = endpointFor(params.source, params.config);
  const include = params.include?.trim();
  try {
    if (params.source === 'modelscope') {
      const listing = await fetchModelScopeFiles(endpoint, params.repoId, { signal: params.signal, proxy: params.proxy });
      if (listing === null) return { totalBytes: null, files: [] };
      const files = include === undefined || include.length === 0
        ? listing.files
        : listing.files.filter((entry) => globMatch(include, entry.path));
      const total = files.every((entry) => entry.sizeBytes !== null)
        ? files.reduce((sum, entry) => sum + (entry.sizeBytes ?? 0), 0)
        : null;
      return { totalBytes: total, files };
    }
    const encoded = params.repoId.split('/').map((part) => encodeURIComponent(part)).join('/');
    const { json } = await httpJson(`${endpoint}/api/models/${encoded}?blobs=true`, {
      timeoutMs: 20_000,
      signal: params.signal,
      proxy: params.proxy
    });
    const siblings = Array.isArray(json?.siblings) ? json.siblings : [];
    const files = siblings.map((sibling) => ({
      path: String(sibling?.rfilename ?? sibling?.path ?? ''),
      sizeBytes: typeof sibling?.size === 'number' ? sibling.size : null
    })).filter((entry) => entry.path.length > 0);
    const selected = include === undefined || include.length === 0
      ? files
      : files.filter((entry) => globMatch(include, entry.path));
    const total = selected.length > 0 && selected.every((entry) => entry.sizeBytes !== null)
      ? selected.reduce((sum, entry) => sum + (entry.sizeBytes ?? 0), 0)
      : null;
    return { totalBytes: total, files: selected };
  } catch {
    return { totalBytes: null, files: [] };
  }
}

/**
 * Tiny glob matcher supporting `*`, `**` and `?`, which is what `--include`
 * accepts for the download CLIs.
 * @param {string} pattern
 * @param {string} target
 * @returns {boolean}
 */
export function globMatch(pattern, target) {
  if (pattern.length === 0) return true;
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
    .replace(/\*\*/gu, '\u0000')
    .replace(/\*/gu, '[^/]*')
    .replace(/\u0000/gu, '.*')
    .replace(/\?/gu, '[^/]');
  try {
    return new RegExp(`^${escaped}$`, 'u').test(target);
  } catch {
    return target.includes(pattern);
  }
}

/**
 * Build the argv for the selected download transport.
 * @param {{
 *   source: string,
 *   repoId: string,
 *   revision?: string,
 *   include?: string,
 *   localDir: string,
 *   method: string,
 *   tooling: Awaited<ReturnType<typeof detectDownloadTooling>>,
 *   config: any
 * }} options
 * @returns {{ argv: string[] | null, error?: string }}
 */
export function buildDownloadArgv(options) {
  const { method, repoId, revision, include, localDir, tooling, source } = options;
  const revisionArgs = revision !== undefined && revision.length > 0 ? [revision] : [];
  if (method === 'hf-cli') {
    const cli = tooling.hf.cli;
    if (cli === null) return { argv: null, error: 'hf CLI missing' };
    const argv = [cli, 'download', repoId, '--local-dir', localDir];
    if (revisionArgs.length > 0) argv.push('--revision', revisionArgs[0]);
    if (include !== undefined && include.length > 0) argv.push('--include', include);
    return { argv };
  }
  if (method === 'hf-sdk') {
    const python = tooling.hf.python;
    if (python === null) return { argv: null, error: 'python missing' };
    const script = [
      'import sys',
      'from huggingface_hub import snapshot_download',
      'patterns = sys.argv[4].split(";") if sys.argv[4] else None',
      'snapshot_download(repo_id=sys.argv[1], local_dir=sys.argv[2], revision=(sys.argv[3] or None), allow_patterns=patterns)'
    ].join('; ');
    return { argv: [python, '-c', script, repoId, localDir, revision ?? '', include ?? ''] };
  }
  if (method === 'modelscope-cli') {
    const cli = tooling.modelscope.cli;
    if (cli === null) return { argv: null, error: 'modelscope CLI missing' };
    const argv = tooling.modelscope.cliKind === 'ms'
      ? [cli, 'download', repoId, '--local_dir', localDir]
      : [cli, 'download', '--model', repoId, '--local_dir', localDir];
    if (revisionArgs.length > 0) argv.push('--revision', revisionArgs[0]);
    if (include !== undefined && include.length > 0) argv.push('--include', include);
    return { argv };
  }
  if (method === 'modelscope-sdk') {
    const python = tooling.modelscope.python;
    if (python === null) return { argv: null, error: 'python missing' };
    const script = [
      'import sys',
      'try:',
      '    from modelscope import snapshot_download',
      'except Exception:',
      '    from modelscope.hub.snapshot_download import snapshot_download',
      'patterns = sys.argv[4].split(";") if sys.argv[4] else None',
      'snapshot_download(sys.argv[1], local_dir=sys.argv[2], revision=(sys.argv[3] or None), allow_patterns=patterns)'
    ].join('\n');
    return { argv: [python, '-c', script, repoId, localDir, revision ?? '', include ?? ''] };
  }
  return { argv: null, error: `unsupported transport for ${source}` };
}

/**
 * Pick the method for a source according to `downloadMethod` and what was
 * verified in this environment.
 * @param {string} source
 * @param {string} preference
 * @param {Awaited<ReturnType<typeof detectDownloadTooling>>} tooling
 * @returns {{ method: string | null, reason?: string }}
 */
export function chooseMethod(source, preference, tooling) {
  const family = source === 'modelscope' ? 'modelscope' : 'huggingface';
  const cli = family === 'modelscope' ? tooling.modelscope.cli : tooling.hf.cli;
  const sdk = family === 'modelscope' ? tooling.modelscope.sdk : tooling.hf.sdk;
  const cliMethod = family === 'modelscope' ? 'modelscope-cli' : 'hf-cli';
  const sdkMethod = family === 'modelscope' ? 'modelscope-sdk' : 'hf-sdk';
  if (preference === 'cli') {
    if (cli !== null) return { method: cliMethod };
    if (sdk) return { method: sdkMethod };
    return { method: null, reason: 'no CLI or SDK' };
  }
  if (preference === 'sdk') {
    if (sdk) return { method: sdkMethod };
    if (cli !== null) return { method: cliMethod };
    return { method: null, reason: 'no CLI or SDK' };
  }
  if (cli !== null) return { method: cliMethod };
  if (sdk) return { method: sdkMethod };
  return { method: null, reason: 'no CLI or SDK' };
}

/**
 * @param {number} bytes
 * @param {number | null} total
 * @param {number} previousBytes
 * @param {number} previousAt
 * @returns {{ speedBps: number | null, etaSeconds: number | null }}
 */
function computeProgress(bytes, total, previousBytes, previousAt) {
  const deltaMs = Date.now() - previousAt;
  if (deltaMs <= 0 || bytes < previousBytes) return { speedBps: null, etaSeconds: null };
  const speed = ((bytes - previousBytes) / deltaMs) * 1000;
  const eta = total !== null && total > bytes && speed > 0 ? (total - bytes) / speed : null;
  return { speedBps: speed > 0 ? speed : null, etaSeconds: eta };
}

/**
 * @typedef {object} DownloadTask
 * @property {string} id
 * @property {string} repoId
 * @property {string} source
 * @property {string} localDir
 * @property {string | null} revision
 * @property {string | null} include
 * @property {DownloadState} state
 * @property {string | null} method
 * @property {number} bytes
 * @property {number | null} totalBytes
 * @property {number | null} speedBps
 * @property {number | null} etaSeconds
 * @property {string} startedAt
 * @property {string | null} finishedAt
 * @property {string | null} error
 * @property {string[]} files
 */

export class DownloadManager {
  /**
   * @param {{
   *   config: any,
   *   logger?: any,
   *   journalFile?: string,
   *   onUpdate?: (task: DownloadTask) => void,
   *   proxy?: any
   * }} options
   */
  constructor(options) {
    this.config = options.config;
    this.logger = options.logger;
    this.journalFile = options.journalFile ?? downloadsPath();
    this.onUpdate = options.onUpdate;
    /** @type {Map<string, DownloadTask & { child: import('node:child_process').ChildProcess | null, promise: Promise<DownloadTask>, cancelled: boolean, stderr: string }>} */
    this.tasks = new Map();
    this.ready = this.#loadJournal();
    /** @type {Map<string, any>} */
    this.extra = new Map();
    this.lastPersist = 0;
  }

  async #loadJournal() {
    const { value } = await readJson(this.journalFile, null);
    if (value === null || typeof value !== 'object' || !Array.isArray(value.tasks)) return;
    for (const entry of value.tasks.slice(-50)) {
      if (entry === null || typeof entry !== 'object' || typeof entry.id !== 'string') continue;
      if (entry.state === 'running' || entry.state === 'queued') {
        entry.state = 'interrupted';
        entry.error = entry.error ?? 'interrupted by a previous process exit';
        entry.finishedAt = entry.finishedAt ?? isoNow();
        entry.speedBps = null;
        entry.etaSeconds = null;
        this.logger?.warn?.(`[open-model] download ${entry.id} was interrupted before the last shutdown`);
      }
      this.tasks.set(entry.id, {
        ...entry,
        child: null,
        promise: Promise.resolve(entry),
        cancelled: false,
        stderr: ''
      });
    }
  }

  /**
   * Start a download; resolves when the download itself finishes. Callers that
   * want background behavior should not await this promise.
   * @param {{
   *   repoId: string,
   *   source: string,
   *   revision?: string,
   *   include?: string,
   *   localDir: string,
   *   signal?: AbortSignal
   * }} request
   * @returns {Promise<DownloadTask>}
   */
  async start(request) {
    await this.ready;
    const tooling = await detectDownloadTooling();
    const chosen = chooseMethod(request.source, this.config.downloadMethod, tooling);
    if (chosen.method === null) {
      throw new Error('no download CLI or Python SDK is available for this source');
    }
    const expected = await expectedDownloadBytes({
      repoId: request.repoId,
      source: request.source,
      include: request.include,
      config: this.config,
      signal: request.signal,
      proxy: this.config.proxy
    });
    const id = `dl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const startedAt = isoNow();
    /** @type {DownloadTask & { child: any, promise: any, cancelled: boolean, stderr: string }} */
    const task = {
      id,
      repoId: request.repoId,
      source: request.source,
      localDir: path.resolve(request.localDir),
      revision: request.revision ?? null,
      include: request.include ?? null,
      state: 'queued',
      method: chosen.method,
      bytes: 0,
      totalBytes: expected.totalBytes,
      speedBps: null,
      etaSeconds: null,
      startedAt,
      finishedAt: null,
      error: null,
      files: [],
      child: null,
      promise: Promise.resolve(null),
      cancelled: false,
      stderr: ''
    };
    this.tasks.set(id, task);
    task.promise = this.#run(task, tooling, request.signal);
    task.promise.catch(() => {});
    return task;
  }

  /**
   * @param {any} task
   * @param {Awaited<ReturnType<typeof detectDownloadTooling>>} tooling
   * @param {AbortSignal | undefined} signal
   */
  async #run(task, tooling, signal) {
    task.state = 'running';
    this.#publish(task);
    const built = buildDownloadArgv({
      source: task.source,
      repoId: task.repoId,
      revision: task.revision ?? undefined,
      include: task.include ?? undefined,
      localDir: task.localDir,
      method: task.method,
      tooling,
      config: this.config
    });
    if (built.argv === null) {
      task.state = 'failed';
      task.error = built.error ?? 'transport unavailable';
      task.finishedAt = isoNow();
      this.#publish(task);
      return task;
    }
    await ensureDir(task.localDir);
    const env = buildChildEnv(this.config, {
      source: task.source,
      endpoint: endpointFor(task.source, this.config)
    });

    /** @type {import('node:child_process').ChildProcess} */
    const child = spawn(built.argv[0], built.argv.slice(1), {
      cwd: task.localDir,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    task.child = child;
    const onAbort = () => {
      task.cancelled = true;
      killChild(child);
    };
    if (signal !== undefined) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    let previousBytes = 0;
    let previousAt = Date.now();
    const baseline = await treeSize(task.localDir, { maxEntries: 100_000 });
    previousBytes = baseline.bytes;
    task.bytes = baseline.bytes;
    const timer = setInterval(() => {
      void (async () => {
        const size = await treeSize(task.localDir, { maxEntries: 100_000 });
        task.bytes = size.bytes;
        const progress = computeProgress(task.bytes, task.totalBytes, previousBytes, previousAt);
        task.speedBps = progress.speedBps;
        task.etaSeconds = progress.etaSeconds;
        previousBytes = task.bytes;
        previousAt = Date.now();
        this.#publish(task);
      })();
    }, POLL_MS);
    timer.unref?.();

    const exit = await new Promise((resolve) => {
      child.once('error', (error) => {
        task.stderr = `${task.stderr}\n${error.message}`.slice(-8_000);
        resolve({ code: null, signal: null });
      });
      child.once('close', (code, exitSignal) => resolve({ code, signal: exitSignal }));
      child.stdout?.on('data', (chunk) => {
        task.stderr = `${task.stderr}${chunk.toString('utf8')}`.slice(-8_000);
      });
      child.stderr?.on('data', (chunk) => {
        task.stderr = `${task.stderr}${chunk.toString('utf8')}`.slice(-8_000);
      });
    });
    clearInterval(timer);
    signal?.removeEventListener('abort', onAbort);
    task.child = null;

    const finalSize = await treeSize(task.localDir, { maxEntries: 100_000 });
    task.bytes = finalSize.bytes;
    task.speedBps = null;
    task.etaSeconds = null;
    task.finishedAt = isoNow();
    task.files = await listDownloadedFiles(task.localDir);

    if (task.cancelled) {
      task.state = 'cancelled';
    } else if (typeof exit.code === 'number' && exit.code === 0) {
      task.state = 'completed';
    } else if (exit.code === 0) {
      task.state = 'completed';
    } else {
      task.state = 'failed';
      task.error = truncate(task.stderr.trim() || `exit code ${String(exit.code)}`, 600);
    }
    this.#publish(task, true);
    if (task.state === 'completed') {
      this.logger?.info?.(`[open-model] download completed: ${task.repoId} (${task.bytes} bytes)`);
    } else if (task.state === 'failed') {
      this.logger?.warn?.(`[open-model] download failed: ${task.repoId}: ${task.error}`);
    }
    return task;
  }

  /**
   * Wait for one task.
   * @param {string} id
   * @returns {Promise<DownloadTask | undefined>}
   */
  async wait(id) {
    const task = this.tasks.get(id);
    if (task === undefined) return undefined;
    await task.promise;
    return task;
  }

  /** @returns {DownloadTask[]} */
  list() {
    return [...this.tasks.values()]
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
      .map((task) => this.#snapshot(task));
  }

  /**
   * @param {string} id
   * @returns {DownloadTask | undefined}
   */
  get(id) {
    const task = this.tasks.get(id);
    return task === undefined ? undefined : this.#snapshot(task);
  }

  /**
   * Cancel one active download; partial files stay on disk.
   * @param {string} id
   * @returns {boolean}
   */
  cancel(id) {
    const task = this.tasks.get(id);
    if (task === undefined) return false;
    if (task.state !== 'running' && task.state !== 'queued') return false;
    task.cancelled = true;
    if (task.child !== null) killChild(task.child);
    return true;
  }

  /** Kill every child and stop polling; used by the plugin disposer. */
  dispose() {
    for (const task of this.tasks.values()) {
      if (task.child !== null) killChild(task.child);
    }
  }

  /**
   * @param {any} task
   * @returns {DownloadTask}
   */
  #snapshot(task) {
    const {
      child, promise, cancelled, stderr, ...snapshot
    } = task;
    void child;
    void promise;
    void cancelled;
    void stderr;
    return snapshot;
  }

  /**
   * Persist and broadcast one task update.
   * @param {any} task
   * @param {boolean} [force]
   */
  #publish(task, force = false) {
    const snapshot = this.#snapshot(task);
    try {
      this.onUpdate?.(snapshot);
    } catch {
      // A listener must never break a download.
    }
    if (force) this.lastPersist = 0;
    void this.#persist();
  }

  async #persist() {
    const now = Date.now();
    const last = this.lastPersist ?? 0;
    if (now - last < 3_000) return;
    this.lastPersist = now;
    const tasks = this.list().slice(-20);
    try {
      await writeJsonAtomic(this.journalFile, { version: JOURNAL_VERSION, updatedAt: isoNow(), tasks });
    } catch {
      // The journal is diagnostic; a write failure must not fail a download.
    }
  }
}

/**
 * List files created by a download, bounded for tool output.
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listDownloadedFiles(dir) {
  /** @type {string[]} */
  const out = [];
  const stack = [dir];
  let visited = 0;
  while (stack.length > 0 && out.length < 200 && visited < 20_000) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      visited += 1;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && !entry.name.endsWith('.incomplete')) {
        out.push(path.relative(dir, full));
      }
    }
  }
  return out;
}

/**
 * Format a progress line for tool output.
 * @param {DownloadTask} task
 * @param {(key: string, vars?: Record<string, string | number>) => string} tt
 * @returns {string}
 */
export function describeProgress(task, tt) {
  const total = task.totalBytes === null ? '' : tt('download.status.total', { total: formatBytesLocal(task.totalBytes) });
  return tt('download.status.line', {
    id: task.id,
    repoId: task.repoId,
    source: task.source,
    state: tt(`state.${task.state}`),
    bytes: formatBytesLocal(task.bytes),
    total,
    speed: formatSpeed(task.speedBps),
    eta: task.etaSeconds === null ? '—' : `${Math.round(task.etaSeconds)}s`
  });
}

/**
 * Local byte formatter kept in this module to avoid a circular import.
 * @param {number | null} bytes
 * @returns {string}
 */
function formatBytesLocal(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 100 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

/** Test seam: clear the cached tooling detection. */
export function resetToolingCache() {
  toolingCache = null;
}
