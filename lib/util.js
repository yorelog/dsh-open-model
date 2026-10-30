/**
 * Small dependency-free helpers shared by the dsh-open-model plugin.
 * @module dsh-open-model/lib/util
 */

const KB = 1024;

/**
 * Human-readable byte size. Locale-neutral so both languages share it.
 * @param {number | null | undefined} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < KB) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let value = bytes / KB;
  let unit = 0;
  while (value >= KB && unit < units.length - 1) {
    value /= KB;
    unit += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

/**
 * Compact duration such as `42s`, `3m05s`, `1h07m`.
 * @param {number | null | undefined} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes < 60) return `${minutes}m${String(rest).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * Throughput label for a byte-per-second rate.
 * @param {number | null | undefined} bytesPerSecond
 * @returns {string}
 */
export function formatSpeed(bytesPerSecond) {
  if (typeof bytesPerSecond !== 'number' || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '—';
  return `${formatBytes(bytesPerSecond)}/s`;
}

/**
 * Filesystem- and URL-safe identifier slug.
 * @param {string} input
 * @param {number} [max]
 * @returns {string}
 */
export function slugify(input, max = 64) {
  const slug = String(input ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return (slug || 'model').slice(0, max).replace(/-+$/gu, '');
}

/**
 * Deterministic short hash (FNV-1a, 32 bit) rendered as 8 hex characters.
 * @param {string} input
 * @returns {string}
 */
export function shortHash(input) {
  let hash = 0x811c9dc5;
  const text = String(input ?? '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Build a stable registry id from a display name and an absolute path.
 * @param {string} displayName
 * @param {string} filePath
 * @returns {string}
 */
export function modelIdFor(displayName, filePath) {
  const stem = slugify(displayName, 56);
  return `${stem}-${shortHash(`${filePath}`)}`;
}

/** @returns {string} */
export function isoNow() {
  return new Date().toISOString();
}

/**
 * First value that is a non-blank string. Empty strings are treated as absent:
 * an empty proxy variable must never be forwarded to a child process.
 * @param {...unknown} values
 * @returns {string | undefined}
 */
export function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

/**
 * Whether a value is a plain object (not an array, not null).
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Case-insensitive path identity on Windows, exact elsewhere.
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
export function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = left.replace(/[\\/]+$/u, '');
  const b = right.replace(/[\\/]+$/u, '');
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Whether `child` is inside `parent` (case-insensitive on Windows).
 * @param {string} parent
 * @param {string} child
 * @returns {boolean}
 */
export function isInside(parent, child) {
  if (typeof parent !== 'string' || typeof child !== 'string') return false;
  const normalize = (value) => {
    const resolved = value.replace(/[\\/]+$/u, '');
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const base = normalize(parent);
  const target = normalize(child);
  return target === base || target.startsWith(`${base}${process.platform === 'win32' ? '\\' : '/'}`);
}

/**
 * @template T
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Truncate a string for bounded tool output.
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
export function truncate(text, max) {
  const value = String(text ?? '');
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Normalize a language tag to one of the two shipped locales.
 * @param {unknown} value
 * @returns {'zh' | 'en' | null}
 */
export function normalizeLocale(value) {
  if (typeof value !== 'string') return null;
  const tag = value.trim().toLowerCase();
  if (tag.length === 0) return null;
  if (tag === 'zh' || tag.startsWith('zh-') || tag.startsWith('zh_')) return 'zh';
  if (tag === 'en' || tag.startsWith('en-') || tag.startsWith('en_')) return 'en';
  return null;
}
