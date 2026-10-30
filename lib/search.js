/**
 * Multi-source model search.
 *
 * HuggingFace and hf-mirror share the Hub API and differ only by endpoint, so
 * `HF_ENDPOINT` semantics are preserved by configuration instead of assuming
 * huggingface.co. ModelScope uses its OpenAPI and follows the configured
 * endpoint (modelscope.cn or www.modelscope.ai) so tokens never cross sites.
 * @module dsh-open-model/lib/search
 */

import { endpointFor } from './config.js';
import { httpJson, httpRequest } from './net.js';

/** HF sort keys accepted by the Hub API. */
const HF_SORTS = {
  downloads: ['downloads', '-1'],
  updated: ['lastModified', '-1'],
  likes: ['likes', '-1'],
  trending: ['trendingScore', '-1']
};

/** ModelScope sort keys for the OpenAPI list call. */
const MODELSCOPE_SORTS = {
  downloads: 'DownloadsCount',
  updated: 'GmtModified',
  likes: 'Default',
  trending: 'Default'
};

/**
 * Resolve the requested source against configured defaults.
 * @param {string | undefined} source
 * @param {{ defaultSource: string }} config
 * @returns {string}
 */
export function resolveSource(source, config) {
  const value = typeof source === 'string' ? source.trim().toLowerCase() : '';
  if (value.length === 0) return config.defaultSource;
  if (value === 'hf' || value === 'hugging-face' || value === 'huggingface.co') return 'huggingface';
  if (value === 'mirror' || value === 'hf_mirror' || value === 'hfmirror') return 'hf-mirror';
  if (value === 'ms' || value === 'modelscope.cn' || value === 'modelscope.ai') return 'modelscope';
  return value;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clampInt(value, fallback, min, max) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function asNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry !== null && typeof entry === 'object') {
          if (typeof entry.Name === 'string') return entry.Name;
          if (typeof entry.name === 'string') return entry.name;
        }
        return '';
      })
      .filter((entry) => entry.length > 0);
  }
  if (typeof value === 'string' && value.length > 0) {
    return value.split(/[,;]/u).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  }
  return [];
}

/**
 * Normalize the Hub API's optional `size` on a sibling.
 * @param {any} sibling
 * @returns {{ path: string, sizeBytes: number | null }}
 */
function flattenSibling(sibling) {
  if (typeof sibling === 'string') return { path: sibling, sizeBytes: null };
  const filePath = String(sibling?.rfilename ?? sibling?.path ?? sibling?.name ?? '');
  const size = asNumber(sibling?.size ?? sibling?.Size ?? sibling?.lfs?.size);
  return { path: filePath, sizeBytes: size };
}

/**
 * Search the HuggingFace Hub API (also used by hf-mirror through its endpoint).
 * @param {{
 *   query: string,
 *   source: string,
 *   task?: string,
 *   sort?: string,
 *   limit?: number,
 *   config: any,
 *   signal?: AbortSignal,
 *   proxy?: any
 * }} params
 * @returns {Promise<{ source: string, endpoint: string, results: any[] }>}
 */
export async function searchHuggingFace(params) {
  const endpoint = endpointFor(params.source, params.config);
  const limit = clampInt(params.limit, 8, 1, 50);
  const query = params.query.trim();
  const url = new URL(`${endpoint}/api/models`);
  if (query.length > 0) url.searchParams.set('search', query);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('full', 'true');
  const sort = HF_SORTS[params.sort ?? 'downloads'] ?? HF_SORTS.downloads;
  url.searchParams.set('sort', sort[0]);
  url.searchParams.set('direction', sort[1]);
  if (typeof params.task === 'string' && params.task.trim().length > 0) {
    url.searchParams.set('filter', params.task.trim());
  }

  const { json } = await httpJson(url.toString(), {
    timeoutMs: 30_000,
    signal: params.signal,
    proxy: params.proxy
  });
  if (!Array.isArray(json)) throw new Error(`unexpected Hub response from ${endpoint}`);
  const results = json.map((item) => {
    const repoId = String(item?.id ?? item?.modelId ?? '');
    const siblings = Array.isArray(item?.siblings) ? item.siblings.map(flattenSibling) : [];
    const files = siblings.slice(0, 24);
    return {
      repoId,
      source: params.source,
      downloads: asNumber(item?.downloads),
      likes: asNumber(item?.likes),
      updatedAt: typeof item?.lastModified === 'string' ? item.lastModified : (typeof item?.updatedAt === 'string' ? item.updatedAt : null),
      tags: asStringArray(item?.tags),
      pipelineTag: typeof item?.pipeline_tag === 'string' ? item.pipeline_tag : null,
      gated: item?.gated === true || item?.gated === 'auto',
      homepage: `${endpoint}/${repoId}`,
      downloadHint: `${params.source}:${repoId}`,
      files,
      fileCount: siblings.length,
      filesTruncated: siblings.length > files.length
    };
  }).filter((item) => item.repoId.length > 0);
  return { source: params.source, endpoint, results };
}

/**
 * Fetch the ModelScope file list for one repo. Failure is non-fatal: search
 * results stay useful without it.
 * @param {string} endpoint
 * @param {string} repoId
 * @param {{ signal?: AbortSignal, proxy?: any }} [options]
 * @returns {Promise<{ files: Array<{ path: string, sizeBytes: number | null }>, fileCount: number } | null>}
 */
export async function fetchModelScopeFiles(endpoint, repoId, options = {}) {
  const encoded = repoId.split('/').map((part) => encodeURIComponent(part)).join('/');
  const candidates = [
    `${endpoint}/api/v1/models/${encoded}/repo/files?Revision=master&Recursive=true`,
    `${endpoint}/api/v1/models/${encoded}/repo/tree?Revision=master&Recursive=true`
  ];
  for (const url of candidates) {
    try {
      const response = await httpRequest(url, {
        timeoutMs: 20_000,
        signal: options.signal,
        proxy: options.proxy,
        headers: { Accept: 'application/json', 'User-Agent': 'dsh-open-model/1.0' }
      });
      if (response.status < 200 || response.status >= 300) continue;
      const parsed = JSON.parse(response.text);
      const container = parsed?.Data ?? parsed?.data ?? parsed;
      const list = container?.Files ?? container?.files ?? container?.Tree ?? container?.tree;
      if (!Array.isArray(list)) continue;
      const files = list
        .map((entry) => ({
          path: String(entry?.Path ?? entry?.path ?? entry?.Name ?? entry?.name ?? ''),
          sizeBytes: asNumber(entry?.Size ?? entry?.size)
        }))
        .filter((entry) => entry.path.length > 0 && !entry.path.endsWith('/'));
      return { files, fileCount: files.length };
    } catch {
      // Try the next endpoint shape.
    }
  }
  return null;
}

/**
 * Search ModelScope's OpenAPI.
 * @param {{
 *   query: string,
 *   source: string,
 *   task?: string,
 *   sort?: string,
 *   limit?: number,
 *   config: any,
 *   signal?: AbortSignal,
 *   proxy?: any
 * }} params
 * @returns {Promise<{ source: string, endpoint: string, results: any[] }>}
 */
/**
 * Derive the repository id from one ModelScope record. `Path` is the namespace
 * and `Name` the repository name, but some API versions already put the full
 * id in `Path`; both layouts are accepted.
 * @param {any} item
 * @returns {string}
 */
function modelScopeRepoId(item) {
  const path = typeof item?.Path === 'string' ? item.Path.trim() : '';
  const name = typeof item?.Name === 'string' ? item.Name.trim() : '';
  if (name.includes('/')) return name;
  if (path.includes('/')) return path;
  if (path.length > 0 && name.length > 0) return `${path}/${name}`;
  const fallback = item?.ModelId ?? item?.modelId;
  return typeof fallback === 'string' ? fallback : name;
}

/**
 * Extract task names from ModelScope's `Tasks` field, which is an object, an
 * array of objects, or a string depending on the API version.
 * @param {unknown} value
 * @returns {string[]}
 */
function taskNamesOf(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry : (typeof entry?.Name === 'string' ? entry.Name : '')))
      .filter((entry) => entry.length > 0);
  }
  if (value !== null && typeof value === 'object' && typeof value.Name === 'string') return [value.Name];
  if (typeof value === 'string' && value.length > 0) return [value];
  return [];
}

/**
 * ModelScope timestamps are unix seconds (sometimes milliseconds).
 * @param {unknown} value
 * @returns {string | null}
 */
function modelScopeTimestamp(value) {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return modelScopeTimestamp(numeric);
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const milliseconds = value > 1e12 ? value : value * 1000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function searchModelScope(params) {
  const endpoint = endpointFor('modelscope', params.config);
  const limit = clampInt(params.limit, 8, 1, 50);
  const body = JSON.stringify({
    PageSize: limit,
    PageNumber: 1,
    SortBy: MODELSCOPE_SORTS[params.sort ?? 'downloads'] ?? 'DownloadsCount',
    Name: params.query.trim(),
    Target: '',
    SingleCriterion: [],
    ...(typeof params.task === 'string' && params.task.trim().length > 0 ? { Tasks: [params.task.trim()] } : {})
  });
  const candidates = [`${endpoint}/api/v1/models`, `${endpoint}/api/v1/dolphin/models`];
  /** @type {any[] | null} */
  let items = null;
  /** @type {string} */
  let lastError = '';
  for (const url of candidates) {
    try {
      const response = await httpRequest(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'dsh-open-model/1.0' },
        body,
        timeoutMs: 30_000,
        signal: params.signal,
        proxy: params.proxy
      });
      if (response.status < 200 || response.status >= 300) {
        lastError = `HTTP ${response.status}: ${response.text.slice(0, 300)}`;
        continue;
      }
      const parsed = JSON.parse(response.text);
      const container = parsed?.Data ?? parsed?.data ?? parsed;
      const models = container?.Models ?? container?.Model?.Models ?? container?.models;
      if (Array.isArray(models)) {
        items = models;
        break;
      }
      lastError = 'response did not contain a model list';
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  if (items === null) throw new Error(lastError || `ModelScope search failed at ${endpoint}`);

  const results = [];
  for (const item of items) {
    const repoId = modelScopeRepoId(item);
    if (repoId.length === 0) continue;
    const tags = [...asStringArray(item?.Tags ?? item?.tags), ...asStringArray(item?.Libraries ?? item?.libraries)];
    const taskNames = taskNamesOf(item?.Tasks ?? item?.tasks ?? item?.Task);
    results.push({
      repoId,
      source: 'modelscope',
      downloads: asNumber(item?.Downloads ?? item?.downloads),
      likes: asNumber(item?.Likes ?? item?.likes),
      updatedAt: modelScopeTimestamp(item?.LastUpdatedTime ?? item?.GmtModified ?? item?.UpdatedTime),
      tags: [...new Set([...tags, ...taskNames])],
      pipelineTag: taskNames[0] ?? null,
      gated: item?.Private === true || item?.IsAccessible === 0,
      homepage: `${endpoint}/models/${repoId}`,
      downloadHint: `modelscope:${repoId}`,
      files: [],
      fileCount: 0,
      filesTruncated: false
    });
  }

  const task = params.task?.trim();
  const filtered = task === undefined || task.length === 0
    ? results
    : results.filter((entry) => [entry.pipelineTag, ...entry.tags].some((value) => typeof value === 'string' && value.toLowerCase().includes(task.toLowerCase())));
  const finalResults = filtered.length > 0 || task === undefined || task.length === 0 ? filtered : results;

  // File lists are fetched only for the page actually shown, and never fail the call.
  const withFiles = await Promise.all(finalResults.slice(0, limit).map(async (entry) => {
    const listing = await fetchModelScopeFiles(endpoint, entry.repoId, { signal: params.signal, proxy: params.proxy });
    if (listing === null) return entry;
    const files = listing.files.slice(0, 24);
    return { ...entry, files, fileCount: listing.fileCount, filesTruncated: listing.files.length > files.length };
  }));
  return { source: 'modelscope', endpoint, results: withFiles };
}

/**
 * Dispatch a search to the selected source.
 * @param {{
 *   query: string,
 *   source?: string,
 *   task?: string,
 *   sort?: string,
 *   limit?: number,
 *   config: any,
 *   signal?: AbortSignal,
 *   proxy?: any
 * }} params
 * @returns {Promise<{ source: string, endpoint: string, results: any[] }>}
 */
export async function searchModels(params) {
  const source = resolveSource(params.source, params.config);
  if (source === 'modelscope') return searchModelScope({ ...params, source });
  if (source === 'huggingface' || source === 'hf-mirror') return searchHuggingFace({ ...params, source });
  throw new Error(`unknown source "${source}"`);
}

/**
 * ISO date → `YYYY-MM-DD` for compact display.
 * @param {string | null} iso
 * @returns {string}
 */
export function formatUpdatedAt(iso) {
  if (typeof iso !== 'string' || iso.length === 0) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().slice(0, 10);
}
