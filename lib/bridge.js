/**
 * Same-origin HTTP bridge for the settings page.
 *
 * The Client half cannot call Cordis services, so the page reaches the exact
 * same tool implementations through two JSON endpoints on the existing Web
 * server. Both endpoints accept only same-origin browser requests (an Origin
 * or Sec-Fetch-Site check), never expose arbitrary tool names, and are
 * removed with the plugin's effect.
 * @module dsh-open-model/lib/bridge
 */

import { effectiveModelRoots } from './config.js';
import { resolveLocale } from './locale.js';
import { discoverRuntimes } from './runtime.js';

const TOOL_NAMES = new Set([
  'model_search',
  'model_download',
  'model_download_status',
  'model_scan',
  'model_register',
  'model_load',
  'model_unload',
  'model_infer',
  'runtime_status',
  'runtime_install'
]);

const MAX_BODY_BYTES = 256 * 1024;

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} value
 */
function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body)
  });
  response.end(body);
}

/**
 * Read a bounded JSON body.
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<unknown>}
 */
function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    /** @type {Buffer[]} */
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    request.on('error', reject);
  });
}

/**
 * Same-origin admission for a browser call. Cross-origin browser requests and
 * non-browser callers without either fetch header are refused.
 * @param {import('node:http').IncomingMessage} request
 * @param {string} expectedOrigin
 * @returns {boolean}
 */
function admitSameOrigin(request, expectedOrigin) {
  const origin = request.headers.origin;
  const site = request.headers['sec-fetch-site'];
  if (typeof origin === 'string' && origin !== expectedOrigin) return false;
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return false;
  if (origin === undefined && site === undefined) return false;
  return true;
}

/**
 * Register the bridge routes.
 *
 * @param {any} ctx context whose `webServer` serves the routes
 * @param {{
 *   config: any,
 *   registry: any,
 *   downloads: any,
 *   supervisor: any,
 *   definitions: any[],
 *   logger?: any
 * }} deps
 * @returns {() => void}
 */
export function registerToolBridge(ctx, deps) {
  const webServer = ctx.webServer;
  const byName = new Map(deps.definitions.map((definition) => [definition.name, definition]));
  /** Runtime discovery is relatively expensive; the dashboard polls during downloads. */
  let runtimeCache = null;

  /**
   * @returns {Promise<any[]>} llama then mlxcel, cached for a few seconds
   */
  const getRuntimes = async () => {
    if (runtimeCache !== null && Date.now() - runtimeCache.at < 5_000) return runtimeCache.value;
    const discovery = await discoverRuntimes(deps.config, { verify: false });
    runtimeCache = { at: Date.now(), value: [discovery.llama, discovery.mlxcel] };
    return runtimeCache.value;
  };

  /**
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   * @param {(body: any) => Promise<unknown>} run
   */
  const handle = async (request, response, run) => {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' });
      return;
    }
    if (!admitSameOrigin(request, webServer.getOrigin())) {
      sendJson(response, 403, { ok: false, error: 'same-origin requests only' });
      return;
    }
    if (typeof response.setTimeout === 'function') response.setTimeout(0);
    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      return;
    }
    try {
      sendJson(response, 200, { ok: true, value: await run(body) });
    } catch (error) {
      deps.logger?.warn?.(`[dsh-open-model] bridge call failed: ${error instanceof Error ? error.message : String(error)}`);
      sendJson(response, 200, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };

  /** Snapshot for the dashboard. */
  const status = async () => {
    const runtimes = await getRuntimes();
    const locale = resolveLocale(ctx, deps.config);
    return {
      platform: process.platform,
      arch: process.arch,
      locale: locale.locale,
      localeSource: locale.source,
      roots: effectiveModelRoots(deps.config),
      runtimes,
      models: deps.registry.list(),
      downloads: deps.downloads.list(),
      recent: []
    };
  };

  const statusRoute = webServer.register({
    kind: 'exact',
    path: '/api/open-model/status',
    handler: (request, response) => handle(request, response, () => status())
  });

  const toolRoute = webServer.register({
    kind: 'exact',
    path: '/api/open-model/tool',
    handler: (request, response) => handle(request, response, async (body) => {
      const name = typeof body?.name === 'string' ? body.name : '';
      if (!TOOL_NAMES.has(name)) throw new Error(`unknown tool "${name}"`);
      const definition = byName.get(name);
      if (definition === undefined) throw new Error(`tool "${name}" is not registered`);
      const args = body?.arguments !== null && typeof body?.arguments === 'object' ? body.arguments : {};
      const controller = new AbortController();
      return definition.execute(args, { signal: controller.signal });
    })
  });

  return () => {
    toolRoute();
    statusRoute();
  };
}
