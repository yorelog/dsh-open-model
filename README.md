<p align="center">
  <img src="./icon.svg" width="96" height="96" alt="dsh-open-model icon">
</p>

# dsh-open-model

Repository: <https://github.com/yorelog/dsh-open-model>

Local open-model hub for DeepSeek Harness (dsh). One Host bundle covers the
whole loop: **search → download → discover/register → start inference → release
when idle**, with a Windows runtime (llama-server) and an Apple Silicon runtime
(mlxcel-server), mirror/proxy support for mainland networks, and zh/en output
that follows the session language.

[中文说明](#中文说明)

## Platform matrix

| Platform | Runtime | Model formats | Notes |
|---|---|---|---|
| Windows x64 | `llama-server` | GGUF | releases from `ggml-org/llama.cpp`; CPU / CUDA (+ cudart) / Vulkan |
| macOS arm64 | `mlxcel-server` | MLX, safetensors | Homebrew first, GitHub archive second, source build documented as last resort |
| macOS x64 | — | — | `runtime_status` reports mlxcel as unsupported |
| Linux | — | — | llama-server is not managed here; tools report the platform as unsupported |

## Tools

| Tool | Purpose |
|---|---|
| `model_search` | Search HuggingFace / hf-mirror / ModelScope; returns repo ids, stats, tags, homepage, a slim file list and a `downloadHint` |
| `model_download` | Download via the hub CLI (SDK fallback) with mirrored endpoint + proxy, progress, resume and optional background mode |
| `model_download_status` | Byte progress, speed, ETA, and cancellation |
| `model_scan` | Scan model roots; format and quantization come from file headers / sibling metadata |
| `model_register` | Register a discovered or downloaded model (by path or scan id) |
| `model_load` | Start the platform runtime, record PID/port/timestamps, wait for health |
| `model_unload` | Graceful stop, then forced kill after the grace period |
| `model_infer` | OpenAI-compatible chat/completions call; refreshes `lastUsedAt` |
| `runtime_status` | Runtime availability, path, version, missing CUDA DLLs, registered models |
| `runtime_install` | Install llama-server (Windows) or mlxcel (Apple Silicon) |

The prompt section lists every registered model as `id · format · quant ·
loaded`, so the model knows what is available without a tool round-trip. It also
reports which download transport was verified in this environment.

## Configuration

All fields are optional; the row's `config` is validated by Schemastery when the
Host resolves it, and by a Standard-Schema fallback otherwise. Editing the
config restarts this plugin row (hot reload) and tears down owned servers.

| Field | Default | Meaning |
|---|---|---|
| `modelRoots` | `[]` → `${DSH_HOME}/models` | Extra/discovery roots scanned by `model_scan` |
| `runtimeDir` | `''` | Directory holding `llama-server` / `mlxcel-server` |
| `idleTimeoutMs` | `300000` | Release a model after this much inactivity |
| `idleCheckIntervalMs` | `30000` | Idle sweep period |
| `defaultSource` | `hf-mirror` | Used when a tool call omits `source` |
| `hfEndpoint` | `''` → `HF_ENDPOINT` → official Hub | Endpoint for `source=huggingface` |
| `hfMirrorEndpoint` | `https://hf-mirror.com` | Endpoint injected as `HF_ENDPOINT` for `source=hf-mirror` |
| `modelscopeEndpoint` | `https://modelscope.cn` | Domestic or international ModelScope site |
| `proxy` | `{}` | A URL string, or `{ http, https, all, noProxy }` |
| `githubProxyPrefix` | `''` | Prefix for GitHub release URLs, used only after a direct failure |
| `backend` | `auto` | llama.cpp Windows backend: `auto/cpu/cuda/vulkan` |
| `locale` | `auto` | `auto/zh/en`; `auto` follows the session |
| `serverHost` | `127.0.0.1` | Inference bind address |
| `loadTimeoutMs` | `180000` | Startup health timeout |
| `stopGraceMs` | `10000` | Grace between SIGTERM/taskkill and forced kill |
| `requestTimeoutMs` | `120000` | `model_infer` timeout |
| `scanDepth` | `4` | `model_scan` recursion depth |
| `downloadMethod` | `auto` | `auto/cli/sdk` |
| `llamaArgs` / `mlxcelArgs` | `[]` | Extra argv appended to the server |

Example profile patch:

```yaml
- id: dsh-open-model
  name: 'dsh-open-model'
  config:
    idleTimeoutMs: 300000
    proxy:
      https: http://127.0.0.1:7890
    githubProxyPrefix: https://gh-proxy.com/
    modelscopeEndpoint: https://www.modelscope.ai
```

## Mirrors, proxies and tokens

- Every Hub/ModelScope request resolves its endpoint from configuration; no
  site is baked into the request path. `hf-mirror` sets `HF_ENDPOINT` for the
  child process, so a user's global HuggingFace configuration cannot redirect a
  download to the wrong host.
- Child processes inherit the proxy environment built by the plugin:
  `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` and `NO_PROXY` are written in both
  cases. Empty inherited or configured values are **deleted**, because an empty
  proxy variable makes most HTTP stacks silently connect directly.
- When a proxy is configured, HTTP calls (API and release downloads) go through
  `curl -x`; otherwise Node's fetch is used.
- ModelScope tokens are never copied between `modelscope.cn` and
  `modelscope.ai`; the endpoint you configure is the endpoint that receives the
  token from your environment (`MODELSCOPE_API_TOKEN`).
- GitHub downloads are tried directly first. The proxy prefix is used only
  after a failure/slow probe, and only if it came from `githubProxyPrefix` or
  the `proxyPrefix` argument — nothing is hardcoded.

## Persistence

| Path | Content |
|---|---|
| `${DSH_HOME}/model-hub/registry.json` | Registered models, runtime state (pid/port/startedAt/lastUsedAt) |
| `${DSH_HOME}/model-hub/runtimes.json` | Discovered runtime cache (path/version/backend) |
| `${DSH_HOME}/model-hub/downloads.json` | Download journal (bounded) |
| `${DSH_HOME}/model-hub/state.json` | Recent automatic releases |
| `${DSH_HOME}/runtimes/...` | Runtimes installed by this plugin |
| `${DSH_HOME}/models/...` | Default download/scan root |

Every write is temp-file + rename. Reads tolerate a missing or corrupt file: the
registry resets to empty with a warning instead of blocking activation, and
runtime entries whose PID no longer exists are cleared on load.

## Lifecycle guarantees

- One model cannot be loaded twice: load/unload/registry writes share a keyed
  mutex.
- `model_infer` refreshes `lastUsedAt` before and after the request, so a long
  generation is never reaped mid-flight.
- The idle sweep runs on `ctx.effect`; its disposer clears the timer.
- The final `ctx.effect` disposes the supervisor and the download manager:
  every child process this plugin spawned is killed, and runtime fields are
  cleared, so hot reload leaves no orphaned server.
- Teardown is idempotent and safe when nothing is loaded.
- On Windows the graceful tier is `taskkill /T` (there is no SIGTERM for
  console apps); a server that ignores it is escalated to `/F` after
  `stopGraceMs` and the tool reports the escalation.

## Format detection

- **GGUF**: magic/version/tensor count and metadata are parsed from the header;
  `general.file_type` maps to a quantization label (`Q4_K_M`, `Q8_0`, …). When
  an older converter omits `general.file_type`, the tensor table's dominant
  ggml type supplies the label. The filename is used only when the header is
  unreadable, and `quantEvidence` reports which source decided.
- **safetensors**: the JSON header is read for tensor dtypes and `__metadata__`.
- **MLX**: a directory with `config.json`, weights, and a `quantization` block
  (bits/group size) is recognized as MLX and reported as `mlx-<bits>bit-g<group>`.

## Configuration schema

`Config` is a real Schemastery schema. A linked profile package cannot resolve
the Host's dependency graph through normal ESM lookup, so the plugin imports the
exact `@deepseek-ai/schemastery` file the Harness loads (derived from the Host
entry script and `process.resourcesPath`) and falls back to a Standard-Schema
object only when that lookup fails. The result is a Config row that Settings and
the Config inspector can project, with descriptions and defaults.

Tool descriptions are English model-facing protocol text; every tool result,
error, install instruction and release notice follows the session locale.

## Install

```text
plugin_manager install_bundle  target: <absolute path to this directory>
```

Install is local-directory based; there are no runtime dependencies. Then verify:

```text
cordis_inspect_query  Service.Tool.listTools        # 10 model_* / runtime_* tools
cordis_inspect_query  Config.listConfigs            # this row's schema
```

## Development

```bash
node test/selftest.mjs
```

The self-test builds synthetic GGUF/safetensors/MLX fixtures, imports the real
Host JSON-Schema subset validator when available, and checks schemas, outputs,
registry atomicity/corruption tolerance, quantization detection, proxy-env
sanitization and the prompt section in both languages.

## Known limits

- llama-server is installed only on Windows and mlxcel only on Apple Silicon;
  other combinations are reported as unsupported instead of guessed.
- CUDA builds need matching NVIDIA DLLs. `runtime_status` lists missing
  `cudart64_*` / `cublas64_*` / `cublasLt64_*` next to the executable or on
  `PATH` — it does not download them silently.
- Source builds of mlxcel (`cargo build --release --features metal,accelerate`)
  require the Rust/Metal toolchain and are documented, not automated.
- Hub rate limits and network policy apply as usual; failures are reported in
  the active language with the offending URL.
- The idle sweep frees servers, not downloaded files.

---

## 中文说明

`dsh-open-model` 是 DeepSeek Harness 的本地开源模型中枢，覆盖
**搜索 → 下载 → 发现/注册 → 启动推理 → 空闲释放** 全流程，在 Host 侧同时管理
Windows 的 `llama-server` 与 Apple Silicon 的 `mlxcel-server`，并针对国内网络做了
镜像与代理适配。

### 工具

| 工具 | 作用 |
|---|---|
| `model_search` | 搜索 HuggingFace / hf-mirror / ModelScope，返回 repoId、下载量、标签、主页、精简文件列表与 `downloadHint` |
| `model_download` | 通过 CLI（SDK 兜底）下载，注入镜像端点与代理，支持进度、断点续传与后台模式 |
| `model_download_status` | 字节进度、速度、ETA 与取消 |
| `model_scan` | 扫描模型根目录，格式与量化来自文件头/同目录元数据 |
| `model_register` | 按路径或扫描 id 写入注册表 |
| `model_load` | 启动运行时，记录 PID/端口/时间并等待健康检查 |
| `model_unload` | 先优雅终止，超时后强制结束 |
| `model_infer` | 发送 OAI 兼容请求，并刷新 `lastUsedAt` |
| `runtime_status` | 报告运行时可用性、路径、版本、缺失的 CUDA DLL 与已注册模型 |
| `runtime_install` | Windows 安装 llama-server，Apple Silicon 安装 mlxcel |

已注册模型会以 `id · 格式 · 量化 · 是否已加载` 的精简清单进入系统提示词，并按
`ctx.locale`/会话语言切换中英文；工具输出、错误消息、安装指引、空闲释放通知同样双语化。

### 配置与持久化

- 配置字段见上表，全部可省略；修改配置会触发插件行热重载。
- 注册表、运行时缓存、下载日志、释放通知都位于
  `${DSH_HOME}/model-hub/`，运行时安装到 `${DSH_HOME}/runtimes/`，默认模型根目录
  是 `${DSH_HOME}/models`。
- 所有写入都是“临时文件 + rename”；读取容忍文件缺失或损坏，损坏的注册表只会
  回退为空并记录警告，不会阻止插件加载。

### 镜像与代理

- 端点全部来自配置：`hfEndpoint`、`hfMirrorEndpoint`、`modelscopeEndpoint`，
  不会把 huggingface.co 写死在请求里；`hf-mirror` 会给子进程注入
  `HF_ENDPOINT`，不依赖用户全局配置。
- 子进程继承 `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`（大小写都写）；
  空字符串一律删除，避免“空代理 = 静默直连”。
- 配置代理时 HTTP 请求走 `curl -x`，否则用 Node fetch。
- GitHub 直连失败后才使用 `githubProxyPrefix` 或 `proxyPrefix` 参数，插件内不硬编码
  任何代理地址。
- ModelScope 国内站/国际站的 token 不互相复用，请用 `MODELSCOPE_API_TOKEN`
  并在配置里选择对应站点。

### 生命周期

- 同一模型不会被重复加载：加载/卸载/注册表写入共用一把按键互斥锁。
- 推理前后都会刷新 `lastUsedAt`，长请求不会被空闲扫描误杀。
- 空闲释放由 `ctx.effect` 注册的定时器执行（默认每 30s 检查一次，默认 5 分钟空闲）。
- 插件卸载时，同一个 effect 负责清定时器并终止本插件拉起的全部子进程，热重载不会
  遗留孤儿进程；重复卸载是安全的。

### 安装与验证

把本目录的绝对路径交给 `plugin_manager install_bundle` 即可；安装后用
`cordis_inspect_query` 查询 `Tool.listTools` 与 `Config.listConfigs` 确认工具与配置
schema。自测脚本为 `node test/selftest.mjs`。

### 已知限制

- 非 Windows 不管理 llama-server，非 Apple Silicon 不支持 mlxcel，插件会明确报告
  “不支持的平台”，而不是猜测路径。
- CUDA 版运行时需要匹配的 NVIDIA DLL；`runtime_status` 会检查并提示缺失项，但不会
  静默下载。
- mlxcel 源码构建（`cargo build --release --features metal,accelerate`）需要 Rust 与
  Metal 工具链，仅作为文档化的最后手段，未自动化。
- 空闲释放只停推理进程，不删除已下载的模型文件。
