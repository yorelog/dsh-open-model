/**
 * Plugin configuration.
 *
 * The schema is a Schemastery schema when the Host can resolve
 * `@deepseek-ai/schemastery` (the normal case inside the Harness profile), and
 * a minimal Standard-Schema fallback otherwise, so the bundle stays loadable
 * as a plain directory link with no installed dependencies. Both paths feed
 * {@link normalizeConfig}, which owns the effective defaults actually used by
 * the runtime.
 * @module dsh-open-model/lib/config
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultModelRoot, dshHome } from './paths.js';
import { firstNonEmpty, isPlainObject, normalizeLocale } from './util.js';

/** Sources this plugin can search and download from. */
export const SOURCES = ['huggingface', 'hf-mirror', 'modelscope'];

/** Runtime identifiers. */
export const RUNTIMES = ['llama-server', 'mlxcel-server'];

/** llama.cpp Windows backends. */
export const BACKENDS = ['auto', 'cpu', 'cuda', 'vulkan'];

/** Effective defaults; also the documentation source of truth. */
export const DEFAULTS = Object.freeze({
  modelRoots: Object.freeze([]),
  runtimeDir: '',
  idleTimeoutMs: 300_000,
  defaultSource: 'hf-mirror',
  hfEndpoint: '',
  hfMirrorEndpoint: 'https://hf-mirror.com',
  modelscopeEndpoint: 'https://modelscope.cn',
  githubProxyPrefix: '',
  backend: 'auto',
  locale: 'auto',
  serverHost: '127.0.0.1',
  loadTimeoutMs: 180_000,
  stopGraceMs: 10_000,
  requestTimeoutMs: 120_000,
  idleCheckIntervalMs: 30_000,
  scanDepth: 4,
  downloadMethod: 'auto',
  llamaArgs: Object.freeze([]),
  mlxcelArgs: Object.freeze([])
});

const FIELD_HELP = {
  modelRoots: 'Extra model root directories. Empty means ${DSH_HOME}/models only.',
  runtimeDir: 'Directory that holds llama-server / mlxcel-server binaries. Empty means automatic discovery.',
  idleTimeoutMs: 'Release a loaded model after this many milliseconds without a request. Default 300000 (5 minutes).',
  defaultSource: 'Source used when a tool call omits `source`: huggingface, hf-mirror or modelscope.',
  hfEndpoint: 'HuggingFace Hub endpoint for source=huggingface. Empty falls back to HF_ENDPOINT and then the official site.',
  hfMirrorEndpoint: 'Mirror endpoint for source=hf-mirror; injected to child processes as HF_ENDPOINT.',
  modelscopeEndpoint: 'ModelScope site endpoint (https://modelscope.cn or https://www.modelscope.ai). Tokens are never moved between sites.',
  githubProxyPrefix: 'Prefix prepended to GitHub release URLs when a direct download fails, for example a gh-proxy deployment. Empty disables the fallback; nothing is hardcoded.',
  backend: 'llama.cpp Windows backend to install: auto, cpu, cuda or vulkan.',
  locale: 'Output language: auto, zh or en. auto follows the session/Host language.',
  serverHost: 'Bind address for local inference servers.',
  loadTimeoutMs: 'Maximum time to wait for a server to become healthy.',
  stopGraceMs: 'Grace period between the graceful stop signal and a forced kill.',
  requestTimeoutMs: 'Per-request timeout for model_infer.',
  idleCheckIntervalMs: 'How often the idle reaper runs.',
  scanDepth: 'Maximum directory depth for model_scan.',
  downloadMethod: 'Download transport: auto, cli or sdk.',
  proxy: 'HTTP/SOCKS proxy. Either a single URL string, or an object with http/https/all/noProxy keys. Empty values are skipped, never forwarded.',
  llamaArgs: 'Extra arguments appended to the llama-server command line.',
  mlxcelArgs: 'Extra arguments appended to the mlxcel-server command line.'
};

/** @returns {any} */
function makeFallbackSchema() {
  return {
    '~standard': {
      version: 1,
      vendor: 'dsh-open-model',
      validate(value) {
        if (value !== undefined && value !== null && !isPlainObject(value)) {
          return { issues: [{ message: 'config must be an object', path: [] }] };
        }
        return { value: normalizeConfig(value ?? {}) };
      }
    }
  };
}

/**
 * @param {any} z
 * @returns {any}
 */
function makeSchemasterySchema(z) {
  return z.object({
    modelRoots: z.array(z.string()).default([]).description(FIELD_HELP.modelRoots),
    runtimeDir: z.string().default('').description(FIELD_HELP.runtimeDir),
    idleTimeoutMs: z.number().default(DEFAULTS.idleTimeoutMs).description(FIELD_HELP.idleTimeoutMs),
    defaultSource: z.string().default(DEFAULTS.defaultSource).description(FIELD_HELP.defaultSource),
    hfEndpoint: z.string().default('').description(FIELD_HELP.hfEndpoint),
    hfMirrorEndpoint: z.string().default(DEFAULTS.hfMirrorEndpoint).description(FIELD_HELP.hfMirrorEndpoint),
    modelscopeEndpoint: z.string().default(DEFAULTS.modelscopeEndpoint).description(FIELD_HELP.modelscopeEndpoint),
    proxy: z.union([z.string(), z.dict(z.string())]).default({}).description(FIELD_HELP.proxy),
    githubProxyPrefix: z.string().default('').description(FIELD_HELP.githubProxyPrefix),
    backend: z.string().default('auto').description(FIELD_HELP.backend),
    locale: z.string().default('auto').description(FIELD_HELP.locale),
    serverHost: z.string().default(DEFAULTS.serverHost).description(FIELD_HELP.serverHost),
    loadTimeoutMs: z.number().default(DEFAULTS.loadTimeoutMs).description(FIELD_HELP.loadTimeoutMs),
    stopGraceMs: z.number().default(DEFAULTS.stopGraceMs).description(FIELD_HELP.stopGraceMs),
    requestTimeoutMs: z.number().default(DEFAULTS.requestTimeoutMs).description(FIELD_HELP.requestTimeoutMs),
    idleCheckIntervalMs: z.number().default(DEFAULTS.idleCheckIntervalMs).description(FIELD_HELP.idleCheckIntervalMs),
    scanDepth: z.number().default(DEFAULTS.scanDepth).description(FIELD_HELP.scanDepth),
    downloadMethod: z.string().default('auto').description(FIELD_HELP.downloadMethod),
    llamaArgs: z.array(z.string()).default([]).description(FIELD_HELP.llamaArgs),
    mlxcelArgs: z.array(z.string()).default([]).description(FIELD_HELP.mlxcelArgs)
  });
}

/**
 * Load Schemastery from the Host installation.
 *
 * A profile bundle is a linked directory, so the Host's own dependency graph is
 * not on this package's resolution path. Reusing the exact file the Harness
 * itself loaded keeps one Schemastery instance and makes the Config schema
 * projectable by Settings and by the Config inspector.
 * @returns {Promise<any | null>}
 */
async function loadSchemastery() {
  try {
    const mod = await import('@deepseek-ai/schemastery');
    const candidate = mod.default ?? mod;
    if (typeof candidate === 'function' && typeof candidate.object === 'function') return candidate;
  } catch {
    // Fall through to the installation-relative lookup.
  }

  /** @type {string[]} */
  const candidates = [];
  const seen = new Set();
  const pushCandidate = (base, suffix) => {
    const resolved = path.resolve(base, suffix);
    if (!seen.has(resolved)) {
      seen.add(resolved);
      candidates.push(resolved);
    }
  };
  // Walk up from the Host entry script (…/app.asar/dsh/node_modules/…).
  const entry = process.argv[1];
  if (typeof entry === 'string' && entry.length > 0) {
    let dir = path.dirname(entry);
    for (let depth = 0; depth < 8; depth += 1) {
      pushCandidate(dir, 'node_modules/@deepseek-ai/schemastery/lib/index.mjs');
      pushCandidate(dir, 'node_modules/@deepseek-ai/schemastery/lib/index.cjs');
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  // Electron's resources directory carries app.asar on every install.
  if (typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0) {
    pushCandidate(process.resourcesPath, 'app.asar/dsh/node_modules/@deepseek-ai/schemastery/lib/index.mjs');
    pushCandidate(process.resourcesPath, 'app.asar/dsh/node_modules/@deepseek-ai/schemastery/lib/index.cjs');
  }
  // The profile may hoist peer dependencies next to the plugin.
  if (typeof process.env.DSH_PROFILE_DIR === 'string' && process.env.DSH_PROFILE_DIR.length > 0) {
    pushCandidate(process.env.DSH_PROFILE_DIR, 'node_modules/@deepseek-ai/schemastery/lib/index.mjs');
    pushCandidate(process.env.DSH_PROFILE_DIR, 'node_modules/@deepseek-ai/schemastery/lib/index.cjs');
  }

  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const mod = await import(pathToFileURL(candidate).href);
      const loaded = mod.default ?? mod;
      if (typeof loaded === 'function' && typeof loaded.object === 'function') return loaded;
    } catch {
      // Try the next candidate: a broken optional lookup must not break the plugin.
    }
  }
  return null;
}

/** Schemastery resolved from the Host (or null when unavailable). */
const schemastery = await loadSchemastery();

/** Whether the Host resolved Schemastery for this plugin. */
export const hasSchemastery = schemastery !== null;

/**
 * Build the Config schema, falling back if this Schemastery version rejects a
 * construct used here.
 * @returns {any}
 */
function buildConfig() {
  if (schemastery === null) return makeFallbackSchema();
  try {
    return makeSchemasterySchema(schemastery);
  } catch {
    return makeFallbackSchema();
  }
}

/** Plugin Config schema (Schemastery when available, Standard-Schema fallback otherwise). */
export const Config = buildConfig();

/**
 * @param {unknown} value
 * @param {string[]} allowed
 * @param {string} fallback
 * @returns {string}
 */
function oneOf(value, allowed, fallback) {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (allowed.includes(normalized)) return normalized;
  }
  return fallback;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function numberIn(value, fallback, min, max) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function stringList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  }
  return [];
}

/**
 * Normalize one proxy value. Strings win as a whole-proxy shorthand.
 * @param {unknown} raw
 * @returns {{ http: string, https: string, all: string, noProxy: string }}
 */
export function normalizeProxy(raw) {
  const empty = { http: '', https: '', all: '', noProxy: '127.0.0.1,localhost' };
  if (typeof raw === 'string') {
    const url = raw.trim();
    return url.length > 0 ? { ...empty, all: url } : empty;
  }
  if (!isPlainObject(raw)) return empty;
  const pick = (...names) => {
    for (const name of names) {
      const value = raw[name];
      if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    }
    return '';
  };
  return {
    http: pick('http', 'httpProxy', 'HTTP_PROXY'),
    https: pick('https', 'httpsProxy', 'HTTPS_PROXY'),
    all: pick('all', 'allProxy', 'ALL_PROXY', 'socks', 'socksProxy'),
    noProxy: pick('noProxy', 'noproxy', 'NO_PROXY') || '127.0.0.1,localhost'
  };
}

/**
 * Apply defaults and type coercions to a raw loader config.
 * @param {unknown} raw
 * @returns {ReturnType<typeof DEFAULTS> & { proxy: { http: string, https: string, all: string, noProxy: string } }}
 */
export function normalizeConfig(raw = {}) {
  const input = isPlainObject(raw) ? raw : {};
  return {
    modelRoots: stringList(input.modelRoots),
    runtimeDir: typeof input.runtimeDir === 'string' ? input.runtimeDir.trim() : '',
    idleTimeoutMs: numberIn(input.idleTimeoutMs, DEFAULTS.idleTimeoutMs, 30_000, 7 * 24 * 60 * 60 * 1000),
    defaultSource: oneOf(input.defaultSource, SOURCES, DEFAULTS.defaultSource),
    hfEndpoint: typeof input.hfEndpoint === 'string' ? input.hfEndpoint.trim() : '',
    hfMirrorEndpoint:
      (typeof input.hfMirrorEndpoint === 'string' && input.hfMirrorEndpoint.trim().length > 0
        ? input.hfMirrorEndpoint.trim()
        : DEFAULTS.hfMirrorEndpoint),
    modelscopeEndpoint:
      (typeof input.modelscopeEndpoint === 'string' && input.modelscopeEndpoint.trim().length > 0
        ? input.modelscopeEndpoint.trim()
        : DEFAULTS.modelscopeEndpoint),
    proxy: normalizeProxy(input.proxy),
    githubProxyPrefix:
      (typeof input.githubProxyPrefix === 'string' ? input.githubProxyPrefix.trim() : ''),
    backend: oneOf(input.backend, BACKENDS, DEFAULTS.backend),
    locale: normalizeLocale(input.locale) ?? 'auto',
    serverHost:
      (typeof input.serverHost === 'string' && input.serverHost.trim().length > 0
        ? input.serverHost.trim()
        : DEFAULTS.serverHost),
    loadTimeoutMs: numberIn(input.loadTimeoutMs, DEFAULTS.loadTimeoutMs, 5_000, 3_600_000),
    stopGraceMs: numberIn(input.stopGraceMs, DEFAULTS.stopGraceMs, 500, 120_000),
    requestTimeoutMs: numberIn(input.requestTimeoutMs, DEFAULTS.requestTimeoutMs, 1_000, 3_600_000),
    idleCheckIntervalMs: numberIn(input.idleCheckIntervalMs, DEFAULTS.idleCheckIntervalMs, 1_000, 3_600_000),
    scanDepth: numberIn(input.scanDepth, DEFAULTS.scanDepth, 1, 12),
    downloadMethod: oneOf(input.downloadMethod, ['auto', 'cli', 'sdk'], 'auto'),
    llamaArgs: stringList(input.llamaArgs),
    mlxcelArgs: stringList(input.mlxcelArgs)
  };
}

/**
 * Every model root that model_scan walks: the configured roots, or the default
 * `${DSH_HOME}/models` when none is configured.
 * @param {{ modelRoots: string[] }} config
 * @returns {string[]}
 */
export function effectiveModelRoots(config) {
  return config.modelRoots.length > 0 ? [...config.modelRoots] : [defaultModelRoot()];
}

/**
 * Strip trailing slashes from an endpoint.
 * @param {string} endpoint
 * @returns {string}
 */
export function trimEndpoint(endpoint) {
  return String(endpoint ?? '').trim().replace(/\/+$/u, '');
}

/**
 * Resolve the Hub/API endpoint for a source without hardcoding any single site.
 * @param {string} source
 * @param {ReturnType<typeof normalizeConfig>} config
 * @returns {string}
 */
export function endpointFor(source, config) {
  if (source === 'modelscope') {
    return trimEndpoint(
      firstNonEmpty(config.modelscopeEndpoint, process.env.MODELSCOPE_ENDPOINT) ?? DEFAULTS.modelscopeEndpoint
    );
  }
  if (source === 'hf-mirror') {
    return trimEndpoint(config.hfMirrorEndpoint || DEFAULTS.hfMirrorEndpoint);
  }
  return trimEndpoint(
    firstNonEmpty(config.hfEndpoint, process.env.HF_ENDPOINT) ?? 'https://huggingface.co'
  );
}

/**
 * The proxy values actually used, honoring config first and then process env.
 * Empty strings are treated as absent.
 * @param {{ proxy: { http: string, https: string, all: string, noProxy: string } }} config
 * @returns {{ http: string, https: string, all: string, noProxy: string }}
 */
export function resolveProxy(config) {
  const configured = config.proxy;
  return {
    http: firstNonEmpty(configured.http, configured.all, process.env.HTTP_PROXY, process.env.http_proxy) ?? '',
    https: firstNonEmpty(configured.https, configured.all, process.env.HTTPS_PROXY, process.env.https_proxy) ?? '',
    all: firstNonEmpty(configured.all, process.env.ALL_PROXY, process.env.all_proxy) ?? '',
    noProxy: firstNonEmpty(configured.noProxy, process.env.NO_PROXY, process.env.no_proxy) ?? '127.0.0.1,localhost'
  };
}

const PROXY_KEYS = [
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'
];

/**
 * Build the environment every child process inherits.
 *
 * Rules that matter:
 * - inherited proxy variables that are empty strings are deleted, because an
 *   empty proxy value silently means "direct connection" to most HTTP stacks;
 * - configured proxy values are written in both cases so curl, Python and Rust
 *   clients all pick them up;
 * - a mirror source forces HF_ENDPOINT (or MODELSCOPE_ENDPOINT) so the user's
 *   global configuration cannot redirect the download.
 * @param {ReturnType<typeof normalizeConfig>} config
 * @param {{ source?: string, endpoint?: string, extra?: Record<string, string> }} [options]
 * @returns {Record<string, string | undefined>}
 */
export function buildChildEnv(config, options = {}) {
  /** @type {Record<string, string | undefined>} */
  const env = { ...process.env };
  for (const key of PROXY_KEYS) {
    const value = env[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.trim().length === 0) delete env[key];
  }
  const proxy = resolveProxy(config);
  if (proxy.http.length > 0) {
    env.HTTP_PROXY = proxy.http;
    env.http_proxy = proxy.http;
  }
  if (proxy.https.length > 0) {
    env.HTTPS_PROXY = proxy.https;
    env.https_proxy = proxy.https;
  }
  if (proxy.all.length > 0) {
    env.ALL_PROXY = proxy.all;
    env.all_proxy = proxy.all;
  }
  if (proxy.noProxy.length > 0) {
    env.NO_PROXY = proxy.noProxy;
    env.no_proxy = proxy.noProxy;
  }
  if (typeof options.endpoint === 'string' && options.endpoint.length > 0) {
    if (options.source === 'modelscope') env.MODELSCOPE_ENDPOINT = options.endpoint;
    else env.HF_ENDPOINT = options.endpoint;
  }
  if (options.extra !== undefined) {
    for (const [key, value] of Object.entries(options.extra)) {
      if (typeof value === 'string' && value.length > 0) env[key] = value;
    }
  }
  return env;
}

/**
 * Human-readable description of the active proxy, for tool output.
 * @param {ReturnType<typeof normalizeConfig>} config
 * @returns {string}
 */
export function describeProxy(config) {
  const proxy = resolveProxy(config);
  return firstNonEmpty(proxy.https, proxy.http, proxy.all) ?? '';
}

/**
 * Whether config points somewhere other than the official sites.
 * @param {ReturnType<typeof normalizeConfig>} config
 * @returns {boolean}
 */
export function usesMirror(config) {
  return /hf-mirror\.com/iu.test(config.hfMirrorEndpoint) || config.defaultSource === 'hf-mirror';
}

/** @returns {string} */
export function dshHomeLabel() {
  return dshHome();
}
