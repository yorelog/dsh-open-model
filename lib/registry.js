/**
 * Local model registry: `${DSH_HOME}/model-hub/registry.json`.
 *
 * The registry is the single source of truth the prompt section, the loader
 * and the idle reaper read. It is kept in memory for synchronous prompt reads
 * and persisted with an atomic temp-file + rename on every mutation. A corrupt
 * file resets to an empty registry with a warning instead of blocking plugin
 * activation.
 * @module dsh-open-model/lib/registry
 */

import { KeyedMutex } from './locks.js';
import { isProcessAlive } from './process.js';
import { readJson, registryPath, writeJsonAtomic } from './paths.js';
import { modelIdFor, samePath } from './util.js';

/** @typedef {'gguf' | 'safetensors' | 'mlx'} ModelFormat */

/**
 * @typedef {object} ModelEntry
 * @property {string} id
 * @property {string} displayName
 * @property {string} source
 * @property {string | null} repoId
 * @property {ModelFormat} format
 * @property {string} quant
 * @property {string} path
 * @property {number} sizeBytes
 * @property {'auto' | 'llama-server' | 'mlxcel-server'} runtimePreference
 * @property {string | null} lastUsedAt
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {boolean} loaded
 * @property {string | null} runtime
 * @property {number | null} pid
 * @property {number | null} port
 * @property {string | null} baseUrl
 * @property {string | null} startedAt
 * @property {boolean} ownedByPlugin
 */

/**
 * Coerce one stored record into the current shape.
 * @param {any} raw
 * @returns {ModelEntry | null}
 */
function normalizeEntry(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  const path = typeof raw.path === 'string' ? raw.path : '';
  if (path.length === 0) return null;
  const id = typeof raw.id === 'string' && raw.id.length > 0
    ? raw.id
    : modelIdFor(String(raw.displayName ?? raw.id ?? path), path);
  const format = raw.format === 'gguf' || raw.format === 'safetensors' || raw.format === 'mlx' ? raw.format : 'gguf';
  const runtimePreference = raw.runtimePreference === 'llama-server' || raw.runtimePreference === 'mlxcel-server'
    ? raw.runtimePreference
    : 'auto';
  const loaded = raw.loaded === true && Number.isInteger(raw.pid);
  return {
    id,
    displayName: typeof raw.displayName === 'string' && raw.displayName.length > 0
      ? raw.displayName
      : id,
    source: typeof raw.source === 'string' && raw.source.length > 0 ? raw.source : 'local',
    repoId: typeof raw.repoId === 'string' && raw.repoId.length > 0 ? raw.repoId : null,
    format,
    quant: typeof raw.quant === 'string' && raw.quant.length > 0 ? raw.quant : 'unknown',
    path,
    sizeBytes: Number.isFinite(raw.sizeBytes) ? Math.max(0, Math.trunc(raw.sizeBytes)) : 0,
    runtimePreference,
    lastUsedAt: typeof raw.lastUsedAt === 'string' ? raw.lastUsedAt : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    loaded,
    runtime: loaded && typeof raw.runtime === 'string' ? raw.runtime : (typeof raw.runtime === 'string' ? raw.runtime : null),
    pid: loaded ? raw.pid : null,
    port: loaded && Number.isInteger(raw.port) ? raw.port : null,
    baseUrl: loaded && typeof raw.baseUrl === 'string' ? raw.baseUrl : null,
    startedAt: loaded && typeof raw.startedAt === 'string' ? raw.startedAt : null,
    ownedByPlugin: raw.ownedByPlugin === true
  };
}

export class ModelRegistry {
  /**
   * @param {{ file?: string, logger?: any }} [options]
   */
  constructor(options = {}) {
    this.file = options.file ?? registryPath();
    this.logger = options.logger;
    this.mutex = new KeyedMutex();
    /** @type {{ version: number, models: Record<string, ModelEntry>, updatedAt: string | null }} */
    this.doc = { version: 1, models: {}, updatedAt: null };
    /** @type {Promise<void> | null} */
    this.ready = null;
    /** Whether the first disk read completed; the prompt section stays silent until it has. */
    this.loadedOnce = false;
  }

  /** @returns {boolean} */
  isLoaded() {
    return this.loadedOnce;
  }

  /** Load from disk once; corrupt input becomes an empty registry. */
  async load() {
    if (this.ready !== null) return this.ready;
    this.ready = this.#load().finally(() => {
      this.loadedOnce = true;
    });
    return this.ready;
  }

  async #load() {
    const { value, error } = await readJson(this.file, null);
    if (error !== null) {
      this.logger?.warn?.(`[dsh-open-model] registry unreadable, starting empty: ${error.message}`);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    const models = value.models !== null && typeof value.models === 'object' ? value.models : {};
    /** @type {Record<string, ModelEntry>} */
    const normalized = {};
    for (const [id, entry] of Object.entries(models)) {
      const next = normalizeEntry(entry);
      if (next !== null) normalized[next.id === id ? id : next.id] = next;
    }
    this.doc = {
      version: 1,
      models: normalized,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null
    };
    await this.#reconcileLiveness();
  }

  /** Clear running state whose process no longer exists (crash, reboot, reload). */
  async #reconcileLiveness() {
    let changed = false;
    for (const entry of Object.values(this.doc.models)) {
      if (!entry.loaded) continue;
      if (entry.pid === null || !isProcessAlive(entry.pid)) {
        entry.loaded = false;
        entry.pid = null;
        entry.port = null;
        entry.baseUrl = null;
        entry.startedAt = null;
        entry.runtime = null;
        entry.ownedByPlugin = false;
        changed = true;
      }
    }
    if (changed) await this.#persist();
  }

  /** @returns {Record<string, ModelEntry>} */
  snapshot() {
    return this.doc.models;
  }

  /** @returns {ModelEntry[]} */
  list() {
    return Object.values(this.doc.models).sort((left, right) => left.id.localeCompare(right.id));
  }

  /**
   * @param {string} id
   * @returns {ModelEntry | undefined}
   */
  get(id) {
    if (typeof id !== 'string') return undefined;
    if (this.doc.models[id] !== undefined) return this.doc.models[id];
    const wanted = id.trim().toLowerCase();
    return this.list().find((entry) => entry.id.toLowerCase() === wanted);
  }

  /**
   * @param {string} target path or repo id
   * @returns {ModelEntry | undefined}
   */
  findByPath(target) {
    return this.list().find((entry) => samePath(entry.path, target));
  }

  /**
   * @param {string} repoId
   * @returns {ModelEntry | undefined}
   */
  findByRepo(repoId) {
    const wanted = String(repoId ?? '').trim().toLowerCase();
    if (wanted.length === 0) return undefined;
    return this.list().find((entry) => (entry.repoId ?? '').toLowerCase() === wanted);
  }

  /**
   * Insert or refresh one entry.
   * @param {Partial<ModelEntry> & { path: string, displayName: string }} input
   * @returns {Promise<{ entry: ModelEntry, created: boolean }>}
   */
  async register(input) {
    return this.mutex.run('registry', async () => {
      const existing = this.findByPath(input.path);
      const now = new Date().toISOString();
      const id = input.id ?? existing?.id ?? modelIdFor(input.displayName, input.path);
      const entry = normalizeEntry({
        ...existing,
        ...input,
        id,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        loaded: existing?.loaded ?? false,
        runtime: existing?.runtime ?? null,
        pid: existing?.pid ?? null,
        port: existing?.port ?? null,
        baseUrl: existing?.baseUrl ?? null,
        startedAt: existing?.startedAt ?? null,
        ownedByPlugin: existing?.ownedByPlugin ?? false
      });
      if (entry === null) throw new Error('invalid registry entry');
      this.doc.models[id] = entry;
      await this.#persist();
      return { entry, created: existing === undefined };
    });
  }

  /**
   * Patch one registered model.
   * @param {string} id
   * @param {Partial<ModelEntry>} patch
   * @returns {Promise<ModelEntry | undefined>}
   */
  async update(id, patch) {
    return this.mutex.run('registry', async () => {
      const existing = this.get(id);
      if (existing === undefined) return undefined;
      const entry = normalizeEntry({ ...existing, ...patch, id: existing.id, updatedAt: new Date().toISOString() });
      if (entry === null) return undefined;
      this.doc.models[entry.id] = entry;
      await this.#persist();
      return entry;
    });
  }

  /**
   * Remove one entry.
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async remove(id) {
    return this.mutex.run('registry', async () => {
      const existing = this.get(id);
      if (existing === undefined) return false;
      delete this.doc.models[existing.id];
      await this.#persist();
      return true;
    });
  }

  /**
   * Record the last request time synchronously and persist best-effort.
   * @param {string} id
   * @returns {string}
   */
  touch(id) {
    const entry = this.get(id);
    const now = new Date().toISOString();
    if (entry !== undefined) {
      entry.lastUsedAt = now;
      entry.updatedAt = now;
      void this.#persist().catch(() => {});
    }
    return now;
  }

  async #persist() {
    this.doc.updatedAt = new Date().toISOString();
    try {
      await writeJsonAtomic(this.file, this.doc);
    } catch (error) {
      this.logger?.warn?.(`[dsh-open-model] registry write failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
