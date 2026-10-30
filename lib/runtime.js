/**
 * Runtime discovery and installation for the two inference backends.
 *
 * Windows: llama-server from the llama.cpp releases (CPU / CUDA / Vulkan).
 * Apple Silicon: mlxcel-server, preferably through Homebrew
 * (`brew tap lablup/tap && brew install mlxcel`), with the signed release
 * archive as the fallback and a source build only as a documented last resort.
 *
 * GitHub URLs are never rewritten through a hardcoded proxy: the prefix comes
 * from the plugin Config (`githubProxyPrefix`) or from the explicit tool
 * argument, and is used only after a direct attempt fails or is slow.
 * @module @local/open-model/lib/runtime
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveProxy } from './config.js';
import { contentLength, downloadFile, httpJson, httpRequest } from './net.js';
import {
  ensureDir, pathExists, readJson, runtimeCachePath, runtimesRoot, writeJsonAtomic
} from './paths.js';
import { isAppleSilicon, outputTail, resolveExecutable, runCommand } from './process.js';
import { formatBytes, isoNow } from './util.js';

export const LLAMA = 'llama-server';
export const MLXCEL = 'mlxcel-server';

const LLAMA_REPO = 'ggml-org/llama.cpp';
const MLXCEL_REPO = 'lablup/mlxcel';
const RELEASE_API = 'https://api.github.com/repos';

/**
 * @param {string} value
 * @returns {string}
 */
function normalizePrefix(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return '';
  const trimmed = value.trim();
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

/**
 * The proxy prefix to try for GitHub URLs: explicit argument first, config
 * second, never a built-in default.
 * @param {any} config
 * @param {string | undefined} explicit
 * @returns {string}
 */
export function githubPrefix(config, explicit) {
  return normalizePrefix(explicit ?? '') || normalizePrefix(config.githubProxyPrefix);
}

/**
 * Prefix a URL for a GitHub proxy deployment.
 * @param {string} url
 * @param {string} prefix
 * @returns {string}
 */
export function proxiedUrl(url, prefix) {
  if (prefix.length === 0) return url;
  return `${prefix}${url}`;
}

/**
 * Fetch the newest releases (bounded) for a repo, trying a direct call first
 * and the configured GitHub proxy second.
 * @param {string} repo
 * @param {{ config: any, prefix?: string, signal?: AbortSignal, limit?: number }} options
 * @returns {Promise<{ releases: any[], viaProxy: boolean }>}
 */
export async function listReleases(repo, options) {
  const proxy = resolveProxy(options.config);
  const limit = options.limit ?? 10;
  const direct = `${RELEASE_API}/${repo}/releases?per_page=${limit}`;
  try {
    const { json } = await httpJson(direct, { timeoutMs: 30_000, signal: options.signal, proxy });
    if (Array.isArray(json)) return { releases: json, viaProxy: false };
    throw new Error('unexpected release response');
  } catch (error) {
    const prefix = normalizePrefix(options.prefix ?? '');
    if (prefix.length === 0) throw error;
    const { json } = await httpJson(proxiedUrl(direct, prefix), {
      timeoutMs: 45_000,
      signal: options.signal,
      proxy
    });
    if (!Array.isArray(json)) throw new Error('unexpected release response through the GitHub proxy');
    return { releases: json, viaProxy: true };
  }
}

/**
 * Read the runtime cache written by a previous discovery/installation.
 * @returns {Promise<Record<string, any>>}
 */
export async function readRuntimeCache() {
  const { value } = await readJson(runtimeCachePath(), {});
  return value !== null && typeof value === 'object' ? value : {};
}

/**
 * @param {Record<string, any>} patch
 * @returns {Promise<void>}
 */
async function writeRuntimeCache(patch) {
  const current = await readRuntimeCache();
  await writeJsonAtomic(runtimeCachePath(), { ...current, ...patch, updatedAt: isoNow() });
}

/**
 * @param {string} executable
 * @returns {Promise<string | null>}
 */
export async function readVersion(executable) {
  const result = await runCommand([executable, '--version'], { timeoutMs: 20_000 });
  const text = outputTail(result, 2_000);
  const match = /(?:version[:\s]+)?v?(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)/u.exec(text);
  if (match !== null) return match[1];
  const firstLine = text.split(/\r?\n/u).find((line) => line.trim().length > 0);
  return firstLine === undefined ? null : firstLine.trim().slice(0, 120);
}

/**
 * Windows CUDA DLL requirements for a llama-server build.
 * @param {string} exe
 * @returns {Promise<{ missing: string[], cuda: boolean }>}
 */
async function missingCudaLibraries(exe) {
  if (process.platform !== 'win32') return { missing: [], cuda: false };
  const dir = path.dirname(exe);
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    entries = [];
  }
  const hasCudaBackend = entries.some((name) => /^ggml-cuda/iu.test(name)) || /cuda/iu.test(path.basename(dir));
  if (!hasCudaBackend) return { missing: [], cuda: false };
  const searchDirs = [dir];
  for (const candidate of String(process.env.PATH ?? '').split(path.delimiter)) {
    if (candidate.trim().length > 0) searchDirs.push(candidate.trim());
  }
  const required = ['cudart64_', 'cublas64_', 'cublasLt64_'];
  /** @type {string[]} */
  const missing = [];
  for (const stem of required) {
    let found = false;
    for (const searchDir of searchDirs) {
      let names;
      try {
        names = await fs.readdir(searchDir);
      } catch {
        continue;
      }
      if (names.some((name) => name.toLowerCase().startsWith(stem) && name.toLowerCase().endsWith('.dll'))) {
        found = true;
        break;
      }
    }
    if (!found) missing.push(`${stem}*.dll`);
  }
  return { missing, cuda: true };
}

/**
 * Candidate llama-server paths in discovery order.
 * @param {any} config
 * @param {Record<string, any>} cache
 * @returns {Array<{ path: string, source: string }>}
 */
function llamaCandidates(config, cache) {
  const executable = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  /** @type {Array<{ path: string, source: string }>} */
  const candidates = [];
  if (typeof cache.path === 'string' && cache.path.length > 0) {
    candidates.push({ path: cache.path, source: 'runtime-cache' });
  }
  if (typeof config.runtimeDir === 'string' && config.runtimeDir.length > 0) {
    candidates.push({ path: path.join(config.runtimeDir, executable), source: 'config.runtimeDir' });
    candidates.push({ path: config.runtimeDir, source: 'config.runtimeDir' });
  }
  candidates.push({ path: path.join(runtimesRoot(), LLAMA, executable), source: 'plugin-install' });
  const onPath = resolveExecutable(executable);
  if (onPath !== null) candidates.push({ path: onPath, source: 'PATH' });
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? '', 'AppData', 'Local');
    candidates.push({ path: path.join(localAppData, 'Programs', 'llama.cpp', executable), source: 'common-location' });
    candidates.push({ path: path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'llama.cpp', executable), source: 'common-location' });
    candidates.push({ path: path.join(process.env.USERPROFILE ?? '', 'llama.cpp', 'build', 'bin', executable), source: 'common-location' });
  } else {
    candidates.push({ path: path.join('/opt/homebrew/bin', executable), source: 'homebrew' });
    candidates.push({ path: path.join('/usr/local/bin', executable), source: 'common-location' });
  }
  return candidates;
}

/**
 * Candidate mlxcel-server paths.
 * @param {any} config
 * @param {Record<string, any>} cache
 * @returns {Array<{ path: string, source: string }>}
 */
function mlxcelCandidates(config, cache) {
  const executable = 'mlxcel-server';
  /** @type {Array<{ path: string, source: string }>} */
  const candidates = [];
  if (typeof cache.path === 'string' && cache.path.length > 0) {
    candidates.push({ path: cache.path, source: 'runtime-cache' });
  }
  if (typeof config.runtimeDir === 'string' && config.runtimeDir.length > 0) {
    candidates.push({ path: path.join(config.runtimeDir, executable), source: 'config.runtimeDir' });
  }
  candidates.push({ path: path.join(runtimesRoot(), 'mlxcel', executable), source: 'plugin-install' });
  candidates.push({ path: path.join(runtimesRoot(), 'mlxcel', 'bin', executable), source: 'plugin-install' });
  const which = resolveExecutable(executable);
  if (which !== null) candidates.push({ path: which, source: 'PATH' });
  candidates.push({ path: '/opt/homebrew/bin/mlxcel-server', source: 'homebrew' });
  candidates.push({ path: '/usr/local/bin/mlxcel-server', source: 'homebrew' });
  return candidates;
}

/**
 * Check one candidate executable and its version.
 * @param {{ path: string, source: string }} candidate
 * @returns {Promise<{ path: string, source: string, version: string | null, ok: boolean }>}
 */
async function inspectExecutable(candidate) {
  try {
    const stat = await fs.stat(candidate.path);
    if (!stat.isFile()) return { ...candidate, version: null, ok: false };
  } catch {
    return { ...candidate, version: null, ok: false };
  }
  const version = await readVersion(candidate.path);
  return { ...candidate, version, ok: version !== null };
}

/**
 * Discover both runtimes.
 * @param {any} config
 * @param {{ verify?: boolean }} [options]
 * @returns {Promise<{ llama: any, mlxcel: any, cache: Record<string, any> }>}
 */
export async function discoverRuntimes(config, options = {}) {
  const cache = await readRuntimeCache();
  const verify = options.verify !== false;

  /** @type {any} */
  let llama = { name: LLAMA, available: false, path: null, version: null, source: null, missing: [], cuda: false };
  for (const candidate of llamaCandidates(config, cache[LLAMA] ?? {})) {
    const inspected = await inspectExecutable(candidate);
    if (!inspected.ok) continue;
    const cudaCheck = verify ? await missingCudaLibraries(inspected.path) : { missing: [], cuda: false };
    llama = {
      name: LLAMA,
      available: true,
      path: inspected.path,
      version: inspected.version,
      source: inspected.source,
      missing: cudaCheck.missing,
      cuda: cudaCheck.cuda
    };
    break;
  }

  /** @type {any} */
  let mlxcel = {
    name: MLXCEL,
    available: false,
    path: null,
    version: null,
    source: null,
    missing: [],
    supported: isAppleSilicon()
  };
  if (process.platform === 'darwin') {
    for (const candidate of mlxcelCandidates(config, cache[MLXCEL] ?? {})) {
      const inspected = await inspectExecutable(candidate);
      if (!inspected.ok) continue;
      const metallib = path.join(path.dirname(inspected.path), 'mlx.metallib');
      mlxcel = {
        name: MLXCEL,
        available: true,
        path: inspected.path,
        version: inspected.version,
        source: inspected.source,
        missing: [],
        supported: isAppleSilicon(),
        metallib: await pathExists(metallib)
      };
      break;
    }
  }

  if (llama.available) {
    await writeRuntimeCache({
      [LLAMA]: { ...(cache[LLAMA] ?? {}), path: llama.path, version: llama.version, source: llama.source, cuda: llama.cuda }
    }).catch(() => {});
  }
  if (mlxcel.available) {
    await writeRuntimeCache({
      [MLXCEL]: { ...(cache[MLXCEL] ?? {}), path: mlxcel.path, version: mlxcel.version, source: mlxcel.source }
    }).catch(() => {});
  }
  return { llama, mlxcel, cache };
}

/**
 * Whether a direct connection reaches GitHub quickly enough.
 * @param {string} url
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ reachable: boolean, elapsedMs: number }>}
 */
async function directReachable(url, options = {}) {
  const startedAt = Date.now();
  const length = await contentLength(url, { timeoutMs: options.timeoutMs ?? 12_000 });
  return { reachable: length !== null, elapsedMs: Date.now() - startedAt };
}

/**
 * Download one release archive with a direct-first, proxy-second policy.
 * @param {{
 *   url: string,
 *   dest: string,
 *   sizeBytes?: number | null,
 *   config: any,
 *   prefix?: string,
 *   signal?: AbortSignal,
 *   onProgress?: (progress: { bytes: number, totalBytes: number | null }) => void,
 *   log?: (message: string) => void
 * }} options
 * @returns {Promise<{ path: string, url: string, viaProxy: boolean }>}
 */
export async function downloadRelease(options) {
  const proxy = resolveProxy(options.config);
  const prefix = normalizePrefix(options.prefix ?? '');
  const direct = options.url;
  const directProbe = await directReachable(direct, { timeoutMs: 12_000 });
  const useProxyFirst = !directProbe.reachable && prefix.length > 0;
  const attempts = [];
  if (!useProxyFirst) attempts.push({ url: direct, viaProxy: false });
  if (prefix.length > 0) attempts.push({ url: proxiedUrl(direct, prefix), viaProxy: true });
  if (!useProxyFirst) attempts.push({ url: direct, viaProxy: false });

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const result = await downloadFile({
        url: attempt.url,
        dest: options.dest,
        totalBytes: options.sizeBytes ?? null,
        timeoutMs: 30 * 60 * 1000,
        signal: options.signal,
        proxy,
        onProgress: options.onProgress
      });
      void result;
      return { path: options.dest, url: attempt.url, viaProxy: attempt.viaProxy };
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted === true) throw error;
      options.log?.(`[open-model] download attempt failed (${attempt.url}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw lastError ?? new Error('download failed');
}

/**
 * Verify a downloaded archive against a published `.sha256` sidecar, when one
 * exists. Missing sidecars are tolerated.
 * @param {string} archive
 * @param {string} sidecarUrl
 * @param {{ config: any, signal?: AbortSignal }} options
 * @returns {Promise<boolean>}
 */
async function verifySha256(archive, sidecarUrl, options) {
  try {
    const response = await httpRequest(sidecarUrl, {
      timeoutMs: 20_000,
      signal: options.signal,
      proxy: resolveProxy(options.config)
    });
    if (response.status < 200 || response.status >= 300) return true;
    const expected = /([0-9a-f]{64})/iu.exec(response.text)?.[1]?.toLowerCase();
    if (expected === undefined) return true;
    const hash = crypto.createHash('sha256');
    const handle = await fs.open(archive, 'r');
    try {
      const buffer = Buffer.alloc(1024 * 1024);
      for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (bytesRead === 0) break;
        hash.update(buffer.subarray(0, bytesRead));
      }
    } finally {
      await handle.close();
    }
    return hash.digest('hex').toLowerCase() === expected;
  } catch {
    return true;
  }
}

/**
 * Extract a zip archive cross-platform.
 * @param {string} archive
 * @param {string} dir
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<void>}
 */
export async function extractArchive(archive, dir, options = {}) {
  await ensureDir(dir);
  const tar = resolveExecutable('tar') ?? (process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : null);
  if (tar !== null) {
    const result = await runCommand([tar, '-xf', archive, '-C', dir], {
      timeoutMs: 10 * 60 * 1000,
      signal: options.signal
    });
    if (result.code === 0) return;
  }
  if (process.platform === 'win32') {
    const result = await runCommand(
      [
        'powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath '${archive.replace(/'/gu, "''")}' -DestinationPath '${dir.replace(/'/gu, "''")}' -Force`
      ],
      { timeoutMs: 10 * 60 * 1000, signal: options.signal }
    );
    if (result.code === 0) return;
    throw new Error(`extraction failed: ${outputTail(result, 800)}`);
  }
  const unzip = resolveExecutable('unzip');
  if (unzip === null) throw new Error('no tar or unzip available to extract the archive');
  const result = await runCommand([unzip, '-o', archive, '-d', dir], { timeoutMs: 10 * 60 * 1000, signal: options.signal });
  if (result.code !== 0) throw new Error(`extraction failed: ${outputTail(result, 800)}`);
}

/**
 * Collapse a single top-level directory after extraction so the install root
 * directly contains the binaries and their sidecar libraries.
 * @param {string} dir
 * @returns {Promise<void>}
 */
async function flattenSingleDirectory(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0].isDirectory()) return;
  const inner = path.join(dir, entries[0].name);
  const innerEntries = await fs.readdir(inner, { withFileTypes: true });
  for (const entry of innerEntries) {
    await fs.rename(path.join(inner, entry.name), path.join(dir, entry.name));
  }
  await fs.rmdir(inner).catch(() => {});
}

/**
 * Compare two `cuda-<major>.<minor>` version strings, newest first.
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
function compareCudaVersions(left, right) {
  const parse = (name) => {
    const match = /cuda-(\d+)\.(\d+)-/u.exec(name);
    return match === null ? [0, 0] : [Number(match[1]), Number(match[2])];
  };
  const [leftMajor, leftMinor] = parse(left);
  const [rightMajor, rightMinor] = parse(right);
  return (rightMajor - leftMajor) || (rightMinor - leftMinor);
}

/**
 * Pick the llama.cpp asset for a backend.
 *
 * Only x64 archives qualify (`-x64.zip`), and the CUDA DLL bundle
 * (`cudart-llama-…`) is never a runtime itself: it is paired with the matching
 * CUDA runtime archive of the same major.minor version.
 * @param {any[]} assets
 * @param {'cpu'|'cuda'|'vulkan'} backend
 * @returns {{ main: any | null, cudart: any | null }}
 */
export function selectLlamaAssets(assets, backend) {
  const zips = assets.filter((asset) => typeof asset?.name === 'string'
    && asset.name.endsWith('.zip')
    && /-x64\.zip$/iu.test(asset.name));
  if (backend === 'cuda') {
    const runtimes = zips
      .filter((asset) => /(^|\/)llama-.*bin-win-cuda-\d+\.\d+-x64\.zip$/iu.test(asset.name))
      .sort((left, right) => compareCudaVersions(left.name, right.name));
    const main = runtimes[0] ?? null;
    if (main === null) return { main: null, cudart: null };
    const version = /cuda-(\d+\.\d+)-/u.exec(main.name)?.[1] ?? '';
    const cudart = zips
      .filter((asset) => /^cudart-.*cuda-\d+\.\d+-x64\.zip$/iu.test(asset.name))
      .find((asset) => asset.name.includes(`cuda-${version}-`)) ?? null;
    return { main, cudart };
  }
  if (backend === 'vulkan') {
    return {
      main: zips.find((asset) => /bin-win-vulkan-x64\.zip$/iu.test(asset.name)) ?? null,
      cudart: null
    };
  }
  return {
    main: zips.find((asset) => /bin-win-cpu-x64\.zip$/iu.test(asset.name)) ?? null,
    cudart: null
  };
}

/**
 * Detect the best Windows backend for this machine.
 * @param {string} requested
 * @returns {'cpu'|'cuda'|'vulkan'}
 */
export function detectBackend(requested) {
  if (requested === 'cpu' || requested === 'cuda' || requested === 'vulkan') return requested;
  if (process.platform === 'win32' && resolveExecutable('nvidia-smi') !== null) return 'cuda';
  return 'cpu';
}

/**
 * Install llama-server on Windows from the official releases.
 * @param {{
 *   config: any,
 *   backend: string,
 *   proxyPrefix?: string,
 *   signal?: AbortSignal,
 *   dryRun?: boolean,
 *   force?: boolean,
 *   log?: (message: string) => void
 * }} options
 * @returns {Promise<any>}
 */
export async function installLlamaServer(options) {
  const { config } = options;
  if (process.platform !== 'win32') {
    return {
      ok: false,
      runtime: LLAMA,
      reason: 'unsupported-platform',
      platform: process.platform,
      arch: process.arch
    };
  }
  const backend = detectBackend(options.backend);
  const installDir = path.join(runtimesRoot(), LLAMA);
  const prefix = githubPrefix(config, options.proxyPrefix);
  const listing = await listReleases(LLAMA_REPO, { config, prefix, signal: options.signal });
  let chosen = null;
  let selected = null;
  for (const release of listing.releases) {
    const picked = selectLlamaAssets(Array.isArray(release?.assets) ? release.assets : [], backend);
    if (picked.main !== null) {
      chosen = release;
      selected = picked;
      break;
    }
  }
  if (chosen === null || selected === null || selected.main === null) {
    return { ok: false, runtime: LLAMA, reason: 'no-release', backend };
  }
  const assets = [selected.main, ...(selected.cudart !== null ? [selected.cudart] : [])];
  if (options.dryRun === true) {
    return {
      ok: true,
      runtime: LLAMA,
      dryRun: true,
      backend,
      release: chosen.tag_name,
      installDir,
      cudart: selected.cudart === null ? null : selected.cudart.name,
      cudartMissing: backend === 'cuda' && selected.cudart === null,
      assets: assets.map((asset) => ({ name: asset.name, sizeBytes: asset.size ?? null, url: asset.browser_download_url })),
      prefix
    };
  }

  await ensureDir(installDir);
  const downloadDir = path.join(installDir, 'downloads');
  await ensureDir(downloadDir);
  /** @type {Array<{ name: string, url: string, viaProxy: boolean, bytes: number }>} */
  const downloaded = [];
  for (const asset of assets) {
    const dest = path.join(downloadDir, asset.name);
    const result = await downloadRelease({
      url: asset.browser_download_url,
      dest,
      sizeBytes: asset.size ?? null,
      config,
      prefix,
      signal: options.signal,
      onProgress: (progress) => {
        options.log?.(`[open-model] ${asset.name}: ${formatBytes(progress.bytes)}${progress.totalBytes === null ? '' : ` / ${formatBytes(progress.totalBytes)}`}`);
      }
    });
    downloaded.push({ name: asset.name, url: result.url, viaProxy: result.viaProxy, bytes: (await fs.stat(dest)).size });
    await extractArchive(dest, installDir, { signal: options.signal });
    await flattenSingleDirectory(installDir).catch(() => {});
  }

  const exe = path.join(installDir, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
  const version = (await pathExists(exe)) ? await readVersion(exe) : null;
  await writeRuntimeCache({
    [LLAMA]: { path: exe, version, backend, installedAt: isoNow(), source: 'github-release' }
  }).catch(() => {});
  return {
    ok: version !== null,
    runtime: LLAMA,
    backend,
    release: chosen.tag_name,
    installDir,
    executable: exe,
    version,
    cudart: selected.cudart === null ? null : selected.cudart.name,
    cudartMissing: backend === 'cuda' && selected.cudart === null,
    viaProxy: downloaded.some((entry) => entry.viaProxy),
    assets: downloaded
  };
}

/**
 * Install mlxcel on Apple Silicon.
 * @param {{
 *   config: any,
 *   method: 'auto'|'brew'|'binary',
 *   proxyPrefix?: string,
 *   signal?: AbortSignal,
 *   dryRun?: boolean,
 *   log?: (message: string) => void
 * }} options
 * @returns {Promise<any>}
 */
export async function installMlxcel(options) {
  if (process.platform !== 'darwin') {
    return { ok: false, runtime: MLXCEL, reason: 'unsupported-platform', platform: process.platform, arch: process.arch };
  }
  if (!isAppleSilicon()) {
    return { ok: false, runtime: MLXCEL, reason: 'intel-mac', platform: process.platform, arch: process.arch };
  }
  const { config } = options;
  const brew = options.method === 'binary' ? null : resolveExecutable('brew');
  if (brew !== null) {
    const commands = [[brew, 'tap', 'lablup/tap'], [brew, 'install', 'mlxcel']];
    if (options.dryRun === true) {
      return {
        ok: true,
        runtime: MLXCEL,
        dryRun: true,
        method: 'brew',
        commands: commands.map((argv) => argv.join(' '))
      };
    }
    for (const argv of commands) {
      const result = await runCommand(argv, { timeoutMs: 45 * 60 * 1000, signal: options.signal });
      if (result.code !== 0) {
        options.log?.(`[open-model] ${argv.join(' ')} failed: ${outputTail(result, 800)}`);
        return { ok: false, runtime: MLXCEL, reason: 'brew-failed', command: argv.join(' '), error: outputTail(result, 800) };
      }
    }
    const discovery = await discoverRuntimes(config);
    if (discovery.mlxcel.available) {
      return {
        ok: true,
        runtime: MLXCEL,
        method: 'brew',
        executable: discovery.mlxcel.path,
        version: discovery.mlxcel.version
      };
    }
    options.log?.('[open-model] brew finished but mlxcel-server was not found; trying the release archive');
  }

  const prefix = githubPrefix(config, options.proxyPrefix);
  const listing = await listReleases(MLXCEL_REPO, { config, prefix, signal: options.signal });
  let release = null;
  let asset = null;
  for (const candidate of listing.releases) {
    const assets = Array.isArray(candidate?.assets) ? candidate.assets : [];
    const found = assets.find((entry) => /^mlxcel-macos-aarch64\.zip$/u.test(entry?.name ?? ''))
      ?? assets.find((entry) => /macos-aarch64.*\.zip$/u.test(entry?.name ?? ''));
    if (found !== undefined && found !== null) {
      release = candidate;
      asset = found;
      break;
    }
  }
  if (release === null || asset === null) {
    return { ok: false, runtime: MLXCEL, reason: 'no-release', method: 'binary' };
  }
  const installDir = path.join(runtimesRoot(), 'mlxcel');
  if (options.dryRun === true) {
    return {
      ok: true,
      runtime: MLXCEL,
      dryRun: true,
      method: 'binary',
      release: release.tag_name,
      installDir,
      assets: [{ name: asset.name, sizeBytes: asset.size ?? null, url: asset.browser_download_url }],
      prefix
    };
  }
  await ensureDir(installDir);
  const downloadDir = path.join(installDir, 'downloads');
  await ensureDir(downloadDir);
  const archive = path.join(downloadDir, asset.name);
  const result = await downloadRelease({
    url: asset.browser_download_url,
    dest: archive,
    sizeBytes: asset.size ?? null,
    config,
    prefix,
    signal: options.signal,
    onProgress: (progress) => {
      options.log?.(`[open-model] ${asset.name}: ${formatBytes(progress.bytes)}${progress.totalBytes === null ? '' : ` / ${formatBytes(progress.totalBytes)}`}`);
    }
  });
  const shaAsset = Array.isArray(release.assets)
    ? release.assets.find((entry) => entry?.name === `${asset.name}.sha256`)
    : undefined;
  let checksum = 'skipped';
  if (shaAsset !== undefined) {
    const valid = await verifySha256(archive, proxiedUrl(shaAsset.browser_download_url, result.viaProxy ? prefix : ''), { config, signal: options.signal });
    if (!valid) {
      return { ok: false, runtime: MLXCEL, reason: 'checksum-mismatch', archive };
    }
    checksum = 'verified';
  }

  await extractArchive(archive, installDir, { signal: options.signal });
  await flattenSingleDirectory(installDir).catch(() => {});
  const candidates = [path.join(installDir, 'mlxcel-server'), path.join(installDir, 'bin', 'mlxcel-server')];
  let executable = null;
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      executable = candidate;
      break;
    }
  }
  if (executable === null) {
    return { ok: false, runtime: MLXCEL, reason: 'incomplete-archive', installDir };
  }
  for (const candidate of candidates) {
    if (await pathExists(candidate)) await fs.chmod(candidate, 0o755).catch(() => {});
  }
  const version = await readVersion(executable);
  const metallib = await pathExists(path.join(path.dirname(executable), 'mlx.metallib'));
  await writeRuntimeCache({
    [MLXCEL]: {
      path: executable,
      version,
      installedAt: isoNow(),
      source: 'github-release',
      metallib
    }
  }).catch(() => {});
  return {
    ok: version !== null,
    runtime: MLXCEL,
    method: 'binary',
    release: release.tag_name,
    installDir,
    executable,
    version,
    metallib,
    checksum,
    viaProxy: result.viaProxy
  };
}
