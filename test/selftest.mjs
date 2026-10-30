/**
 * Local self-test for the dsh-open-model plugin (not shipped).
 * Run with: node test/selftest.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('../', import.meta.url)));
void root;
const { normalizeConfig, buildChildEnv, endpointFor, effectiveModelRoots } = await import('../lib/config.js');
const { messages, t } = await import('../lib/i18n.js');
const { readGgufMetadata, detectGgufFile, detectModelDirectory, scanModelRoots } = await import('../lib/scan.js');
const { ModelRegistry } = await import('../lib/registry.js');
const { globMatch, buildDownloadArgv, chooseMethod } = await import('../lib/download.js');
const { downloadFile } = await import('../lib/net.js');
const runtimeMod = await import('../lib/runtime.js');
const { selectLlamaAssets: selectAssets } = runtimeMod;
const { createTools, promptSectionText } = await import('../lib/tools.js');
const { InferenceSupervisor } = await import('../lib/server.js');
const { slugify, modelIdFor, formatBytes, formatDuration } = await import('../lib/util.js');

const results = [];
function test(name, fn) {
  try {
    const value = fn();
    if (value instanceof Promise) throw new Error('use testAsync');
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error });
  }
}
async function testAsync(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error });
  }
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'open-model-test-'));
const modelsRoot = path.join(tmpRoot, 'models');
await fs.mkdir(modelsRoot, { recursive: true });

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}
function u64(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}
function ggufString(value) {
  const text = Buffer.from(value, 'utf8');
  return Buffer.concat([u64(text.length), text]);
}
function ggufFile({ architecture = 'qwen2', name = 'Fixture Qwen', fileType = 15 } = {}) {
  return Buffer.concat([
    u32(0x46554747),
    u32(3),
    u64(0),
    u64(3),
    ggufString('general.architecture'), u32(8), ggufString(architecture),
    ggufString('general.name'), u32(8), ggufString(name),
    ggufString('general.file_type'), u32(4), u32(fileType)
  ]);
}
function safetensorsBytes(dtypes = ['F16', 'F16']) {
  const header = {
    __metadata__: { format: 'pt' },
    'model.embed_tokens.weight': { dtype: dtypes[0], shape: [2, 2], data_offsets: [0, 8] },
    'model.norm.weight': { dtype: dtypes[1], shape: [2], data_offsets: [8, 12] }
  };
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(json.length));
  return Buffer.concat([length, json, Buffer.alloc(12)]);
}

const ggufPath = path.join(modelsRoot, 'org', 'fixture-qwen-Q4_K_M.gguf');
await fs.mkdir(path.dirname(ggufPath), { recursive: true });
await fs.writeFile(ggufPath, ggufFile());

// Older converters omit general.file_type; quantization must then come from
// the tensor table (one Q8_0 tensor here).
const ggufLegacyPath = path.join(modelsRoot, 'org', 'legacy-q8_0.gguf');
await fs.writeFile(ggufLegacyPath, Buffer.concat([
  u32(0x46554747), u32(3), u64(1), u64(1),
  ggufString('general.architecture'), u32(8), ggufString('llama'),
  ggufString('token_embd.weight'), u32(2), u64(16), u64(16), u32(8), u64(0)
]));

const mlxDir = path.join(modelsRoot, 'mlx-community', 'Tiny-4bit');
await fs.mkdir(mlxDir, { recursive: true });
await fs.writeFile(path.join(mlxDir, 'config.json'), JSON.stringify({
  architectures: ['Qwen2ForCausalLM'],
  model_type: 'qwen2',
  quantization: { group_size: 64, bits: 4 }
}));
await fs.writeFile(path.join(mlxDir, 'model.safetensors'), safetensorsBytes());

const safetensorsDir = path.join(modelsRoot, 'org', 'tiny-bf16');
await fs.mkdir(safetensorsDir, { recursive: true });
await fs.writeFile(path.join(safetensorsDir, 'config.json'), JSON.stringify({
  architectures: ['LlamaForCausalLM'],
  model_type: 'llama',
  torch_dtype: 'bfloat16'
}));
await fs.writeFile(path.join(safetensorsDir, 'model.safetensors'), safetensorsBytes(['BF16', 'BF16']));

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

test('i18n: every en key exists in zh and vice versa', () => {
  const enKeys = Object.keys(messages.en).sort();
  const zhKeys = Object.keys(messages.zh).sort();
  assert.deepEqual(zhKeys, enKeys);
  assert.equal(t('zh', 'common.loaded'), '已加载');
  assert.equal(t('en', 'common.loaded'), 'loaded');
  assert.match(t('zh', 'scan.title', { roots: 'r', count: 1, newCount: 0 }), /r/);
});

test('config: defaults are applied', () => {
  const config = normalizeConfig({});
  assert.equal(config.idleTimeoutMs, 300000);
  assert.equal(config.defaultSource, 'hf-mirror');
  assert.equal(config.hfMirrorEndpoint, 'https://hf-mirror.com');
  assert.equal(config.modelscopeEndpoint, 'https://modelscope.cn');
  assert.equal(config.locale, 'auto');
  assert.deepEqual(config.modelRoots, []);
  assert.equal(config.idleCheckIntervalMs, 30000);
});

test('config: unwraps schemastery volatile accessors', () => {
  const vol = (value) => ({ get: () => value });
  const config = normalizeConfig({
    defaultSource: vol('modelscope'),
    idleTimeoutMs: vol(60000),
    modelRoots: vol(['/models/a', '/models/b']),
    proxy: vol('socks5://127.0.0.1:1080'),
    locale: vol('en'),
    llamaArgs: vol(['--threads', '4'])
  });
  assert.equal(config.defaultSource, 'modelscope');
  assert.equal(config.idleTimeoutMs, 60000);
  assert.deepEqual(config.modelRoots, ['/models/a', '/models/b']);
  assert.equal(config.proxy.all, 'socks5://127.0.0.1:1080');
  assert.equal(config.locale, 'en');
  assert.deepEqual(config.llamaArgs, ['--threads', '4']);
});

test('config: proxy shorthand, empty strings are skipped, env is cleaned', () => {
  const config = normalizeConfig({ proxy: 'http://127.0.0.1:7890' });
  assert.equal(config.proxy.all, 'http://127.0.0.1:7890');
  const previous = { HTTP_PROXY: process.env.HTTP_PROXY, NO_PROXY: process.env.NO_PROXY };
  process.env.HTTP_PROXY = '';
  process.env.NO_PROXY = '';
  try {
    const env = buildChildEnv(config, { source: 'hf-mirror', endpoint: 'https://hf-mirror.com' });
    assert.equal(env.HTTP_PROXY, 'http://127.0.0.1:7890');
    assert.equal(env.ALL_PROXY, 'http://127.0.0.1:7890');
    assert.equal(env.HF_ENDPOINT, 'https://hf-mirror.com');
    assert.equal(env.NO_PROXY, '127.0.0.1,localhost');
    assert.notEqual(process.env.NO_PROXY, '127.0.0.1,localhost');
  } finally {
    if (previous.HTTP_PROXY === undefined) delete process.env.HTTP_PROXY;
    else process.env.HTTP_PROXY = previous.HTTP_PROXY;
    if (previous.NO_PROXY === undefined) delete process.env.NO_PROXY;
    else process.env.NO_PROXY = previous.NO_PROXY;
  }
});

test('config: endpoints follow configured mirror and modelscope site', () => {
  const config = normalizeConfig({ modelscopeEndpoint: 'https://www.modelscope.ai', hfEndpoint: 'https://hf.example' });
  assert.equal(endpointFor('modelscope', config), 'https://www.modelscope.ai');
  assert.equal(endpointFor('hf-mirror', config), 'https://hf-mirror.com');
  assert.equal(endpointFor('huggingface', config), 'https://hf.example');
  assert.deepEqual(effectiveModelRoots(config).length, 1);
});

test('util: slug, ids, sizes', () => {
  assert.equal(slugify('Qwen/Qwen2.5 7B'), 'qwen-qwen2-5-7b');
  assert.match(modelIdFor('tiny', '/tmp/a'), /^tiny-[0-9a-f]{8}$/u);
  assert.equal(formatBytes(1536), '1.5 KiB');
  assert.equal(formatDuration(65), '1m05s');
});

await testAsync('scan: GGUF metadata comes from the header', async () => {
  const header = await readGgufMetadata(ggufPath);
  assert.equal(header.ok, true);
  assert.equal(header.version, 3);
  assert.equal(header.fileType, 15);
  assert.equal(header.architecture, 'qwen2');
  const detected = await detectGgufFile(ggufPath);
  assert.equal(detected.quant, 'Q4_K_M');
  assert.equal(detected.quantEvidence, 'gguf-header');
});

await testAsync('scan: MLX directory reads config.quantization', async () => {
  const detected = await detectModelDirectory(mlxDir);
  assert.equal(detected.format, 'mlx');
  assert.equal(detected.quant, 'mlx-4bit-g64');
  assert.equal(detected.quantEvidence, 'config.quantization');
});

await testAsync('scan: safetensors directory reads dtype', async () => {
  const detected = await detectModelDirectory(safetensorsDir);
  assert.equal(detected.format, 'safetensors');
  assert.equal(detected.quant, 'bf16');
  assert.equal(detected.quantEvidence, 'safetensors-header');
});

await testAsync('scan: missing file_type falls back to tensor types', async () => {
  const detected = await detectGgufFile(ggufLegacyPath);
  assert.equal(detected.quant, 'Q8_0');
  assert.equal(detected.quantEvidence, 'gguf-tensor-types');
});

await testAsync('scan: roots produce candidates with evidence', async () => {
  const scan = await scanModelRoots([modelsRoot], { maxDepth: 4 });
  assert.equal(scan.candidates.length, 4);
  const gguf = scan.candidates.find((entry) => entry.format === 'gguf');
  assert.ok(gguf);
  assert.equal(gguf.quant, 'Q4_K_M');
  assert.equal(gguf.quantEvidence, 'gguf-header');
  const mlx = scan.candidates.find((entry) => entry.format === 'mlx');
  assert.equal(mlx.quant, 'mlx-4bit-g64');
});

await testAsync('registry: atomic write, reload, tolerant corruption', async () => {
  const file = path.join(tmpRoot, 'hub', 'registry.json');
  const registry = new ModelRegistry({ file });
  await registry.load();
  const { entry, created } = await registry.register({
    path: ggufPath,
    displayName: 'Fixture Q4',
    source: 'hf-mirror',
    repoId: 'org/fixture',
    format: 'gguf',
    quant: 'Q4_K_M',
    sizeBytes: 123,
    runtimePreference: 'llama-server'
  });
  assert.equal(created, true);
  assert.equal(entry.quant, 'Q4_K_M');
  await registry.update(entry.id, { loaded: false, lastUsedAt: '2026-01-01T00:00:00.000Z' });
  const reloaded = new ModelRegistry({ file });
  await reloaded.load();
  assert.equal(reloaded.get(entry.id)?.lastUsedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(reloaded.findByPath(ggufPath)?.id, entry.id);
  await fs.writeFile(file, '{ not json', 'utf8');
  const corrupt = new ModelRegistry({ file });
  await corrupt.load();
  assert.equal(corrupt.list().length, 0);
});

test('runtime: llama.cpp asset selection per backend', () => {
  const assets = [
    { name: 'llama-b1-bin-win-cpu-x64.zip' },
    { name: 'llama-b1-bin-win-cpu-arm64.zip' },
    { name: 'llama-b1-bin-win-vulkan-x64.zip' },
    { name: 'llama-b1-bin-win-vulkan-arm64.zip' },
    { name: 'llama-b1-bin-win-cuda-12.4-x64.zip' },
    { name: 'llama-b1-bin-win-cuda-13.4-x64.zip' },
    { name: 'llama-b1-bin-win-cuda-13.4-arm64.zip' },
    { name: 'cudart-llama-bin-win-cuda-12.4-x64.zip' },
    { name: 'cudart-llama-bin-win-cuda-13.4-x64.zip' },
    { name: 'cudart-llama-bin-win-cuda-13.4-arm64.zip' }
  ];
  const cuda = selectAssets(assets, 'cuda');
  assert.equal(cuda.main.name, 'llama-b1-bin-win-cuda-13.4-x64.zip');
  assert.equal(cuda.cudart.name, 'cudart-llama-bin-win-cuda-13.4-x64.zip');
  const cpu = selectAssets(assets, 'cpu');
  assert.equal(cpu.main.name, 'llama-b1-bin-win-cpu-x64.zip');
  assert.equal(cpu.cudart, null);
  const vulkan = selectAssets(assets, 'vulkan');
  assert.equal(vulkan.main.name, 'llama-b1-bin-win-vulkan-x64.zip');
  const noCudart = selectAssets(assets.filter((asset) => !asset.name.startsWith('cudart')), 'cuda');
  assert.equal(noCudart.main.name, 'llama-b1-bin-win-cuda-13.4-x64.zip');
  assert.equal(noCudart.cudart, null);
});

test('download: include glob matching', () => {
  assert.equal(globMatch('*Q4_K_M.gguf', 'Qwen-Q4_K_M.gguf'), true);
  assert.equal(globMatch('*Q4_K_M.gguf', 'Qwen-Q8_0.gguf'), false);
  assert.equal(globMatch('subdir/**', 'subdir/a/b.gguf'), true);
  assert.equal(globMatch('*.safetensors', 'nested/model.safetensors'), false);
});

test('download: CLI and SDK argv shapes', () => {
  const tooling = {
    hf: { cli: 'C:/bin/hf', cliKind: 'hf', sdk: true, python: 'python' },
    modelscope: { cli: 'C:/bin/modelscope', cliKind: 'modelscope', sdk: true, python: 'python' },
    preferred: { huggingface: 'hf-cli', modelscope: 'modelscope-cli' }
  };
  const hfCli = buildDownloadArgv({
    source: 'hf-mirror', repoId: 'a/b', revision: 'main', include: '*Q4_K_M.gguf',
    localDir: 'C:/models/a', method: 'hf-cli', tooling
  });
  assert.deepEqual(hfCli.argv, ['C:/bin/hf', 'download', 'a/b', '--local-dir', 'C:/models/a', '--revision', 'main', '--include', '*Q4_K_M.gguf']);
  const hfSdk = buildDownloadArgv({
    source: 'huggingface', repoId: 'a/b', localDir: 'C:/models/a', method: 'hf-sdk', tooling
  });
  assert.equal(hfSdk.argv[0], 'python');
  assert.ok(hfSdk.argv.some((argument) => argument.includes('huggingface_hub')));
  assert.deepEqual(chooseMethod('hf-mirror', 'cli', tooling), { method: 'hf-cli' });
  assert.deepEqual(chooseMethod('modelscope', 'sdk', tooling), { method: 'modelscope-sdk' });
  const noTools = {
    hf: { cli: null, cliKind: null, sdk: false, python: null },
    modelscope: { cli: null, cliKind: null, sdk: false, python: null },
    preferred: { huggingface: null, modelscope: null }
  };
  assert.equal(chooseMethod('hf-mirror', 'auto', noTools).method, null);
});

await testAsync('download: resumable transfer with progress against a local server', async () => {
  const http = await import('node:http');
  const payload = Buffer.alloc(512 * 1024, 7);
  const server = http.createServer((request, response) => {
    const range = request.headers.range;
    if (range !== undefined) {
      const start = Number.parseInt(/bytes=(\d+)-/u.exec(range)?.[1] ?? '0', 10);
      response.writeHead(206, {
        'content-type': 'application/octet-stream',
        'content-length': payload.length - start,
        'content-range': `bytes ${start}-${payload.length - 1}/${payload.length}`,
        'accept-ranges': 'bytes'
      });
      response.end(payload.subarray(start));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': payload.length, 'accept-ranges': 'bytes' });
    response.end(payload);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const dest = path.join(tmpRoot, 'downloads', 'blob.bin');
  try {
    const seen = [];
    const first = await downloadFile({
      url: `http://127.0.0.1:${port}/blob.bin`,
      dest,
      onProgress: (progress) => seen.push(progress.bytes)
    });
    assert.equal(first.bytes, payload.length);
    assert.ok(seen.length >= 1);
    await fs.truncate(dest, 200 * 1024);
    const second = await downloadFile({ url: `http://127.0.0.1:${port}/blob.bin`, dest });
    assert.equal(second.bytes, payload.length);
    assert.equal(second.resumed, true);
    const written = await fs.readFile(dest);
    assert.equal(written.length, payload.length);
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// tool-level smoke tests with stub dependencies
// ---------------------------------------------------------------------------

const config = normalizeConfig({
  modelRoots: [modelsRoot],
  locale: 'en',
  idleTimeoutMs: 60000,
  loadTimeoutMs: 5000
});
const registry = new ModelRegistry({ file: path.join(tmpRoot, 'hub2', 'registry.json') });
await registry.load();
const supervisor = new InferenceSupervisor({ config, registry });
const downloadsStub = {
  list: () => [],
  start: async () => { throw new Error('not used'); },
  wait: async () => undefined,
  get: () => undefined,
  cancel: () => false,
  dispose: () => {},
  ready: Promise.resolve()
};
const state = { recent: () => [], pushRelease: () => {} };
const toolDeps = {
  ctx: {},
  config,
  registry,
  downloads: downloadsStub,
  supervisor,
  scanCache: new Map(),
  state,
  getLocale: () => ({ locale: 'en', source: 'config', translate: (key, vars) => t('en', key, vars) })
};
const tools = createTools(toolDeps);
const byName = new Map(tools.map((definition) => [definition.name, definition]));

const supportedKeywords = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'description', 'title', 'default', 'examples']);
function validateSchema(node, pathLabel = 'schema') {
  assert.ok(node !== null && typeof node === 'object', `${pathLabel} must be an object`);
  for (const key of Object.keys(node)) {
    assert.ok(supportedKeywords.has(key), `${pathLabel}.${key} is not a supported keyword`);
  }
  if (node.type !== undefined) {
    assert.ok(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(node.type), `${pathLabel}.type`);
  }
  if (node.type === 'array') {
    assert.ok(node.items !== undefined, `${pathLabel} array needs items`);
    validateSchema(node.items, `${pathLabel}.items`);
  }
  if (node.properties !== undefined) {
    for (const [name, child] of Object.entries(node.properties)) validateSchema(child, `${pathLabel}.${name}`);
    if (node.required !== undefined) {
      for (const name of node.required) assert.ok(Object.hasOwn(node.properties, name), `${pathLabel}.required ${name}`);
    }
  }
  if (node.oneOf !== undefined) {
    assert.equal(node.oneOf.length, 2, `${pathLabel}.oneOf length`);
    for (const [index, child] of node.oneOf.entries()) validateSchema(child, `${pathLabel}.oneOf[${index}]`);
  }
  if (node.enum !== undefined) assert.ok(Array.isArray(node.enum));
}

test('tools: names, schemas are inside the enforced JSON-schema subset', () => {
  const expected = ['model_search', 'model_download', 'model_download_status', 'model_scan', 'model_register', 'model_load', 'model_unload', 'model_infer', 'runtime_status', 'runtime_install'];
  assert.deepEqual([...byName.keys()].sort(), expected.sort());
  for (const definition of tools) {
    assert.equal(definition.parameters.type, 'object');
    validateSchema(definition.parameters, `${definition.name}.parameters`);
    validateSchema(definition.output.schema, `${definition.name}.output`);
    assert.equal(typeof definition.output.render, 'function');
  }
});

await testAsync('tools: prompt section localizes and lists registered models', async () => {
  await registry.register({
    path: ggufPath, displayName: 'Fixture Q4', source: 'local', format: 'gguf', quant: 'Q4_K_M',
    sizeBytes: 1, runtimePreference: 'llama-server'
  });
  const en = promptSectionText({ config, registry, tooling: null, state, translate: (key, vars) => t('en', key, vars) });
  assert.match(en, /Local model hub/u);
  assert.match(en, /GGUF/u);
  assert.match(en, /Q4_K_M/u);
  assert.match(en, /not loaded/u);
  const zh = promptSectionText({ config, registry, tooling: null, state, translate: (key, vars) => t('zh', key, vars) });
  assert.match(zh, /本地模型中枢/u);
  assert.match(zh, /未加载/u);
});

await testAsync('tools: model_scan returns new candidates and registered state', async () => {
  const result = await byName.get('model_scan').execute({ roots: [modelsRoot], maxDepth: 4 }, { signal: new AbortController().signal });
  assert.equal(result.discovered.length, 4);
  assert.ok(result.newCount >= 3);
  assert.ok(result.text.includes('Q4_K_M'));
  assert.ok(result.text.includes('registered as'));
  const registered = result.discovered.filter((entry) => entry.registered);
  assert.equal(registered.length, 1);
});

await testAsync('tools: model_register registers by id from the scan cache', async () => {
  const scan = await byName.get('model_scan').execute({ roots: [modelsRoot] }, { signal: new AbortController().signal });
  const candidate = scan.discovered.find((entry) => entry.format === 'mlx');
  const result = await byName.get('model_register').execute({ modelId: candidate.id }, { signal: new AbortController().signal });
  assert.equal(result.created, true);
  assert.equal(result.entry.format, 'mlx');
  assert.equal(result.entry.runtimePreference, 'mlxcel-server');
  const stored = registry.findByPath(mlxDir);
  assert.ok(stored);
  assert.equal(stored.id, result.entry.id);
});

await testAsync('tools: runtime_status reports platform and registered models', async () => {
  const result = await byName.get('runtime_status').execute({ verify: false }, { signal: new AbortController().signal });
  assert.equal(result.platform, process.platform);
  assert.equal(result.locale, 'en');
  assert.equal(result.models.length, registry.list().length);
  assert.match(result.text, /Runtime status/u);
  assert.ok(Array.isArray(result.runtimes));
});

await testAsync('tools: model_load reports a missing runtime cleanly', async () => {
  const model = registry.list().find((entry) => entry.format === 'gguf');
  if (process.platform === 'win32' && runtimeMod) {
    const result = await byName.get('model_load').execute({ modelId: model.id }, { signal: new AbortController().signal })
      .then(() => null)
      .catch((error) => error);
    // On a Windows host without llama-server installed this must be a readable error.
    if (result !== null) assert.match(result.message, /llama-server|runtime/iu);
  }
});

await testAsync('tools: model_unload on a not-loaded model is a no-op', async () => {
  const model = registry.list()[0];
  const result = await byName.get('model_unload').execute({ modelId: model.id }, { signal: new AbortController().signal });
  assert.equal(result.stopped, false);
  assert.ok(result.text.length > 0);
});

await testAsync('tools: model_infer without load reports NOT_LOADED', async () => {
  const model = registry.list()[0];
  const error = await byName.get('model_infer').execute({ modelId: model.id, prompt: 'hi' }, { signal: new AbortController().signal })
    .then(() => null)
    .catch((caught) => caught);
  assert.ok(error !== null);
  assert.match(error.message, /not loaded|未加载/iu);
});

await testAsync('teardown: supervisor dispose is idempotent with no children', async () => {
  await supervisor.dispose();
  await supervisor.dispose();
});

// ---------------------------------------------------------------------------

const failed = results.filter((entry) => entry.ok !== true);
for (const entry of results) {
  console.log(`${entry.ok ? 'PASS' : 'FAIL'} ${entry.name}`);
  if (!entry.ok) console.log(entry.error?.stack ?? entry.error);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await fs.rm(tmpRoot, { recursive: true, force: true });
process.exit(failed.length === 0 ? 0 : 1);
