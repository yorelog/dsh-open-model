/**
 * Local model discovery and format/quantization identification.
 *
 * Formats are decided from bytes, not names: GGUF metadata is parsed from the
 * file header (`general.file_type`, architecture, name), safetensors reads its
 * JSON header, and MLX is recognized from a directory's `config.json`
 * `quantization` block. A filename pattern is only a documented last resort.
 * @module @local/open-model/lib/scan
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { treeSize } from './paths.js';
import { truncate } from './util.js';

const GGUF_MAGIC = 0x46554747;
const GGUF_READ_CAP = 16 * 1024 * 1024;
const SAFETENSORS_HEADER_CAP = 64 * 1024 * 1024;
const CONFIG_CAP = 4 * 1024 * 1024;

/** llama.cpp `llama_ftype` → quantization label. */
const GGUF_FILE_TYPES = new Map([
  [0, 'F32'],
  [1, 'F16'],
  [2, 'Q4_0'],
  [3, 'Q4_1'],
  [7, 'Q8_0'],
  [8, 'Q5_0'],
  [9, 'Q5_1'],
  [10, 'Q2_K'],
  [11, 'Q3_K_S'],
  [12, 'Q3_K_M'],
  [13, 'Q3_K_L'],
  [14, 'Q4_K_S'],
  [15, 'Q4_K_M'],
  [16, 'Q5_K_S'],
  [17, 'Q5_K_M'],
  [18, 'Q6_K'],
  [19, 'IQ2_XXS'],
  [20, 'IQ2_XS'],
  [21, 'IQ3_XXS'],
  [22, 'IQ1_S'],
  [23, 'IQ4_NL'],
  [24, 'IQ3_S'],
  [25, 'IQ3_M'],
  [26, 'IQ2_S'],
  [27, 'IQ2_M'],
  [28, 'IQ4_XS'],
  [29, 'IQ1_M'],
  [30, 'BF16'],
  [31, 'Q4_0_4_4'],
  [32, 'Q4_0_4_8'],
  [33, 'Q4_0_8_8'],
  [34, 'TQ1_0'],
  [35, 'TQ2_0'],
  [36, 'MXFP4_MOE']
]);

const QUANT_PATTERN = /(IQ\d+_(?:XXS|XS|S|M|L|NL)|Q\d+_K(?:_[SML])?|Q\d+_\d(?:_\d+_\d+)?|MXFP4(?:_MOE)?|BF16|F16|F32)/iu;

/** ggml tensor type ids → quantization labels, used when `general.file_type` is absent. */
const GGML_TENSOR_TYPES = new Map([
  [0, 'F32'],
  [1, 'F16'],
  [2, 'Q4_0'],
  [3, 'Q4_1'],
  [6, 'Q5_0'],
  [7, 'Q5_1'],
  [8, 'Q8_0'],
  [9, 'Q8_1'],
  [10, 'Q2_K'],
  [11, 'Q3_K'],
  [12, 'Q4_K'],
  [13, 'Q5_K'],
  [14, 'Q6_K'],
  [15, 'Q8_K'],
  [16, 'IQ2_XXS'],
  [17, 'IQ2_XS'],
  [18, 'IQ3_XXS'],
  [19, 'IQ1_S'],
  [20, 'IQ4_NL'],
  [21, 'IQ3_S'],
  [22, 'IQ2_S'],
  [23, 'IQ4_XS'],
  [29, 'IQ1_M'],
  [30, 'BF16'],
  [34, 'TQ1_0'],
  [35, 'TQ2_0'],
  [36, 'MXFP4']
]);

/**
 * Map a GGUF `general.file_type` value to a label.
 * @param {number | undefined} fileType
 * @returns {string | null}
 */
export function quantFromGgufFileType(fileType) {
  if (typeof fileType !== 'number' || !Number.isFinite(fileType)) return null;
  return GGUF_FILE_TYPES.get(fileType) ?? `file_type_${fileType}`;
}

/**
 * @param {string} name
 * @returns {string | null}
 */
function quantFromFilename(name) {
  const match = QUANT_PATTERN.exec(name);
  return match === null ? null : match[0].toUpperCase();
}

/**
 * Bounds-checked GGUF metadata reader.
 * @param {Buffer} buffer
 */
function createGgufReader(buffer) {
  let offset = 0;
  const need = (count) => {
    if (offset + count > buffer.length) throw new Error('truncated GGUF metadata');
  };
  const reader = {
    get offset() {
      return offset;
    },
    u8() {
      need(1);
      const value = buffer.readUInt8(offset);
      offset += 1;
      return value;
    },
    i8() {
      need(1);
      const value = buffer.readInt8(offset);
      offset += 1;
      return value;
    },
    u16() {
      need(2);
      const value = buffer.readUInt16LE(offset);
      offset += 2;
      return value;
    },
    i16() {
      need(2);
      const value = buffer.readInt16LE(offset);
      offset += 2;
      return value;
    },
    u32() {
      need(4);
      const value = buffer.readUInt32LE(offset);
      offset += 4;
      return value;
    },
    i32() {
      need(4);
      const value = buffer.readInt32LE(offset);
      offset += 4;
      return value;
    },
    f32() {
      need(4);
      const value = buffer.readFloatLE(offset);
      offset += 4;
      return value;
    },
    u64() {
      need(8);
      const value = Number(buffer.readBigUInt64LE(offset));
      offset += 8;
      return value;
    },
    i64() {
      need(8);
      const value = Number(buffer.readBigInt64LE(offset));
      offset += 8;
      return value;
    },
    f64() {
      need(8);
      const value = buffer.readDoubleLE(offset);
      offset += 8;
      return value;
    },
    string() {
      const length = reader.u64();
      if (length < 0 || length > buffer.length) throw new Error('invalid GGUF string length');
      need(length);
      const value = buffer.toString('utf8', offset, offset + length);
      offset += length;
      return value;
    },
    skip(count) {
      if (count < 0) throw new Error('invalid GGUF skip');
      need(count);
      offset += count;
    }
  };
  return reader;
}

const GGUF_SCALAR_SIZES = new Map([
  [0, 1], [1, 1], [2, 2], [3, 2], [4, 4], [5, 4], [6, 4], [7, 1], [10, 8], [11, 8], [12, 8]
]);

/**
 * Read and skip one GGUF metadata value.
 * @param {ReturnType<typeof createGgufReader>} reader
 * @param {number} type
 * @returns {unknown}
 */
function readGgufValue(reader, type) {
  switch (type) {
    case 0: return reader.u8();
    case 1: return reader.i8();
    case 2: return reader.u16();
    case 3: return reader.i16();
    case 4: return reader.u32();
    case 5: return reader.i32();
    case 6: return reader.f32();
    case 7: return reader.u8() !== 0;
    case 8: return reader.string();
    case 10: return reader.u64();
    case 11: return reader.i64();
    case 12: return reader.f64();
    case 9: {
      const itemType = reader.u32();
      const count = reader.u64();
      if (count < 0 || count > 10_000_000) throw new Error('invalid GGUF array length');
      const scalarSize = GGUF_SCALAR_SIZES.get(itemType);
      if (scalarSize !== undefined) {
        reader.skip(count * scalarSize);
      } else if (itemType === 8) {
        for (let index = 0; index < count; index += 1) reader.string();
      } else if (itemType === 9) {
        for (let index = 0; index < count; index += 1) readGgufValue(reader, 9);
      } else {
        throw new Error(`unsupported GGUF array item type ${itemType}`);
      }
      return { arrayLength: count };
    }
    default:
      throw new Error(`unsupported GGUF metadata type ${type}`);
  }
}

/**
 * Parse the GGUF header of one file.
 * @param {string} filePath
 * @returns {Promise<{ ok: boolean, version?: number, tensorCount?: number, fileType?: number, architecture?: string, name?: string, tensorTypes?: number[], error?: string }>}
 */
export async function readGgufMetadata(filePath) {
  let handle;
  try {
    handle = await fs.open(filePath, 'r');
    const stat = await handle.stat();
    const length = Math.min(stat.size, GGUF_READ_CAP);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    const reader = createGgufReader(buffer);
    if (reader.u32() !== GGUF_MAGIC) return { ok: false, error: 'not a GGUF file (bad magic)' };
    const version = reader.u32();
    if (version < 2 || version > 3) return { ok: false, error: `unsupported GGUF version ${version}` };
    const tensorCount = reader.u64();
    const metadataCount = reader.u64();
    if (!Number.isFinite(metadataCount) || metadataCount < 0 || metadataCount > 1_000_000) {
      return { ok: false, error: 'invalid GGUF metadata count' };
    }
    /** @type {{ fileType?: number, architecture?: string, name?: string }} */
    const found = {};
    for (let index = 0; index < metadataCount; index += 1) {
      const key = reader.string();
      const type = reader.u32();
      const value = readGgufValue(reader, type);
      if (key === 'general.file_type' && typeof value === 'number') found.fileType = value;
      else if (key === 'general.architecture' && typeof value === 'string') found.architecture = value;
      else if (key === 'general.name' && typeof value === 'string') found.name = value;
      if (found.fileType !== undefined && found.architecture !== undefined && found.name !== undefined) break;
      if (reader.offset >= buffer.length) break;
    }

    // `general.file_type` is optional in older converters. When it is absent,
    // read the tensor table and derive the quantization from tensor types.
    /** @type {number[]} */
    const tensorTypes = [];
    if (found.fileType === undefined && Number.isFinite(tensorCount) && tensorCount > 0) {
      const limit = Math.min(tensorCount, 4_096);
      for (let index = 0; index < limit; index += 1) {
        reader.string();
        const dimensions = reader.u32();
        if (dimensions < 0 || dimensions > 8) break;
        for (let dimension = 0; dimension < dimensions; dimension += 1) reader.u64();
        tensorTypes.push(reader.u32());
        reader.u64();
        if (reader.offset >= buffer.length) break;
      }
    }
    return { ok: true, version, tensorCount, ...found, ...(tensorTypes.length > 0 ? { tensorTypes } : {}) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * Parse one safetensors file header.
 * @param {string} filePath
 * @returns {Promise<{ ok: boolean, dtypes?: string[], metadata?: Record<string, string>, tensorCount?: number, error?: string }>}
 */
export async function readSafetensorsHeader(filePath) {
  let handle;
  try {
    handle = await fs.open(filePath, 'r');
    const stat = await handle.stat();
    if (stat.size < 9) return { ok: false, error: 'file is too small' };
    const lengthBuffer = Buffer.alloc(8);
    await handle.read(lengthBuffer, 0, 8, 0);
    const headerLength = Number(lengthBuffer.readBigUInt64LE(0));
    if (!Number.isFinite(headerLength) || headerLength <= 0 || headerLength > SAFETENSORS_HEADER_CAP) {
      return { ok: false, error: 'invalid safetensors header length' };
    }
    if (headerLength + 8 > stat.size) return { ok: false, error: 'safetensors header exceeds file size' };
    const headerBuffer = Buffer.alloc(headerLength);
    await handle.read(headerBuffer, 0, headerLength, 8);
    const parsed = JSON.parse(headerBuffer.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object') return { ok: false, error: 'invalid safetensors header' };
    /** @type {Set<string>} */
    const dtypes = new Set();
    let tensorCount = 0;
    for (const [key, value] of Object.entries(parsed)) {
      if (key === '__metadata__') continue;
      tensorCount += 1;
      if (value !== null && typeof value === 'object' && typeof value.dtype === 'string') dtypes.add(value.dtype);
    }
    const metadata = parsed.__metadata__ !== null && typeof parsed.__metadata__ === 'object' ? parsed.__metadata__ : undefined;
    return { ok: true, dtypes: [...dtypes], metadata, tensorCount };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * Read a model directory's config.json.
 * @param {string} dir
 * @returns {Promise<Record<string, any> | null>}
 */
export async function readModelConfig(dir) {
  try {
    const file = path.join(dir, 'config.json');
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > CONFIG_CAP) return null;
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    return parsed !== null && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Derive a quantization label from a directory config.
 * @param {Record<string, any>} config
 * @param {string[]} dtypes
 * @returns {{ quant: string, evidence: string } | null}
 */
function quantFromConfig(config, dtypes) {
  const quantization = config.quantization;
  if (quantization !== null && typeof quantization === 'object') {
    const bits = Number(quantization.bits);
    const group = Number(quantization.group_size);
    if (Number.isInteger(bits)) {
      return {
        quant: `mlx-${bits}bit${Number.isInteger(group) ? `-g${group}` : ''}`,
        evidence: 'config.quantization'
      };
    }
  }
  const quantizationConfig = config.quantization_config;
  if (quantizationConfig !== null && typeof quantizationConfig === 'object') {
    const method = String(quantizationConfig.quant_method ?? quantizationConfig.quant_method ?? 'quantized');
    const bits = Number(quantizationConfig.bits ?? (quantizationConfig.load_in_4bit === true ? 4 : NaN));
    const type = typeof quantizationConfig.bnb_4bit_quant_type === 'string'
      ? quantizationConfig.bnb_4bit_quant_type
      : '';
    const label = `${method}${type.length > 0 ? `-${type}` : ''}${Number.isInteger(bits) ? `-${bits}bit` : ''}`;
    return { quant: label, evidence: 'config.quantization_config' };
  }
  if (dtypes.length > 0) {
    return { quant: normalizeDtype(dtypes[0]), evidence: 'safetensors-header' };
  }
  if (typeof config.torch_dtype === 'string') {
    return { quant: normalizeDtype(config.torch_dtype), evidence: 'config.torch_dtype' };
  }
  return null;
}

/**
 * @param {string} dtype
 * @returns {string}
 */
function normalizeDtype(dtype) {
  const lowered = String(dtype).toUpperCase();
  if (lowered === 'FLOAT16' || lowered === 'F16' || lowered === 'HALF') return 'f16';
  if (lowered === 'BFLOAT16' || lowered === 'BF16') return 'bf16';
  if (lowered === 'FLOAT32' || lowered === 'F32' || lowered === 'FLOAT') return 'f32';
  return lowered.toLowerCase();
}

/**
 * @param {string} name
 * @returns {boolean}
 */
function isWeightFile(name) {
  return /\.(safetensors|bin|gguf|pth|npz)$/iu.test(name);
}

/**
 * @param {string} dir
 * @returns {Promise<import('node:fs').Dirent[]>}
 */
async function listDir(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Detect one directory that holds a full model (config.json + weights).
 * @param {string} dir
 * @returns {Promise<{ format: 'safetensors'|'mlx', quant: string, quantEvidence: string, sizeBytes: number, basis: string, config: Record<string, any> | null } | null>}
 */
export async function detectModelDirectory(dir) {
  const entries = await listDir(dir);
  if (entries.length === 0) return null;
  const configEntry = entries.find((entry) => entry.isFile() && entry.name === 'config.json');
  if (configEntry === undefined) return null;
  const weightFiles = entries.filter((entry) => entry.isFile() && /\.(safetensors|bin|pth)$/iu.test(entry.name));
  if (weightFiles.length === 0) return null;
  const config = await readModelConfig(dir);
  if (config === null) return null;

  let dtypes = [];
  let basis = 'config.json';
  const firstWeights = weightFiles.find((entry) => entry.name.endsWith('.safetensors'));
  if (firstWeights !== undefined) {
    const header = await readSafetensorsHeader(path.join(dir, firstWeights.name));
    if (header.ok && Array.isArray(header.dtypes)) {
      dtypes = header.dtypes;
      basis = 'safetensors header + config.json';
    }
  }

  const quantized = config.quantization !== null && typeof config.quantization === 'object';
  const quant = quantFromConfig(config, dtypes);
  const size = await treeSize(dir, { maxEntries: 20_000 });
  return {
    format: quantized ? 'mlx' : 'safetensors',
    quant: quant?.quant ?? 'unknown',
    quantEvidence: quant?.evidence ?? 'none',
    sizeBytes: size.bytes,
    basis,
    config
  };
}

/**
 * Derive a quantization label from the dominant ggml tensor type.
 * @param {number[] | undefined} tensorTypes
 * @returns {string | null}
 */
function quantFromTensorTypes(tensorTypes) {
  if (!Array.isArray(tensorTypes) || tensorTypes.length === 0) return null;
  /** @type {Map<number, number>} */
  const counts = new Map();
  for (const type of tensorTypes) {
    if (!Number.isFinite(type)) continue;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  let bestType = null;
  let bestCount = -1;
  for (const [type, count] of counts) {
    if (count > bestCount) {
      bestType = type;
      bestCount = count;
    }
  }
  if (bestType === null) return null;
  return GGML_TENSOR_TYPES.get(bestType) ?? null;
}

/**
 * Detect one GGUF file.
 * @param {string} filePath
 * @returns {Promise<{ format: 'gguf', quant: string, quantEvidence: string, sizeBytes: number, basis: string, architecture?: string, metaName?: string, warning?: string }>}
 */
export async function detectGgufFile(filePath) {
  const header = await readGgufMetadata(filePath);
  const stat = await fs.stat(filePath).catch(() => null);
  const sizeBytes = stat?.size ?? 0;
  if (!header.ok) {
    const fromName = quantFromFilename(path.basename(filePath));
    return {
      format: 'gguf',
      quant: fromName ?? 'unknown',
      quantEvidence: fromName === null ? 'none' : 'filename',
      sizeBytes,
      basis: `filename (header unreadable: ${header.error})`,
      warning: `gguf-header-unreadable:${truncate(String(header.error ?? ''), 160)}`
    };
  }
  const fromHeader = quantFromGgufFileType(header.fileType);
  const fromTensors = fromHeader === null ? quantFromTensorTypes(header.tensorTypes) : null;
  const fromName = quantFromFilename(path.basename(filePath));
  const quant = fromHeader ?? fromTensors ?? fromName ?? 'unknown';
  const evidence = fromHeader !== null
    ? 'gguf-header'
    : (fromTensors !== null ? 'gguf-tensor-types' : (fromName !== null ? 'filename' : 'none'));
  return {
    format: 'gguf',
    quant,
    quantEvidence: evidence,
    sizeBytes,
    basis: `GGUF v${header.version ?? '?'} header (${header.tensorCount ?? '?'} tensors)`,
    architecture: header.architecture,
    metaName: header.name
  };
}

/**
 * A human name from a model path, unwrapping HuggingFace cache layouts.
 * @param {string} target
 * @returns {string}
 */
export function prettyModelName(target) {
  const parts = path.resolve(target).split(path.sep).filter((part) => part.length > 0);
  const base = parts[parts.length - 1] ?? 'model';
  const parent = parts[parts.length - 2] ?? '';
  if (/^[0-9a-f]{40,64}$/iu.test(base) || base === 'snapshots') {
    if (parent.startsWith('models--')) {
      return parent.replace(/^models--/u, '').replace(/--/gu, '/');
    }
    return parent.length > 0 ? parent : base;
  }
  return base;
}

/**
 * Scan roots for model candidates.
 * @param {string[]} roots
 * @param {{ maxDepth?: number, maxEntries?: number }} [options]
 * @returns {Promise<{ candidates: Array<Record<string, any>>, warnings: string[], missingRoots: string[] }>}
 */
export async function scanModelRoots(roots, options = {}) {
  const maxDepth = options.maxDepth ?? 4;
  const maxEntries = options.maxEntries ?? 50_000;
  /** @type {Array<Record<string, any>>} */
  const candidates = [];
  /** @type {string[]} */
  const warnings = [];
  /** @type {string[]} */
  const missingRoots = [];
  let visited = 0;

  /**
   * @param {string} dir
   * @param {number} depth
   */
  const walk = async (dir, depth) => {
    if (visited > maxEntries) return;
    const entries = await listDir(dir);
    if (entries.length === 0) return;
    visited += entries.length;

    const directoryModel = await detectModelDirectory(dir);
    if (directoryModel !== null) {
      const displayName = prettyModelName(dir);
      candidates.push({
        path: path.resolve(dir),
        displayName,
        ...directoryModel
      });
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth >= maxDepth) continue;
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !/\.gguf$/iu.test(entry.name)) continue;
      const splitMatch = /-(\d{5})-of-(\d{5})\.gguf$/iu.exec(entry.name);
      if (splitMatch !== null && splitMatch[1] !== '00001') continue;
      const detected = await detectGgufFile(full);
      const displayName = `${prettyModelName(path.dirname(full))}/${path.basename(full, path.extname(full))}`;
      const warning = /mmproj/iu.test(entry.name)
        ? 'mmproj-projector'
        : (detected.warning ?? undefined);
      candidates.push({
        path: path.resolve(full),
        displayName: truncate(displayName, 120),
        ...detected,
        ...(warning !== undefined ? { warning } : {})
      });
    }
  };

  for (const root of roots) {
    const resolved = path.resolve(root);
    try {
      const stat = await fs.stat(resolved);
      if (!stat.isDirectory()) {
        warnings.push(`not a directory: ${resolved}`);
        continue;
      }
    } catch {
      missingRoots.push(resolved);
      continue;
    }
    await walk(resolved, 0);
  }

  candidates.sort((left, right) => left.path.localeCompare(right.path));
  return { candidates, warnings, missingRoots };
}
