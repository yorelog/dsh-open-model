/**
 * Model-facing tool definitions.
 *
 * Every tool returns a structured value plus a `text` field that is already
 * rendered in the active locale, so the same call is equally useful to a
 * programmatic caller and to the conversation the user reads.
 * @module @local/open-model/lib/tools
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { effectiveModelRoots, SOURCES } from './config.js';
import { describeProgress } from './download.js';
import {
  detectGgufFile, detectModelDirectory, prettyModelName, scanModelRoots
} from './scan.js';
import { formatUpdatedAt, resolveSource, searchModels } from './search.js';
import { discoverRuntimes, installLlamaServer, installMlxcel } from './runtime.js';
import { runtimeFor } from './server.js';
import {
  formatBytes, formatDuration, modelIdFor, truncate
} from './util.js';

/** Nullable scalar schema helpers for tool output contracts. */
const nullableString = { oneOf: [{ type: 'string' }, { type: 'null' }] };
const nullableNumber = { oneOf: [{ type: 'number' }, { type: 'null' }] };

/**
 * @param {string} name
 * @param {string} description
 * @param {Record<string, unknown>} parameters
 * @param {Record<string, unknown>} outputSchema
 * @param {(args: any, exec: any) => Promise<any>} execute
 * @param {boolean} [concurrencySafe]
 * @returns {any}
 */
function tool(name, description, parameters, outputSchema, execute, concurrencySafe = false) {
  return {
    name,
    description,
    parameters: {
      type: 'object',
      additionalProperties: false,
      ...parameters
    },
    output: {
      schema: { type: 'object', additionalProperties: false, ...outputSchema },
      render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }]
    },
    ...(concurrencySafe ? { isConcurrencySafe: () => true } : {}),
    execute
  };
}

/**
 * @param {string} source
 * @param {any} config
 * @param {(key: string, vars?: Record<string, string | number>) => string} tt
 * @returns {string}
 */
function assertSource(source, config, tt) {
  const resolved = resolveSource(source, config);
  if (!SOURCES.includes(resolved)) {
    throw new Error(tt('errors.source', { source: String(source ?? '') }));
  }
  return resolved;
}

/**
 * @param {number | null} downloads
 * @returns {string}
 */
function formatCount(downloads) {
  if (downloads === null) return '—';
  return downloads.toLocaleString('en-US');
}

/**
 * Build the compact system-prompt line for one model.
 * @param {any} entry
 * @param {(key: string, vars?: Record<string, string | number>) => string} tt
 * @returns {string}
 */
export function promptModelLine(entry, tt) {
  const loaded = entry.loaded === true
    ? `${tt('common.loaded')}${entry.port === null || entry.port === undefined ? '' : `:${entry.port}`}`
    : tt('common.notLoaded');
  return tt('sys.modelLine', {
    id: entry.id,
    format: tt(`format.${entry.format}`),
    quant: entry.quant,
    loaded
  });
}

/**
 * Detect a path as a registrable model.
 * @param {string} target
 * @returns {Promise<any | null>}
 */
async function detectPath(target) {
  const resolved = path.resolve(target);
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    return null;
  }
  if (stat.isDirectory()) {
    const detected = await detectModelDirectory(resolved);
    if (detected === null) return null;
    return {
      path: resolved,
      displayName: prettyModelName(resolved),
      format: detected.format,
      quant: detected.quant,
      quantEvidence: detected.quantEvidence,
      sizeBytes: detected.sizeBytes,
      basis: detected.basis
    };
  }
  if (/\.gguf$/iu.test(resolved)) {
    const detected = await detectGgufFile(resolved);
    return {
      path: resolved,
      displayName: `${prettyModelName(path.dirname(resolved))}/${path.basename(resolved, path.extname(resolved))}`,
      format: 'gguf',
      quant: detected.quant,
      quantEvidence: detected.quantEvidence,
      sizeBytes: detected.sizeBytes,
      basis: detected.basis
    };
  }
  if (/\.safetensors$/iu.test(resolved)) {
    const dir = path.dirname(resolved);
    const detected = await detectModelDirectory(dir);
    if (detected === null) return null;
    return {
      path: dir,
      displayName: prettyModelName(dir),
      format: detected.format,
      quant: detected.quant,
      quantEvidence: detected.quantEvidence,
      sizeBytes: detected.sizeBytes,
      basis: detected.basis
    };
  }
  return null;
}

/**
 * @param {any} detected
 * @returns {'auto' | 'llama-server' | 'mlxcel-server'}
 */
function preferenceFor(detected) {
  if (detected.format === 'gguf') return 'llama-server';
  if (detected.format === 'mlx') return 'mlxcel-server';
  return 'auto';
}

/**
 * Default download destination under the first effective model root.
 * @param {any} config
 * @param {string} repoId
 * @returns {string}
 */
function defaultDownloadDir(config, repoId) {
  const root = effectiveModelRoots(config)[0];
  const parts = repoId.split('/').filter((part) => part.length > 0);
  const owner = parts.length > 1 ? parts[0] : 'models';
  const name = parts.length > 1 ? parts.slice(1).join('-') : parts[0] ?? 'model';
  return path.join(root, owner, name);
}

/**
 * Register a completed download when its layout is unambiguous.
 * @param {{ localDir: string, source: string, repoId: string }} input
 * @param {{ registry: any, scanCache: Map<string, any> }} deps
 * @returns {Promise<any | null>}
 */
async function autoRegisterDownload(input, deps) {
  const directory = await detectModelDirectory(input.localDir);
  if (directory !== null) {
    const detected = {
      path: input.localDir,
      displayName: prettyModelName(input.localDir),
      format: directory.format,
      quant: directory.quant,
      quantEvidence: directory.quantEvidence,
      sizeBytes: directory.sizeBytes,
      basis: directory.basis
    };
    const { entry } = await deps.registry.register({
      ...detected,
      source: input.source,
      repoId: input.repoId,
      runtimePreference: preferenceFor(detected)
    });
    deps.scanCache.set(entry.id, detected);
    return entry;
  }
  let entries;
  try {
    entries = await fs.readdir(input.localDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const ggufFiles = entries.filter((entry) => entry.isFile() && /\.gguf$/iu.test(entry.name));
  if (ggufFiles.length !== 1) return null;
  const full = path.join(input.localDir, ggufFiles[0].name);
  const detected = await detectGgufFile(full);
  const candidate = {
    path: full,
    displayName: `${prettyModelName(input.localDir)}/${path.basename(full, path.extname(full))}`,
    format: 'gguf',
    quant: detected.quant,
    quantEvidence: detected.quantEvidence,
    sizeBytes: detected.sizeBytes,
    basis: detected.basis
  };
  const { entry } = await deps.registry.register({
    ...candidate,
    source: input.source,
    repoId: input.repoId,
    runtimePreference: 'llama-server'
  });
  deps.scanCache.set(entry.id, candidate);
  return entry;
}

/**
 * Build every tool definition bound to one plugin instance.
 * @param {{
 *   ctx: any,
 *   config: any,
 *   registry: any,
 *   downloads: any,
 *   supervisor: any,
 *   scanCache: Map<string, any>,
 *   getLocale: () => { locale: 'zh'|'en', source: string },
 *   state: { pushRelease: (info: any) => void, recent: (limit?: number) => any[] },
 *   logger?: any
 * }} deps
 * @returns {any[]}
 */
export function createTools(deps) {
  const { config, registry, downloads, supervisor } = deps;

  /** @returns {(key: string, vars?: Record<string, string | number>) => string} */
  const localize = () => deps.getLocale().translate;

  const tools = [];

  tools.push(tool(
    'model_search',
    'Search open models on HuggingFace, the hf-mirror mirror, or ModelScope. Returns repo ids, download counts, tags, the model page URL, a short file list, and a download hint that can be passed straight to model_download.',
    {
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description: 'Search text. An empty string lists the current top models for the source.'
        },
        source: {
          type: 'string',
          enum: ['huggingface', 'hf-mirror', 'modelscope'],
          description: 'Hub to search. Defaults to the plugin defaultSource (hf-mirror out of the box).'
        },
        task: {
          type: 'string',
          description: 'Optional pipeline/task filter such as text-generation, image-text-to-text or feature-extraction.'
        },
        sort: {
          type: 'string',
          enum: ['downloads', 'updated', 'likes', 'trending'],
          description: 'Ranking order. Default downloads.'
        },
        limit: {
          type: 'integer',
          description: 'How many models to return, 1-50. Default 8.'
        }
      }
    },
    {
      properties: {
        text: { type: 'string' },
        source: { type: 'string' },
        endpoint: { type: 'string' },
        count: { type: 'integer' },
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              repoId: { type: 'string' },
              source: { type: 'string' },
              downloads: nullableNumber,
              likes: nullableNumber,
              updatedAt: nullableString,
              pipelineTag: nullableString,
              homepage: { type: 'string' },
              downloadHint: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
              files: { type: 'array', items: { type: 'string' } },
              fileCount: { type: 'integer' },
              filesTruncated: { type: 'boolean' }
            }
          }
        }
      }
    },
    async (args) => {
      const tt = localize();
      const source = assertSource(args?.source, config, tt);
      const query = typeof args?.query === 'string' ? args.query : '';
      const sort = typeof args?.sort === 'string' ? args.sort : 'downloads';
      const task = typeof args?.task === 'string' && args.task.trim().length > 0 ? args.task.trim() : undefined;
      const limit = Number.isInteger(args?.limit) ? args.limit : 8;
      const result = await searchModels({
        query,
        source,
        task,
        sort,
        limit,
        config,
        proxy: config.proxy
      }).catch((error) => {
        throw new Error(tt('search.failed', {
          source: tt(`source.${source}`),
          error: truncate(error instanceof Error ? error.message : String(error), 500)
        }));
      });
      const sourceLabel = tt(`source.${result.source}`);
      const lines = [tt('search.title', {
        count: result.results.length,
        source: sourceLabel,
        endpoint: result.endpoint
      })];
      if (result.results.length === 0) {
        lines.push(tt('search.empty', { query, source: sourceLabel, endpoint: result.endpoint }));
      }
      const payload = [];
      result.results.forEach((entry, index) => {
        const tags = entry.tags.slice(0, 6);
        lines.push(tt('search.line', {
          index: index + 1,
          repoId: entry.repoId,
          downloads: formatCount(entry.downloads),
          likes: formatCount(entry.likes),
          updatedAt: formatUpdatedAt(entry.updatedAt),
          task: entry.pipelineTag === null ? '' : tt('search.task', { task: entry.pipelineTag }),
          tags: tags.length === 0 ? '' : tt('search.tags', { tags: tags.join(', ') })
        }));
        if (entry.files.length > 0) {
          lines.push(tt('search.files', {
            count: entry.fileCount,
            truncated: entry.filesTruncated ? tt('search.filesTruncated', { shown: entry.files.length }) : '',
            files: entry.files.map((file) => file.path).join(', ')
          }));
        } else {
          lines.push(`   ${tt('search.noSiblings')}`);
        }
        lines.push(tt('search.homepage', { url: entry.homepage }));
        lines.push(tt('search.downloadHint', { hint: entry.downloadHint }));
        payload.push({
          repoId: entry.repoId,
          source: entry.source,
          downloads: entry.downloads,
          likes: entry.likes,
          updatedAt: entry.updatedAt,
          pipelineTag: entry.pipelineTag,
          homepage: entry.homepage,
          downloadHint: entry.downloadHint,
          tags: entry.tags.slice(0, 20),
          files: entry.files.map((file) => file.path),
          fileCount: entry.fileCount,
          filesTruncated: entry.filesTruncated
        });
      });
      lines.push('');
      lines.push(tt('search.guidance'));
      return {
        text: lines.join('\n'),
        source: result.source,
        endpoint: result.endpoint,
        count: result.results.length,
        results: payload
      };
    },
    true
  ));

  tools.push(tool(
    'model_download',
    'Download a repository from HuggingFace/hf-mirror or ModelScope into a local model directory. Injecting the mirror endpoint and proxy into the child process, reporting progress, keeping partial files for resume, and registering an unambiguous completed model automatically.',
    {
      required: ['repoId'],
      properties: {
        repoId: {
          type: 'string',
          description: 'Repository id such as Qwen/Qwen2.5-7B-Instruct-GGUF, or a downloadHint value from model_search.'
        },
        source: {
          type: 'string',
          enum: ['huggingface', 'hf-mirror', 'modelscope'],
          description: 'Source hub. Defaults to the plugin defaultSource.'
        },
        revision: {
          type: 'string',
          description: 'Branch, tag or commit. Defaults to the repository default branch.'
        },
        include: {
          type: 'string',
          description: 'Single glob selecting files, for example *Q4_K_M.gguf. The CLIs resume within the same directory.'
        },
        localDir: {
          type: 'string',
          description: 'Absolute destination directory. Defaults to <first model root>/<owner>/<name>.'
        },
        background: {
          type: 'boolean',
          description: 'Return immediately with a download id instead of waiting; poll model_download_status.'
        }
      }
    },
    {
      properties: {
        text: { type: 'string' },
        status: { type: 'string' },
        downloadId: { type: 'string' },
        repoId: { type: 'string' },
        source: { type: 'string' },
        method: nullableString,
        localDir: { type: 'string' },
        files: { type: 'array', items: { type: 'string' } },
        totalBytes: nullableNumber,
        elapsedMs: { type: 'integer' },
        registeredId: nullableString
      }
    },
    async (args, exec) => {
      const tt = localize();
      const source = assertSource(args?.source, config, tt);
      const repoId = typeof args?.repoId === 'string' ? args.repoId.trim() : '';
      if (repoId.length === 0) throw new Error(tt('register.missingArg'));
      const localDir = typeof args?.localDir === 'string' && args.localDir.trim().length > 0
        ? path.resolve(args.localDir.trim())
        : defaultDownloadDir(config, repoId);
      const background = args?.background === true;
      const startedAt = Date.now();
      const task = await downloads.start({
        repoId,
        source,
        revision: typeof args?.revision === 'string' && args.revision.trim().length > 0 ? args.revision.trim() : undefined,
        include: typeof args?.include === 'string' && args.include.trim().length > 0 ? args.include.trim() : undefined,
        localDir,
        ...(background ? {} : { signal: exec.signal })
      }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (/no download CLI|Python SDK/iu.test(message)) throw new Error(tt('download.noTooling'));
        throw new Error(tt('download.failed', { error: message }));
      });
      if (background) {
        return {
          text: tt('download.background', { id: task.id }) + '\n' + tt('download.cliPreferred', {
            method: tt(`download.method.${task.method ?? 'auto'}`)
          }),
          status: task.state,
          downloadId: task.id,
          repoId,
          source,
          method: task.method,
          localDir: task.localDir,
          files: [],
          totalBytes: task.totalBytes,
          elapsedMs: Date.now() - startedAt,
          registeredId: null
        };
      }
      const finished = await downloads.wait(task.id) ?? task;
      if (finished.state === 'failed') {
        throw new Error(tt('download.failed', { error: truncate(finished.error ?? 'unknown', 600) }));
      }
      if (finished.state === 'cancelled') {
        throw new Error(tt('download.cancelled'));
      }
      let registeredId = null;
      const auto = await autoRegisterDownload({ localDir: finished.localDir, source, repoId }, deps).catch(() => null);
      if (auto !== null) registeredId = auto.id;
      const lines = [
        tt('download.done', {
          elapsed: formatDuration((Date.now() - Date.parse(finished.startedAt)) / 1000),
          size: formatBytes(finished.bytes)
        }),
        tt('download.cliPreferred', { method: tt(`download.method.${finished.method ?? 'auto'}`) }),
        `${tt('download.status.dir', { dir: finished.localDir })}`,
        tt('download.resume')
      ];
      if (registeredId !== null) {
        lines.push(tt('register.done', {
          id: registeredId,
          format: tt('format.gguf'),
          quant: registry.get(registeredId)?.quant ?? 'unknown',
          path: finished.localDir
        }));
      } else {
        lines.push(tt('scan.next'));
      }
      return {
        text: lines.join('\n'),
        status: finished.state,
        downloadId: finished.id,
        repoId,
        source,
        method: finished.method,
        localDir: finished.localDir,
        files: finished.files.slice(0, 100),
        totalBytes: finished.totalBytes ?? finished.bytes,
        elapsedMs: Date.now() - startedAt,
        registeredId
      };
    }
  ));

  tools.push(tool(
    'model_download_status',
    'Report progress (bytes, speed, ETA) for downloads started by this plugin, and cancel an active download by id while keeping its partial files for resume.',
    {
      properties: {
        downloadId: {
          type: 'string',
          description: 'One download id. Omit to list every download in this plugin instance.'
        },
        cancel: {
          type: 'boolean',
          description: 'Cancel the given download. Partial files stay on disk.'
        }
      }
    },
    {
      properties: {
        text: { type: 'string' },
        downloads: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              repoId: { type: 'string' },
              source: { type: 'string' },
              state: { type: 'string' },
              bytes: { type: 'number' },
              totalBytes: nullableNumber,
              speedBps: nullableNumber,
              etaSeconds: nullableNumber,
              startedAt: { type: 'string' },
              finishedAt: nullableString,
              localDir: { type: 'string' },
              error: nullableString
            }
          }
        }
      }
    },
    async (args) => {
      const tt = localize();
      const id = typeof args?.downloadId === 'string' ? args.downloadId.trim() : '';
      const lines = [];
      let cancelled = false;
      if (args?.cancel === true) {
        if (id.length === 0) throw new Error(tt('download.status.cancelUnknown', { id: '—' }));
        cancelled = downloads.cancel(id);
        lines.push(cancelled ? tt('download.status.cancelDone', { id }) : tt('download.status.cancelUnknown', { id }));
      }
      const listed = downloads.list().filter((task) => id.length === 0 || task.id === id);
      lines.push(tt('download.status.title', { count: listed.length }));
      if (listed.length === 0) lines.push(tt('download.status.empty'));
      for (const task of listed) {
        lines.push(describeProgress(task, tt));
        lines.push(tt('download.status.dir', { dir: task.localDir }));
        if (task.error !== null && task.error !== undefined) lines.push(tt('download.status.error', { error: task.error }));
      }
      return {
        text: lines.join('\n'),
        downloads: listed.map((task) => ({
          id: task.id,
          repoId: task.repoId,
          source: task.source,
          state: task.state,
          bytes: task.bytes,
          totalBytes: task.totalBytes,
          speedBps: task.speedBps,
          etaSeconds: task.etaSeconds,
          startedAt: task.startedAt,
          finishedAt: task.finishedAt,
          localDir: task.localDir,
          error: task.error
        }))
      };
    },
    true
  ));

  tools.push(tool(
    'model_scan',
    'Scan the configured model roots (default ${DSH_HOME}/models) for GGUF files and MLX/safetensors model directories. Format and quantization are read from file headers and sibling metadata, not guessed from names. Returns registered and not-yet-registered candidates.',
    {
      properties: {
        roots: {
          type: 'array',
          items: { type: 'string' },
          description: 'Directories to scan instead of the configured modelRoots.'
        },
        maxDepth: {
          type: 'integer',
          description: 'Directory recursion depth, 1-12. Defaults to the scanDepth config.'
        }
      }
    },
    {
      properties: {
        text: { type: 'string' },
        roots: { type: 'array', items: { type: 'string' } },
        newCount: { type: 'integer' },
        warnings: { type: 'array', items: { type: 'string' } },
        discovered: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              displayName: { type: 'string' },
              path: { type: 'string' },
              format: { type: 'string' },
              quant: { type: 'string' },
              quantEvidence: { type: 'string' },
              sizeBytes: { type: 'number' },
              runtimePreference: { type: 'string' },
              registered: { type: 'boolean' },
              warning: nullableString
            }
          }
        }
      }
    },
    async (args) => {
      const tt = localize();
      const roots = Array.isArray(args?.roots) && args.roots.length > 0
        ? args.roots.map((root) => String(root))
        : effectiveModelRoots(config);
      const maxDepth = Number.isInteger(args?.maxDepth) ? args.maxDepth : config.scanDepth;
      const scan = await scanModelRoots(roots, { maxDepth });
      const discovered = [];
      let newCount = 0;
      for (const candidate of scan.candidates) {
        const registered = registry.findByPath(candidate.path);
        const id = registered?.id ?? modelIdFor(candidate.displayName, candidate.path);
        if (registered === undefined) {
          newCount += 1;
          deps.scanCache.set(id, candidate);
        }
        const warning = candidate.warning !== undefined
          ? tt('scan.warning', {
            message: candidate.warning.startsWith('mmproj')
              ? tt('scan.warn.mmproj')
              : tt('scan.warn.header', { detail: truncate(candidate.warning.replace(/^gguf-header-unreadable:/u, ''), 160) })
          })
          : null;
        discovered.push({
          id,
          displayName: candidate.displayName,
          path: candidate.path,
          format: candidate.format,
          quant: candidate.quant,
          quantEvidence: candidate.quantEvidence,
          sizeBytes: candidate.sizeBytes,
          runtimePreference: registered?.runtimePreference ?? preferenceFor(candidate),
          registered: registered !== undefined,
          warning
        });
      }
      for (const missing of scan.missingRoots) {
        scan.warnings.push(tt('scan.rootMissing', { root: missing }));
      }
      const lines = [tt('scan.title', {
        roots: roots.join(', '),
        count: discovered.length,
        newCount
      })];
      if (discovered.length === 0) lines.push(tt('scan.empty', { roots: roots.join(', ') }));
      discovered.forEach((entry, index) => {
        lines.push(tt('scan.line', {
          index: index + 1,
          format: tt(`format.${entry.format}`),
          quant: entry.quant,
          size: formatBytes(entry.sizeBytes),
          path: entry.path,
          registered: entry.registered ? tt('scan.registered', { id: entry.id }) : tt('scan.unregistered'),
          evidence: tt('scan.evidence', { evidence: tt(`evidence.${entry.quantEvidence}`) })
        }));
        if (entry.warning !== null) lines.push(`   ${entry.warning}`);
      });
      if (newCount > 0) lines.push(tt('scan.next'));
      for (const warning of scan.warnings) lines.push(tt('scan.warning', { message: warning }));
      return {
        text: lines.join('\n'),
        roots,
        newCount,
        warnings: scan.warnings,
        discovered
      };
    },
    true
  ));

  tools.push(tool(
    'model_register',
    'Write a discovered or downloaded model into the local registry so it appears in the session prompt and can be started with model_load. Accepts a path or an id returned by model_scan.',
    {
      properties: {
        modelId: {
          type: 'string',
          description: 'Id from model_scan, or an existing registry id to refresh.'
        },
        path: {
          type: 'string',
          description: 'Path to a .gguf file or a model directory containing config.json and weights.'
        },
        displayName: {
          type: 'string',
          description: 'Optional human-readable name override.'
        },
        runtimePreference: {
          type: 'string',
          enum: ['auto', 'llama-server', 'mlxcel-server'],
          description: 'Runtime to prefer for this model. Defaults by format.'
        },
        source: {
          type: 'string',
          description: 'Source label recorded on the entry, for example hf-mirror or modelscope.'
        },
        repoId: {
          type: 'string',
          description: 'Repository id recorded on the entry.'
        }
      }
    },
    {
      properties: {
        text: { type: 'string' },
        created: { type: 'boolean' },
        entry: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            displayName: { type: 'string' },
            source: { type: 'string' },
            repoId: nullableString,
            format: { type: 'string' },
            quant: { type: 'string' },
            path: { type: 'string' },
            sizeBytes: { type: 'number' },
            runtimePreference: { type: 'string' },
            lastUsedAt: nullableString,
            loaded: { type: 'boolean' }
          }
        }
      }
    },
    async (args) => {
      const tt = localize();
      const requestedPath = typeof args?.path === 'string' && args.path.trim().length > 0 ? path.resolve(args.path.trim()) : '';
      const requestedId = typeof args?.modelId === 'string' ? args.modelId.trim() : '';
      /** @type {any | null} */
      let detected = null;
      let existing = requestedId.length > 0 ? registry.get(requestedId) : undefined;
      if (requestedPath.length > 0) {
        detected = await detectPath(requestedPath);
        if (detected === null) throw new Error(tt('register.notFound', { path: requestedPath, id: requestedId }));
        existing = existing ?? registry.findByPath(detected.path);
      } else if (requestedId.length > 0) {
        if (existing !== undefined) {
          detected = await detectPath(existing.path);
        } else {
          const candidate = deps.scanCache.get(requestedId);
          if (candidate === undefined) throw new Error(tt('register.notFound', { path: '—', id: requestedId }));
          detected = candidate;
        }
      } else {
        throw new Error(tt('register.missingArg'));
      }
      if (detected === null) throw new Error(tt('register.notFound', { path: requestedPath, id: requestedId }));
      const preference = args?.runtimePreference === 'llama-server' || args?.runtimePreference === 'mlxcel-server'
        ? args.runtimePreference
        : (existing?.runtimePreference ?? preferenceFor(detected));
      const { entry, created } = await registry.register({
        ...detected,
        id: existing?.id ?? detected.id,
        displayName: typeof args?.displayName === 'string' && args.displayName.trim().length > 0
          ? args.displayName.trim()
          : (existing?.displayName ?? detected.displayName),
        source: typeof args?.source === 'string' && args.source.trim().length > 0
          ? args.source.trim()
          : (existing?.source ?? 'local'),
        repoId: typeof args?.repoId === 'string' && args.repoId.trim().length > 0
          ? args.repoId.trim()
          : (existing?.repoId ?? null),
        runtimePreference: preference,
        lastUsedAt: existing?.lastUsedAt ?? null
      });
      deps.scanCache.set(entry.id, detected);
      const text = created
        ? tt('register.done', {
          id: entry.id,
          format: tt(`format.${entry.format}`),
          quant: entry.quant,
          path: entry.path
        }) + '\n' + tt('register.next', { id: entry.id })
        : tt('register.updated', { id: entry.id }) + '\n' + tt('register.next', { id: entry.id });
      return {
        text,
        created,
        entry: {
          id: entry.id,
          displayName: entry.displayName,
          source: entry.source,
          repoId: entry.repoId,
          format: entry.format,
          quant: entry.quant,
          path: entry.path,
          sizeBytes: entry.sizeBytes,
          runtimePreference: entry.runtimePreference,
          lastUsedAt: entry.lastUsedAt,
          loaded: entry.loaded
        }
      };
    }
  ));

  tools.push(tool(
    'model_load',
    'Start the local inference server for a registered model. Windows GGUF models use llama-server; Apple Silicon MLX/safetensors models use mlxcel-server. Reuses an already loaded server. The PID, port and timestamps are recorded in the registry.',
    {
      required: ['modelId'],
      properties: {
        modelId: {
          type: 'string',
          description: 'Registered model id from model_register or model_scan.'
        },
        port: {
          type: 'integer',
          description: 'Optional fixed port; by default a free loopback port is allocated.'
        },
        timeoutMs: {
          type: 'integer',
          description: 'Startup health timeout in milliseconds. Defaults to the loadTimeoutMs config.'
        }
      }
    },
    {
      properties: {
        text: { type: 'string' },
        modelId: { type: 'string' },
        runtime: nullableString,
        pid: nullableNumber,
        port: nullableNumber,
        baseUrl: nullableString,
        startedAt: nullableString,
        alreadyLoaded: { type: 'boolean' },
        version: nullableString
      }
    },
    async (args) => {
      const tt = localize();
      const modelId = typeof args?.modelId === 'string' ? args.modelId.trim() : '';
      if (modelId.length === 0) throw new Error(tt('errors.badArgs', { message: 'modelId is required' }));
      const entry = registry.get(modelId);
      if (entry === undefined) throw new Error(tt('errors.entryMissing', { modelId }));
      try {
        const loaded = await supervisor.load(modelId, {
          port: Number.isInteger(args?.port) ? args.port : undefined,
          timeoutMs: Number.isInteger(args?.timeoutMs) ? args.timeoutMs : undefined
        });
        const text = loaded.alreadyLoaded
          ? tt('load.already', { modelId: loaded.modelId, port: loaded.port, pid: loaded.pid })
          : tt('load.ready', {
            modelId: loaded.modelId,
            runtime: tt(`runtime.${loaded.runtime === 'mlxcel-server' ? 'mlxcel' : 'llama'}`),
            baseUrl: loaded.baseUrl,
            pid: loaded.pid,
            elapsed: formatDuration((Date.now() - Date.parse(loaded.startedAt)) / 1000)
          });
        return {
          text,
          modelId: loaded.modelId,
          runtime: loaded.runtime,
          pid: loaded.pid,
          port: loaded.port,
          baseUrl: loaded.baseUrl,
          startedAt: loaded.startedAt,
          alreadyLoaded: loaded.alreadyLoaded === true,
          version: loaded.version ?? null
        };
      } catch (error) {
        if (error?.code === 'UNSUPPORTED_RUNTIME') {
          throw new Error(tt('load.unsupported', {
            format: tt(`format.${entry.format}`),
            platform: process.platform,
            arch: process.arch
          }));
        }
        if (error?.code === 'RUNTIME_MISSING') {
          throw new Error(tt('load.runtimeMissing', {
            runtime: tt(`runtime.${String(error.runtime).includes('mlxcel') ? 'mlxcel' : 'llama'}`)
          }));
        }
        if (error?.code === 'LOAD_TIMEOUT') {
          throw new Error(tt('load.timeout', {
            seconds: Math.round((Number.isFinite(args?.timeoutMs) ? args.timeoutMs : config.loadTimeoutMs) / 1000),
            output: truncate(String(error.output ?? ''), 800)
          }));
        }
        if (error?.code === 'LOAD_EXITED') {
          throw new Error(tt('load.exit', {
            runtime: tt(`runtime.${runtimeFor(entry) === 'mlxcel-server' ? 'mlxcel' : 'llama'}`),
            code: error.exitCode === null || error.exitCode === undefined ? 'unknown' : error.exitCode,
            output: truncate(String(error.output ?? ''), 800)
          }));
        }
        throw new Error(tt('load.failed', {
          runtime: tt(`runtime.${runtimeFor(entry) === 'mlxcel-server' ? 'mlxcel' : 'llama'}`),
          error: error instanceof Error ? error.message : String(error)
        }));
      }
    }
  ));

  tools.push(tool(
    'model_unload',
    'Stop the local inference server for a registered model: a graceful signal first, then a forced kill after the configured grace period. Frees GPU/CPU memory immediately.',
    {
      required: ['modelId'],
      properties: {
        modelId: { type: 'string', description: 'Registered model id.' },
        force: {
          type: 'boolean',
          description: 'Skip the graceful grace period and kill immediately.'
        }
      }
    },
    {
      properties: {
        text: { type: 'string' },
        modelId: { type: 'string' },
        stopped: { type: 'boolean' },
        wasLoaded: { type: 'boolean' },
        pid: nullableNumber,
        port: nullableNumber,
        graceful: { type: 'boolean' },
        forced: { type: 'boolean' }
      }
    },
    async (args) => {
      const tt = localize();
      const modelId = typeof args?.modelId === 'string' ? args.modelId.trim() : '';
      if (modelId.length === 0) throw new Error(tt('errors.badArgs', { message: 'modelId is required' }));
      const result = await supervisor.unload(modelId, { force: args?.force === true });
      if (result.unknown === true) {
        return {
          text: tt('unload.unknown', { modelId }),
          modelId,
          stopped: false,
          wasLoaded: false,
          pid: null,
          port: null,
          graceful: false,
          forced: false
        };
      }
      if (result.stopped !== true) {
        return {
          text: tt('unload.notLoaded', { modelId }),
          modelId,
          stopped: false,
          wasLoaded: false,
          pid: null,
          port: null,
          graceful: false,
          forced: false
        };
      }
      const text = result.forced === true
        ? tt('unload.forced', { modelId })
        : tt('unload.done', { modelId, pid: result.pid });
      return {
        text,
        modelId,
        stopped: true,
        wasLoaded: true,
        pid: result.pid,
        port: result.port,
        graceful: result.graceful === true,
        forced: result.forced === true
      };
    }
  ));

  tools.push(tool(
    'model_infer',
    'Send one OpenAI-compatible request to a loaded local model (chat completions, or completions when prompt is given). Every call refreshes lastUsedAt, which is what keeps the idle reaper from stopping the server.',
    {
      required: ['modelId'],
      properties: {
        modelId: { type: 'string', description: 'Registered model id that is already loaded.' },
        prompt: {
          type: 'string',
          description: 'Single-turn completion prompt. Mutually exclusive with messages.'
        },
        messages: {
          type: 'array',
          description: 'Chat messages in OpenAI format. Mutually exclusive with prompt.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['role', 'content'],
            properties: {
              role: { type: 'string' },
              content: { type: 'string' }
            }
          }
        },
        system: {
          type: 'string',
          description: 'Optional system message prepended to messages.'
        },
        temperature: {
          type: 'number',
          description: 'Sampling temperature. Default 0.7.'
        },
        maxTokens: {
          type: 'integer',
          description: 'Maximum tokens to generate.'
        },
        timeoutMs: {
          type: 'integer',
          description: 'Request timeout in milliseconds. Defaults to the requestTimeoutMs config.'
        }
      }
    },
    {
      properties: {
        text: { type: 'string' },
        modelId: { type: 'string' },
        content: { type: 'string' },
        finishReason: nullableString,
        elapsedMs: { type: 'integer' },
        lastUsedAt: nullableString,
        usage: {
          type: 'object',
          properties: {
            promptTokens: nullableNumber,
            completionTokens: nullableNumber,
            totalTokens: nullableNumber
          }
        }
      }
    },
    async (args, exec) => {
      const tt = localize();
      const modelId = typeof args?.modelId === 'string' ? args.modelId.trim() : '';
      if (modelId.length === 0) throw new Error(tt('errors.badArgs', { message: 'modelId is required' }));
      const hasPrompt = typeof args?.prompt === 'string' && args.prompt.length > 0;
      const hasMessages = Array.isArray(args?.messages) && args.messages.length > 0;
      if (hasPrompt === hasMessages) {
        throw new Error(tt('errors.badArgs', { message: 'provide exactly one of prompt or messages' }));
      }
      const entry = registry.get(modelId);
      if (entry === undefined) throw new Error(tt('errors.entryMissing', { modelId }));
      try {
        const result = await supervisor.infer(modelId, {
          prompt: hasPrompt ? args.prompt : undefined,
          messages: hasMessages
            ? args.messages
              .filter((message) => message !== null && typeof message === 'object')
              .map((message) => ({ role: String(message.role), content: String(message.content) }))
            : undefined,
          system: typeof args?.system === 'string' ? args.system : undefined,
          temperature: typeof args?.temperature === 'number' ? args.temperature : undefined,
          maxTokens: Number.isInteger(args?.maxTokens) ? args.maxTokens : undefined,
          timeoutMs: Number.isInteger(args?.timeoutMs) ? args.timeoutMs : undefined,
          signal: exec.signal
        });
        const usage = result.usage;
        const tokens = usage.totalTokens ?? (usage.promptTokens !== null && usage.completionTokens !== null
          ? usage.promptTokens + usage.completionTokens
          : null);
        const header = tt('infer.done', {
          modelId,
          elapsed: formatDuration(result.elapsedMs / 1000),
          tokens: tokens === null ? '—' : tokens
        });
        const refreshed = registry.get(modelId);
        return {
          text: `${header}\n\n${result.content}`,
          modelId,
          content: result.content,
          finishReason: result.finishReason,
          elapsedMs: result.elapsedMs,
          lastUsedAt: refreshed?.lastUsedAt ?? null,
          usage
        };
      } catch (error) {
        if (error?.code === 'NOT_LOADED') throw new Error(tt('infer.notLoaded', { modelId }));
        if (error?.code === 'SERVER_DEAD') {
          throw new Error(tt('infer.dead', { modelId, port: entry.port ?? '—' }));
        }
        throw new Error(tt('infer.failed', { error: error instanceof Error ? error.message : String(error) }));
      }
    },
    true
  ));

  tools.push(tool(
    'runtime_status',
    'Report the inference runtimes for this platform: availability, executable path, version, source, missing CUDA DLLs on Windows, mlxcel support on Apple Silicon, and the registered models with their loaded state.',
    {
      properties: {
        verify: {
          type: 'boolean',
          description: 'Run the executables to confirm their version. Default true.'
        }
      }
    },
    {
      properties: {
        text: { type: 'string' },
        platform: { type: 'string' },
        arch: { type: 'string' },
        locale: { type: 'string' },
        localeSource: { type: 'string' },
        supported: {
          type: 'object',
          properties: {
            llamaServer: { type: 'boolean' },
            mlxcel: { type: 'boolean' }
          }
        },
        runtimes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              available: { type: 'boolean' },
              path: nullableString,
              version: nullableString,
              source: nullableString,
              missing: { type: 'array', items: { type: 'string' } },
              cuda: { type: 'boolean' }
            }
          }
        },
        models: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              format: { type: 'string' },
              quant: { type: 'string' },
              loaded: { type: 'boolean' },
              port: nullableNumber
            }
          }
        },
        registryPath: { type: 'string' }
      }
    },
    async (args) => {
      const tt = localize();
      const { locale, source } = deps.getLocale();
      const { discoverRuntimes } = await import('./runtime.js');
      const discovery = await discoverRuntimes(config, { verify: args?.verify !== false });
      const runtimes = [discovery.llama, discovery.mlxcel];
      const supportedLlama = process.platform === 'win32';
      const supportedMlxcel = process.platform === 'darwin' && process.arch === 'arm64';
      const lines = [tt('runtime.status.title', { platform: process.platform, arch: process.arch, locale })];
      const available = runtimes.filter((runtime) => runtime.available).map((runtime) => runtime.name);
      lines.push(available.length > 0
        ? tt('runtime.status.supported', { list: available.join(', ') })
        : tt('runtime.status.none'));
      for (const runtime of runtimes) {
        const name = tt(`runtime.${runtime.name === 'mlxcel-server' ? 'mlxcel' : 'llama'}`);
        lines.push(tt('runtime.status.line', {
          name,
          state: runtime.available ? tt('runtime.status.stateOk') : tt('runtime.status.stateMissing'),
          version: runtime.version === null || runtime.version === undefined ? '' : tt('runtime.status.version', { version: runtime.version }),
          path: runtime.path === null || runtime.path === undefined ? '' : tt('runtime.status.path', { path: runtime.path }),
          missing: Array.isArray(runtime.missing) && runtime.missing.length > 0
            ? tt('runtime.status.missing', { list: runtime.missing.join(', ') })
            : ''
        }));
      }
      if (process.platform === 'win32' && discovery.llama.available) {
        const missing = discovery.llama.missing ?? [];
        const cuda = discovery.llama.cuda === true;
        lines.push(tt('runtime.status.cuda', {
          state: cuda
            ? (missing.length === 0
              ? tt('runtime.status.cudaOk')
              : tt('runtime.status.cudaMissing', { list: missing.join(', '), exe: discovery.llama.path }))
            : tt('runtime.status.cudaNotCuda')
        }));
      }
      if (process.platform === 'darwin' && !supportedMlxcel) {
        lines.push(tt('runtime.status.mlxcelUnsupported', { arch: process.arch }));
      }
      if (process.platform !== 'darwin') lines.push(tt('runtime.status.mlxcelLinux'));
      const models = registry.list();
      const loadedCount = models.filter((entry) => entry.loaded === true).length;
      lines.push(models.length > 0
        ? tt('runtime.status.models', { count: models.length, loaded: loadedCount })
        : tt('runtime.status.modelsNone'));
      for (const entry of models) {
        lines.push(tt('runtime.status.modelLine', {
          id: entry.id,
          format: tt(`format.${entry.format}`),
          quant: entry.quant,
          loaded: entry.loaded === true ? tt('common.loaded') : tt('common.notLoaded'),
          port: entry.loaded === true && Number.isInteger(entry.port)
            ? tt('runtime.status.port', { port: entry.port })
            : ''
        }));
      }
      lines.push(tt('runtime.status.registry', { path: registry.file }));
      const recent = deps.state.recent(5);
      if (recent.length > 0) {
        lines.push(tt('runtime.status.recent', {
          items: recent.map((item) => tt('runtime.status.released', { id: item.modelId, at: item.at })).join('; ')
        }));
      }
      return {
        text: lines.join('\n'),
        platform: process.platform,
        arch: process.arch,
        locale,
        localeSource: source,
        supported: { llamaServer: supportedLlama, mlxcel: supportedMlxcel },
        runtimes: runtimes.map((runtime) => ({
          name: runtime.name,
          available: runtime.available === true,
          path: runtime.path ?? null,
          version: runtime.version ?? null,
          source: runtime.source ?? null,
          missing: Array.isArray(runtime.missing) ? runtime.missing : [],
          cuda: runtime.cuda === true
        })),
        models: models.map((entry) => ({
          id: entry.id,
          format: entry.format,
          quant: entry.quant,
          loaded: entry.loaded === true,
          port: Number.isInteger(entry.port) ? entry.port : null
        })),
        registryPath: registry.file
      };
    },
    true
  ));

  tools.push(tool(
    'runtime_install',
    'Install or refresh an inference runtime. Windows installs llama-server from the llama.cpp releases (CPU, CUDA plus cudart, or Vulkan). Apple Silicon installs mlxcel through Homebrew first, then the GitHub release archive. GitHub proxy prefixes come only from config or this argument.',
    {
      properties: {
        runtime: {
          type: 'string',
          enum: ['auto', 'llama-server', 'mlxcel'],
          description: 'Which runtime to install. auto follows the platform.'
        },
        backend: {
          type: 'string',
          enum: ['auto', 'cpu', 'cuda', 'vulkan'],
          description: 'Windows llama.cpp backend. auto picks CUDA when nvidia-smi exists, otherwise CPU.'
        },
        method: {
          type: 'string',
          enum: ['auto', 'brew', 'binary'],
          description: 'mlxcel installation method. auto prefers Homebrew.'
        },
        proxyPrefix: {
          type: 'string',
          description: 'GitHub download proxy prefix for this call, for example the deployment you verified. Overrides githubProxyPrefix.'
        },
        dryRun: {
          type: 'boolean',
          description: 'Resolve the plan and commands without downloading anything.'
        }
      }
    },
    {
      properties: {
        text: { type: 'string' },
        ok: { type: 'boolean' },
        runtime: { type: 'string' },
        reason: nullableString,
        version: nullableString,
        executable: nullableString,
        installDir: nullableString,
        backend: nullableString,
        dryRun: { type: 'boolean' },
        viaProxy: { type: 'boolean' },
        assets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              url: { type: 'string' },
              sizeBytes: nullableNumber
            }
          }
        },
        commands: { type: 'array', items: { type: 'string' } }
      }
    },
    async (args, exec) => {
      const tt = localize();
      const requested = args?.runtime === 'llama-server' || args?.runtime === 'mlxcel'
        ? args.runtime
        : 'auto';
      const runtime = requested === 'auto'
        ? (process.platform === 'darwin' ? 'mlxcel' : 'llama-server')
        : requested;
      const dryRun = args?.dryRun === true;
      const common = {
        config,
        backend: typeof args?.backend === 'string' ? args.backend : config.backend,
        method: typeof args?.method === 'string' ? args.method : 'auto',
        proxyPrefix: typeof args?.proxyPrefix === 'string' ? args.proxyPrefix : undefined,
        dryRun,
        signal: exec.signal,
        log: (message) => deps.logger?.info?.(message)
      };
      const result = runtime === 'mlxcel'
        ? await installMlxcel(common).catch((error) => ({
          ok: false,
          runtime: 'mlxcel',
          reason: 'failed',
          error: error instanceof Error ? error.message : String(error)
        }))
        : await installLlamaServer(common).catch((error) => ({
          ok: false,
          runtime: 'llama-server',
          reason: 'failed',
          error: error instanceof Error ? error.message : String(error)
        }));
      const lines = [];
      if (result.ok !== true) {
        if (result.reason === 'failed') {
          lines.push(tt('runtime.install.failed', { error: truncate(String(result.error ?? ''), 600) }));
        } else if (result.reason === 'unsupported-platform') {
          lines.push(tt('runtime.install.unsupportedPlatform', {
            runtime: runtime === 'mlxcel' ? tt('runtime.mlxcel') : tt('runtime.llama'),
            platform: process.platform,
            arch: process.arch
          }));
        } else if (result.reason === 'intel-mac') {
          lines.push(tt('runtime.install.intel', { arch: process.arch }));
        } else if (result.reason === 'no-release') {
          lines.push(tt('runtime.install.noRelease', { runtime: runtime === 'mlxcel' ? 'mlxcel' : 'llama.cpp' }));
        } else if (result.reason === 'checksum-mismatch') {
          lines.push(tt('runtime.install.reasonChecksum'));
        } else if (result.reason === 'incomplete-archive') {
          lines.push(tt('runtime.install.reasonIncomplete'));
        } else if (result.reason === 'brew-failed') {
          lines.push(tt('runtime.install.reasonBrewFailed', { error: truncate(String(result.error ?? ''), 400) }));
        } else {
          lines.push(tt('errors.notSupported', { feature: runtime, platform: process.platform }));
        }
        return {
          text: lines.join('\n'),
          ok: false,
          runtime: result.runtime ?? runtime,
          reason: result.reason ?? null,
          version: null,
          executable: null,
          installDir: null,
          backend: null,
          dryRun,
          viaProxy: false,
          assets: [],
          commands: []
        };
      }
      if (dryRun) {
        const assets = Array.isArray(result.assets) ? result.assets : [];
        const commands = Array.isArray(result.commands) ? result.commands : [];
        lines.push(tt('runtime.install.resolving', {
          runtime: runtime === 'mlxcel' ? tt('runtime.mlxcel') : tt('runtime.llama'),
          platform: process.platform,
          arch: process.arch
        }));
        if (result.release !== undefined) lines.push(`   release: ${result.release}`);
        for (const asset of assets) {
          lines.push(tt('runtime.install.downloading', {
            name: asset.name,
            size: asset.sizeBytes === null || asset.sizeBytes === undefined ? '—' : formatBytes(asset.sizeBytes)
          }));
        }
        if (commands.length > 0) lines.push(tt('runtime.install.plan', { commands: commands.join(' && ') }));
        lines.push(tt('runtime.install.dryRun'));
      } else {
        if (result.viaProxy === true) lines.push(tt('runtime.install.proxyRetry', { error: 'direct attempt failed' }));
        if (result.method === 'brew') lines.push(tt('runtime.install.brew', { commands: 'brew tap lablup/tap && brew install mlxcel' }));
        if (result.installDir !== undefined) {
          lines.push(tt('runtime.install.done', {
            runtime: runtime === 'mlxcel' ? tt('runtime.mlxcel') : tt('runtime.llama'),
            version: result.version ?? '—',
            path: result.executable ?? result.installDir
          }));
        }
        if (result.method === 'binary') lines.push(tt('runtime.install.layout'));
        if (result.version === null || result.version === undefined) {
          lines.push(tt('runtime.install.verifyFailed', { command: '--version', error: 'no version output' }));
        } else {
          lines.push(tt('runtime.install.verify', { command: '--version', version: result.version }));
        }
      }
      if (result.backend === 'cuda' && result.cudartMissing === true) {
        lines.push(tt('runtime.install.cudartMissing', {
          tag: String(result.release ?? '—'),
          backend: 'cuda'
        }));
      }
      const assets = Array.isArray(result.assets)
        ? result.assets.map((asset) => ({
          name: String(asset.name ?? ''),
          url: String(asset.url ?? ''),
          sizeBytes: typeof asset.sizeBytes === 'number' ? asset.sizeBytes : null
        }))
        : [];
      return {
        text: lines.join('\n'),
        ok: result.ok === true,
        runtime: result.runtime ?? runtime,
        reason: result.reason ?? null,
        version: result.version ?? null,
        executable: result.executable ?? null,
        installDir: result.installDir ?? null,
        backend: result.backend ?? null,
        dryRun,
        viaProxy: result.viaProxy === true,
        assets,
        commands: Array.isArray(result.commands) ? result.commands : []
      };
    }
  ));

  return tools;
}

/**
 * Build the system-prompt section text for the current registry snapshot.
 * @param {{
 *   config: any,
 *   registry: any,
 *   tooling: any,
 *   state: { recent: (limit?: number) => any[] },
 *   translate: (key: string, vars?: Record<string, string | number>) => string
 * }} deps
 * @returns {string}
 */
export function promptSectionText(deps) {
  const tt = deps.translate;
  // Stay silent until the first disk read finishes: an empty snapshot at
  // activation must not tell the model there are no models.
  if (typeof deps.registry.isLoaded === 'function' && deps.registry.isLoaded() === false) return '';
  const models = deps.registry.list();
  /** @type {string[]} */
  const lines = [];
  const recent = deps.state.recent(3);
  if (models.length === 0) {
    lines.push(tt('sys.sectionHeader'));
    lines.push(tt('sys.guidanceNoModels'));
  } else {
    lines.push(tt('sys.sectionHeader'));
    for (const entry of models.slice(0, 40)) {
      lines.push(promptModelLine(entry, tt));
    }
    if (models.length > 40) lines.push(`- … (+${models.length - 40})`);
    lines.push(tt('sys.guidance', { minutes: Math.round(deps.config.idleTimeoutMs / 60_000) }));
  }
  const preferred = deps.tooling?.preferred;
  if (preferred !== undefined) {
    const method = preferred.huggingface ?? preferred.modelscope;
    if (method !== null && method !== undefined) {
      lines.push(tt('sys.downloadMethod', { method: tt(`download.method.${method}`) }));
    }
  }
  if (recent.length > 0) {
    lines.push(tt('sys.recent', {
      items: recent.map((item) => `${item.modelId} (${item.at})`).join(', ')
    }));
  }
  return lines.join('\n');
}
