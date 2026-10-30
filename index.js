/**
 * @local/open-model — local open-model hub for DeepSeek Harness.
 *
 * Host half: search, download, register, run and idle-release local models
 * through llama-server (Windows) and mlxcel-server (Apple Silicon), with
 * mirror/proxy awareness and zh/en output that follows the session locale.
 *
 * Every long-lived resource is created inside a Cordis effect, and the final
 * effect stops both the idle timer and every child process this plugin
 * started, so a hot reload cannot leave orphaned servers behind.
 * @module @local/open-model
 */

import { Config, normalizeConfig } from './lib/config.js';
import { detectDownloadTooling, DownloadManager } from './lib/download.js';
import { translator } from './lib/i18n.js';
import { resolveLocale } from './lib/locale.js';
import { readJson, statePath, writeJsonAtomic } from './lib/paths.js';
import { ModelRegistry } from './lib/registry.js';
import { InferenceSupervisor } from './lib/server.js';
import { createTools, promptSectionText } from './lib/tools.js';
import { isoNow } from './lib/util.js';

export { Config };

/** Tools are the only hard dependency; the prompt section is optional. */
export const inject = ['tools'];

/**
 * Recent-release log surfaced in the prompt section and runtime_status.
 * Keep it tiny: it is a notification, not history.
 */
function createHubState(logger) {
  /** @type {Array<{ modelId: string, at: string, runtime: string | null, port: number | null }>} */
  let releases = [];
  return {
    async load() {
      const { value } = await readJson(statePath(), null);
      if (value === null || typeof value !== 'object' || !Array.isArray(value.releases)) return;
      releases = value.releases
        .filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.modelId === 'string')
        .slice(0, 10);
    },
    pushRelease(info) {
      releases = [{ ...info, at: isoNow() }, ...releases].slice(0, 10);
      void writeJsonAtomic(statePath(), { version: 1, releases }).catch((error) => {
        logger?.warn?.(`[open-model] state write failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    },
    /** @returns {Array<{ modelId: string, at: string, runtime: string | null, port: number | null }>} */
    recent(limit = 5) {
      return releases.slice(0, limit);
    }
  };
}

/**
 * Activate the plugin.
 * @param {any} ctx Cordis context
 * @param {any} rawConfig validated loader config
 */
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig);
  const logger = ctx.logger('open-model');
  const registry = new ModelRegistry({ logger });
  const state = createHubState(logger);
  const scanCache = new Map();
  const downloads = new DownloadManager({
    config,
    logger,
    onUpdate: (task) => {
      try {
        ctx.emit?.('open-model/download-progress', task);
      } catch {
        // An event listener must never break a download.
      }
    }
  });
  const supervisor = new InferenceSupervisor({ config, registry, logger });

  /** @type {{ preferred: { huggingface: string | null, modelscope: string | null } } | null} */
  let tooling = null;

  /**
   * Resolve the active locale and its translator for one call.
   * @returns {{ locale: 'zh' | 'en', source: string, translate: (key: string, vars?: Record<string, string | number>) => string }}
   */
  const getLocale = () => {
    const resolved = resolveLocale(ctx, config);
    return { ...resolved, translate: translator(resolved.locale) };
  };

  const ready = (async () => {
    await registry.load();
    await state.load();
    await downloads.ready.catch(() => {});
    tooling = await detectDownloadTooling().catch(() => null);
  })();

  // Tools: register as one effect so unload removes every schema in one go.
  const definitions = createTools({
    ctx,
    config,
    registry,
    downloads,
    supervisor,
    scanCache,
    getLocale,
    state,
    logger
  });
  for (const definition of definitions) {
    const execute = definition.execute.bind(definition);
    definition.execute = async (args, exec) => {
      await ready;
      return execute(args, exec);
    };
  }
  ctx.effect(() => {
    const disposers = definitions.map((definition) => ctx.tools.register(definition));
    return () => {
      for (const dispose of disposers.reverse()) {
        try {
          dispose();
        } catch {
          // Registration may already be gone during teardown.
        }
      }
    };
  }, 'open-model: tools');

  // Prompt section: compact registered-model list, localized and refreshed on
  // every assembly so registry changes are visible without a restart.
  ctx.inject(['systemPrompt'], (child) => {
    child.effect(() => child.systemPrompt.section({
      name: 'open-model:local-models',
      order: 2550,
      text: () => {
        const { translate } = getLocale();
        return promptSectionText({ config, registry, tooling, state, translate });
      }
    }), 'open-model: prompt section');
  });

  // Idle reaper: releases servers untouched for idleTimeoutMs.
  ctx.effect(() => {
    const timer = setInterval(() => {
      void (async () => {
        await ready.catch(() => {});
        try {
          const released = await supervisor.reapIdle();
          for (const item of released) {
            state.pushRelease(item);
            const { translate } = getLocale();
            logger?.info?.(translate('idle.released', {
              modelId: item.modelId,
              minutes: Math.round(config.idleTimeoutMs / 60_000),
              runtime: item.runtime ?? '',
              port: item.port ?? '—'
            }));
            try {
              ctx.emit?.('open-model/model-released', item);
            } catch {
              // Notifications are best effort.
            }
          }
        } catch (error) {
          logger?.warn?.(`[open-model] idle sweep failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      })();
    }, config.idleCheckIntervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }, 'open-model: idle reaper');

  // Teardown: cancel downloads and stop every model server this instance owns.
  ctx.effect(() => async () => {
    downloads.dispose();
    await supervisor.dispose().catch((error) => {
      logger?.warn?.(`[open-model] teardown failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, 'open-model: runtime cleanup');
}
