/**
 * Durable paths and crash-safe JSON persistence.
 *
 * Everything user-owned lives under `${DSH_HOME}/model-hub/`, matching the
 * Harness convention; runtimes installed by this plugin live under
 * `${DSH_HOME}/runtimes/`. Writes use temp-file + rename so a crash never
 * leaves a half-written registry that would block plugin activation.
 * @module @local/open-model/lib/paths
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * The Harness home directory, honoring DSH_HOME.
 * @returns {string}
 */
export function dshHome() {
  const configured = process.env.DSH_HOME;
  if (typeof configured === 'string' && configured.trim().length > 0) return path.resolve(configured.trim());
  return path.join(os.homedir(), '.dsh');
}

/**
 * @returns {string} `${DSH_HOME}/model-hub`
 */
export function hubDir() {
  return path.join(dshHome(), 'model-hub');
}

/**
 * @param {string} name
 * @returns {string} a file inside the hub directory
 */
export function hubFile(name) {
  return path.join(hubDir(), name);
}

/** @returns {string} the model registry path */
export function registryPath() {
  return hubFile('registry.json');
}

/** @returns {string} the runtime discovery cache path */
export function runtimeCachePath() {
  return hubFile('runtimes.json');
}

/** @returns {string} the persisted hub state path */
export function statePath() {
  return hubFile('state.json');
}

/** @returns {string} the download journal path */
export function downloadsPath() {
  return hubFile('downloads.json');
}

/** @returns {string} `${DSH_HOME}/runtimes` */
export function runtimesRoot() {
  return path.join(dshHome(), 'runtimes');
}

/** @returns {string} the default model root, `${DSH_HOME}/models` */
export function defaultModelRoot() {
  return path.join(dshHome(), 'models');
}

/**
 * @param {string} dir
 * @returns {Promise<boolean>}
 */
export async function pathExists(dir) {
  try {
    await fs.access(dir);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} dir
 * @returns {Promise<void>}
 */
export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Tolerant JSON read: a missing or corrupt file yields the fallback instead of
 * failing plugin activation.
 * @template T
 * @param {string} file
 * @param {T} fallback
 * @returns {Promise<{ value: T, error: Error | null, missing: boolean }>}
 */
export async function readJson(file, fallback) {
  try {
    const text = await fs.readFile(file, 'utf8');
    const trimmed = text.trim();
    if (trimmed.length === 0) return { value: fallback, error: new Error('empty file'), missing: false };
    return { value: JSON.parse(trimmed), error: null, missing: false };
  } catch (error) {
    const missing = error !== null && typeof error === 'object' && error.code === 'ENOENT';
    return { value: fallback, error: missing ? null : error, missing };
  }
}

/**
 * Atomic JSON write: serialize to a sibling temp file, then rename over the
 * target. Windows rename can fail with EPERM when a reader holds the target,
 * so a single unlink-and-retry fallback is attempted.
 * @param {string} file
 * @param {unknown} value
 * @returns {Promise<void>}
 */
export async function writeJsonAtomic(file, value) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}.tmp`
  );
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    await fs.rename(tmp, file);
  } catch (error) {
    const code = error !== null && typeof error === 'object' ? error.code : undefined;
    if (code === 'EEXIST' || code === 'EPERM' || code === 'EACCES') {
      await fs.rm(file, { force: true });
      await fs.rename(tmp, file);
      return;
    }
    await fs.rm(tmp, { force: true });
    throw error;
  }
}

/**
 * Recursively sum regular-file sizes, bounded so a hostile tree cannot hang a
 * tool call.
 * @param {string} target
 * @param {{ maxEntries?: number, followLinks?: boolean }} [options]
 * @returns {Promise<{ bytes: number, files: number, truncated: boolean }>}
 */
export async function treeSize(target, options = {}) {
  const maxEntries = options.maxEntries ?? 200_000;
  let bytes = 0;
  let files = 0;
  let seen = 0;
  let truncated = false;
  /** @type {string[]} */
  const stack = [target];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      seen += 1;
      if (seen > maxEntries) {
        truncated = true;
        break;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() || (entry.isSymbolicLink() && options.followLinks === true)) {
        try {
          const stat = await fs.stat(full);
          bytes += stat.size;
          files += 1;
        } catch {
          // A vanished file contributes nothing.
        }
      }
    }
    if (truncated) break;
  }
  return { bytes, files, truncated };
}
