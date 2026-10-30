/**
 * Active-language resolution for the Host half.
 *
 * The browser client owns the GUI language; a Host plugin cannot read
 * `navigator`. This module therefore consumes, in order:
 *   1. an explicit `locale` in the plugin Config,
 *   2. a Host-provided `locale` service (`ctx.locale`) if the build has one,
 *   3. the `locale.preference` the client persists in the Host settings
 *      document through `ctx.settings`,
 *   4. the Host locale (`DSH_LOCALE`, LC_ALL/LANG, ICU default),
 *   5. English.
 *
 * Browser language detection is deliberately absent: the plugin follows the
 * language the session actually runs under, and the settings read keeps the
 * value live when the user switches language in the GUI.
 * @module dsh-open-model/lib/locale
 */

import { normalizeLocale } from './util.js';

/** How long one settings read is reused. */
const CACHE_TTL_MS = 2_000;

/** @type {{ at: number, key: string, value: { locale: 'zh'|'en', source: string } } | null} */
let cache = null;

/**
 * Read a service without asserting it exists.
 * @param {any} ctx
 * @param {string} name
 * @returns {any}
 */
function softGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Derive a language from an installed `ctx.locale`-shaped object. Accepts both
 * the client face (`getLocale()` returning `{ active }`) and simpler shapes
 * (`current`, `active`, or a plain string).
 * @param {any} service
 * @returns {'zh' | 'en' | null}
 */
function readLocaleService(service) {
  if (service === undefined || service === null) return null;
  const candidates = [];
  try {
    if (typeof service.getLocale === 'function') candidates.push(service.getLocale());
    if (typeof service.getLanguage === 'function') candidates.push(service.getLanguage());
    if (typeof service.locale === 'string') candidates.push(service.locale);
    candidates.push(service.active, service.current);
  } catch {
    return null;
  }
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const normalized = normalizeLocale(candidate);
      if (normalized !== null) return normalized;
      continue;
    }
    if (candidate !== null && typeof candidate === 'object') {
      for (const field of ['active', 'current', 'locale', 'language', 'id']) {
        const normalized = normalizeLocale(candidate[field]);
        if (normalized !== null) return normalized;
      }
    }
  }
  return null;
}

/**
 * Read `locale.preference` from the Host settings document. The client locale
 * plugin persists it through the settings service, so this is the live value
 * of a GUI language switch.
 * @param {any} ctx
 * @returns {'zh' | 'en' | null}
 */
function readSettingsPreference(ctx) {
  const settings = softGet(ctx, 'settings');
  if (settings === undefined || settings === null || typeof settings.describe !== 'function') return null;
  let descriptors;
  try {
    descriptors = settings.describe();
  } catch {
    return null;
  }
  if (!Array.isArray(descriptors)) return null;
  for (const descriptor of descriptors) {
    if (descriptor === null || typeof descriptor !== 'object') continue;
    const namespace = String(descriptor.ns ?? descriptor.namespace ?? '');
    for (const candidate of [descriptor.value, descriptor.user, descriptor.base]) {
      if (candidate === null || typeof candidate !== 'object') continue;
      const preference = candidate.preference;
      const normalized = normalizeLocale(preference);
      if (normalized !== null && (/(^|[:.\-_/])locale$/iu.test(namespace) || 'preference' in candidate)) {
        return normalized;
      }
    }
  }
  return null;
}

/**
 * Host process locale, used only after every session-owned source is absent.
 * @returns {'zh' | 'en' | null}
 */
function readHostLocale() {
  const fromEnv = normalizeLocale(process.env.DSH_LOCALE)
    ?? normalizeLocale(process.env.LC_ALL)
    ?? normalizeLocale(process.env.LC_MESSAGES)
    ?? normalizeLocale(process.env.LANG);
  if (fromEnv !== null) return fromEnv;
  try {
    return normalizeLocale(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return null;
  }
}

/**
 * Resolve the language used for this session's tool output and prompt section.
 * @param {any} ctx
 * @param {{ locale?: string }} config
 * @returns {{ locale: 'zh' | 'en', source: 'config' | 'ctx.locale' | 'settings' | 'host' | 'default' }}
 */
export function resolveLocale(ctx, config = {}) {
  const explicit = normalizeLocale(config.locale);
  if (explicit !== null) return { locale: explicit, source: 'config' };

  const cacheKey = 'auto';
  const now = Date.now();
  if (cache !== null && cache.key === cacheKey && now - cache.at < CACHE_TTL_MS) return cache.value;

  const fromService = readLocaleService(softGet(ctx, 'locale'));
  let value;
  if (fromService !== null) {
    value = { locale: fromService, source: 'ctx.locale' };
  } else {
    const fromSettings = readSettingsPreference(ctx);
    if (fromSettings !== null) {
      value = { locale: fromSettings, source: 'settings' };
    } else {
      const fromHost = readHostLocale();
      value = fromHost !== null ? { locale: fromHost, source: 'host' } : { locale: 'en', source: 'default' };
    }
  }
  cache = { at: now, key: cacheKey, value };
  return value;
}

/**
 * Test seam: drop the cached resolution (used after a settings write).
 */
export function invalidateLocaleCache() {
  cache = null;
}
