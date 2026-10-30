/**
 * Inference lifecycle: one server process per registered model, an OpenAI
 * compatible call path, and an idle reaper that frees memory again.
 *
 * Concurrency: every mutation of one model's runtime goes through the keyed
 * mutex, so two concurrent model_load calls cannot spawn the same model twice.
 * Idle release and unload share the same path, which is what makes the reaper
 * safe to run on a timer.
 * @module @local/open-model/lib/server
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { buildChildEnv } from './config.js';
import { KeyedMutex } from './locks.js';
import { httpJson, httpRequest } from './net.js';
import {
  findFreePort, isAppleSilicon, isProcessAlive, killChild, stopProcess
} from './process.js';
import { discoverRuntimes } from './runtime.js';
import { isoNow, sleep } from './util.js';

/**
 * @param {any} entry
 * @returns {'llama-server' | 'mlxcel-server' | null}
 */
export function runtimeFor(entry) {
  if (entry === null || typeof entry !== 'object') return null;
  if (entry.runtimePreference === 'mlxcel-server') return isAppleSilicon() ? 'mlxcel-server' : null;
  if (entry.runtimePreference === 'llama-server') return 'llama-server';
  if (entry.format === 'gguf') return 'llama-server';
  if (entry.format === 'mlx' || entry.format === 'safetensors') {
    return isAppleSilicon() ? 'mlxcel-server' : null;
  }
  return null;
}

/**
 * @param {string} host
 * @returns {string}
 */
function connectHost(host) {
  return host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
}

/**
 * @param {unknown} content
 * @returns {string}
 */
function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part !== null && typeof part === 'object' && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('');
  }
  return '';
}

export class InferenceSupervisor {
  /**
   * @param {{ config: any, registry: any, logger?: any }} options
   */
  constructor(options) {
    this.config = options.config;
    this.registry = options.registry;
    this.logger = options.logger;
    this.mutex = new KeyedMutex();
    /** @type {Map<string, { child: import('node:child_process').ChildProcess | null, pid: number, port: number, output: string }>} */
    this.children = new Map();
    this.disposed = false;
  }

  /**
   * @param {any} entry
   * @returns {string}
   */
  #baseUrl(entry) {
    if (typeof entry.baseUrl === 'string' && entry.baseUrl.length > 0) return entry.baseUrl;
    return `http://${connectHost(this.config.serverHost)}:${entry.port}`;
  }

  /**
   * One health probe, no retry.
   * @param {any} entry
   * @param {number} timeoutMs
   * @returns {Promise<boolean>}
   */
  async #healthOnce(entry, timeoutMs) {
    if (entry.port === null || entry.port === undefined) return false;
    const base = this.#baseUrl(entry);
    for (const route of ['/health', '/v1/models']) {
      try {
        const response = await httpRequest(`${base}${route}`, { timeoutMs, proxy: null });
        if (response.status === 200) return true;
      } catch {
        // Try the next route.
      }
    }
    return false;
  }

  /**
   * Poll until the server is healthy or the process dies.
   * @param {any} entry
   * @param {number} timeoutMs
   * @param {{ pid: number, child: import('node:child_process').ChildProcess | null, output: () => string, exitCode: () => number | null }} processInfo
   * @returns {Promise<{ ok: boolean, reason?: 'timeout'|'exited', output?: string, code?: number | null }>}
   */
  async #waitForHealth(entry, timeoutMs, processInfo) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!isProcessAlive(processInfo.pid)) {
        return { ok: false, reason: 'exited', code: processInfo.exitCode(), output: processInfo.output() };
      }
      if (await this.#healthOnce(entry, 2_000)) return { ok: true };
      await sleep(500);
    }
    return { ok: false, reason: 'timeout', code: processInfo.exitCode(), output: processInfo.output() };
  }

  /**
   * Start (or reuse) the runtime for one registered model.
   * @param {string} modelId
   * @param {{ port?: number, timeoutMs?: number, signal?: AbortSignal }} [options]
   * @returns {Promise<any>}
   */
  async load(modelId, options = {}) {
    if (this.disposed) throw new Error('inference supervisor is disposed');
    const entry = this.registry.get(modelId);
    if (entry === undefined) throw new Error('unknown model');
    return this.mutex.run(`model:${entry.id}`, async () => {
      const current = this.registry.get(entry.id) ?? entry;
      if (current.loaded === true && Number.isInteger(current.pid)) {
        const tracked = this.children.get(current.id);
        if (isProcessAlive(current.pid) && await this.#healthOnce(current, 2_500)) {
          this.registry.touch(current.id);
          return {
            modelId: current.id,
            runtime: current.runtime,
            pid: current.pid,
            port: current.port,
            baseUrl: this.#baseUrl(current),
            startedAt: current.startedAt,
            alreadyLoaded: true,
            adopted: tracked === undefined
          };
        }
        this.logger?.warn?.(`[open-model] clearing stale runtime for ${current.id} (pid ${current.pid})`);
        this.children.delete(current.id);
        await this.registry.update(current.id, {
          loaded: false, pid: null, port: null, baseUrl: null, startedAt: null, runtime: null, ownedByPlugin: false
        });
      }

      const runtime = runtimeFor(current);
      if (runtime === null) {
        const error = new Error('unsupported runtime');
        error.code = 'UNSUPPORTED_RUNTIME';
        throw error;
      }
      const discovery = await discoverRuntimes(this.config);
      const found = runtime === 'llama-server' ? discovery.llama : discovery.mlxcel;
      if (!found.available || typeof found.path !== 'string') {
        const error = new Error('runtime not installed');
        error.code = 'RUNTIME_MISSING';
        error.runtime = runtime;
        throw error;
      }

      const host = this.config.serverHost;
      const port = Number.isInteger(options.port) && options.port > 0
        ? options.port
        : await findFreePort(connectHost(host));
      const extra = runtime === 'llama-server' ? this.config.llamaArgs : this.config.mlxcelArgs;
      const argv = [found.path, '-m', current.path, '--host', host, '--port', String(port), ...extra];
      const env = buildChildEnv(this.config, {});
      const cwd = path.dirname(current.path);

      const startedAt = isoNow();
      /** @type {any} */
      const child = spawn(argv[0], argv.slice(1), {
        cwd,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      /** @type {any} */
      const tracked = { child, pid: child.pid ?? 0, port, output: '', exitCode: null };
      child.once('exit', (code) => {
        tracked.exitCode = code;
      });
      const appendOutput = (chunk) => {
        tracked.output = `${tracked.output}${chunk.toString('utf8')}`;
        if (tracked.output.length > 8_000) tracked.output = tracked.output.slice(-8_000);
      };
      child.stdout?.on('data', appendOutput);
      child.stderr?.on('data', appendOutput);
      this.children.set(current.id, tracked);

      await this.registry.update(current.id, {
        loaded: true,
        pid: tracked.pid,
        port,
        baseUrl: `http://${connectHost(host)}:${port}`,
        startedAt,
        runtime,
        ownedByPlugin: true,
        lastUsedAt: startedAt
      });

      const health = await this.#waitForHealth(
        { ...current, port, baseUrl: `http://${connectHost(host)}:${port}` },
        options.timeoutMs ?? this.config.loadTimeoutMs,
        { pid: tracked.pid, child, output: () => tracked.output, exitCode: () => tracked.exitCode }
      );
      if (!health.ok) {
        await this.#stopTracked(current.id, tracked, this.config.stopGraceMs);
        await this.registry.update(current.id, {
          loaded: false, pid: null, port: null, baseUrl: null, startedAt: null, runtime: null, ownedByPlugin: false
        });
        const error = new Error(health.reason === 'timeout' ? 'startup timeout' : 'runtime exited during startup');
        error.code = health.reason === 'timeout' ? 'LOAD_TIMEOUT' : 'LOAD_EXITED';
        error.exitCode = health.code ?? null;
        error.output = health.output ?? '';
        throw error;
      }

      this.registry.touch(current.id);
      return {
        modelId: current.id,
        runtime,
        pid: tracked.pid,
        port,
        baseUrl: `http://${connectHost(host)}:${port}`,
        startedAt,
        version: found.version,
        alreadyLoaded: false,
        adopted: false
      };
    });
  }

  /**
   * Stop one tracked process.
   * @param {string} modelId
   * @param {any} tracked
   * @param {number} graceMs
   * @returns {Promise<{ graceful: boolean, forced: boolean }>}
   */
  async #stopTracked(modelId, tracked, graceMs) {
    this.children.delete(modelId);
    return stopProcess(tracked.child ?? null, tracked.pid, graceMs);
  }

  /**
   * Stop one loaded model.
   * @param {string} modelId
   * @param {{ force?: boolean }} [options]
   * @returns {Promise<any>}
   */
  async unload(modelId, options = {}) {
    const entry = this.registry.get(modelId);
    if (entry === undefined) return { modelId, unknown: true, stopped: false };
    return this.mutex.run(`model:${entry.id}`, async () => {
      const current = this.registry.get(entry.id) ?? entry;
      const tracked = this.children.get(current.id);
      const pid = Number.isInteger(current.pid) ? current.pid : tracked?.pid;
      if (pid === undefined || !Number.isInteger(pid) || !isProcessAlive(pid)) {
        this.children.delete(current.id);
        if (current.loaded) {
          await this.registry.update(current.id, {
            loaded: false, pid: null, port: null, baseUrl: null, startedAt: null, runtime: null, ownedByPlugin: false
          });
        }
        return { modelId: current.id, stopped: false, wasLoaded: false, pid: null, port: current.port };
      }
      const graceMs = options.force === true ? 0 : this.config.stopGraceMs;
      const result = await this.#stopTracked(current.id, tracked ?? { child: null, pid, port: current.port }, graceMs);
      await this.registry.update(current.id, {
        loaded: false,
        pid: null,
        port: null,
        baseUrl: null,
        startedAt: null,
        runtime: null,
        ownedByPlugin: false
      });
      return {
        modelId: current.id,
        stopped: true,
        wasLoaded: true,
        pid,
        port: current.port,
        graceful: result.graceful,
        forced: result.forced
      };
    });
  }

  /**
   * OpenAI-compatible inference call. Refreshes lastUsedAt before and after the
   * request so the idle reaper cannot stop a server mid-request.
   * @param {string} modelId
   * @param {{
   *   messages?: Array<{ role: string, content: string }>,
   *   prompt?: string,
   *   system?: string,
   *   temperature?: number,
   *   maxTokens?: number,
   *   timeoutMs?: number,
   *   signal?: AbortSignal
   * }} request
   * @returns {Promise<any>}
   */
  async infer(modelId, request) {
    const entry = this.registry.get(modelId);
    if (entry === undefined) throw new Error('unknown model');
    if (entry.loaded !== true || !Number.isInteger(entry.port)) {
      const error = new Error('model not loaded');
      error.code = 'NOT_LOADED';
      throw error;
    }
    if (!(await this.#healthOnce(entry, 3_000))) {
      const tracked = this.children.get(entry.id);
      if (tracked !== undefined) await this.#stopTracked(entry.id, tracked, 0);
      await this.registry.update(entry.id, {
        loaded: false, pid: null, port: null, baseUrl: null, startedAt: null, runtime: null, ownedByPlugin: false
      });
      const error = new Error('server unreachable');
      error.code = 'SERVER_DEAD';
      throw error;
    }
    const startedAt = Date.now();
    this.registry.touch(entry.id);
    const base = this.#baseUrl(entry);
    const timeoutMs = request.timeoutMs ?? this.config.requestTimeoutMs;

    let body;
    let url;
    if (typeof request.prompt === 'string' && request.prompt.length > 0) {
      url = `${base}/v1/completions`;
      body = {
        model: entry.id,
        prompt: request.prompt,
        temperature: request.temperature ?? 0.7,
        ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {})
      };
    } else {
      const messages = Array.isArray(request.messages) ? [...request.messages] : [];
      if (typeof request.system === 'string' && request.system.length > 0) {
        messages.unshift({ role: 'system', content: request.system });
      }
      url = `${base}/v1/chat/completions`;
      body = {
        model: entry.id,
        messages,
        temperature: request.temperature ?? 0.7,
        ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {})
      };
    }
    const response = await httpJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs,
      signal: request.signal,
      proxy: null
    });
    const elapsedMs = Date.now() - startedAt;
    this.registry.touch(entry.id);

    const choice = Array.isArray(response.json?.choices) ? response.json.choices[0] : undefined;
    const content = typeof request.prompt === 'string' && request.prompt.length > 0
      ? contentToText(choice?.text)
      : contentToText(choice?.message?.content);
    const usage = response.json?.usage ?? {};
    return {
      content,
      finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
      usage: {
        promptTokens: Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : null,
        completionTokens: Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : null,
        totalTokens: Number.isFinite(usage.total_tokens) ? usage.total_tokens : null
      },
      elapsedMs,
      baseUrl: base
    };
  }

  /**
   * Release every model idle for at least `idleTimeoutMs`.
   * @param {number} [now]
   * @returns {Promise<Array<{ modelId: string, runtime: string | null, port: number | null, idleMs: number }>>}
   */
  async reapIdle(now = Date.now()) {
    const idleTimeoutMs = this.config.idleTimeoutMs;
    const released = [];
    for (const entry of this.registry.list()) {
      if (entry.loaded !== true) continue;
      const last = Date.parse(entry.lastUsedAt ?? entry.startedAt ?? '') || 0;
      const idleMs = now - last;
      if (idleMs < idleTimeoutMs) continue;
      if (!isProcessAlive(entry.pid ?? 0)) {
        await this.registry.update(entry.id, {
          loaded: false, pid: null, port: null, baseUrl: null, startedAt: null, runtime: null, ownedByPlugin: false
        });
        continue;
      }
      try {
        const result = await this.unload(entry.id, { force: false });
        if (result.stopped === true) {
          released.push({
            modelId: entry.id,
            runtime: entry.runtime,
            port: entry.port,
            idleMs
          });
        }
      } catch (error) {
        this.logger?.warn?.(`[open-model] idle release failed for ${entry.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return released;
  }

  /**
   * Stop every child this instance owns. Called from the plugin disposer so a
   * hot reload never leaves orphaned servers behind.
   * @returns {Promise<void>}
   */
  async dispose() {
    this.disposed = true;
    for (const [modelId, tracked] of [...this.children.entries()]) {
      this.children.delete(modelId);
      if (tracked.child !== null) killChild(tracked.child);
      else if (isProcessAlive(tracked.pid)) {
        await stopProcess(null, tracked.pid, 0).catch(() => {});
      }
      const entry = this.registry.get(modelId);
      if (entry !== undefined && entry.loaded) {
        await this.registry.update(modelId, {
          loaded: false, pid: null, port: null, baseUrl: null, startedAt: null, runtime: null, ownedByPlugin: false
        }).catch(() => {});
      }
    }
  }
}
