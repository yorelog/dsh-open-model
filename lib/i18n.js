/**
 * Bilingual message catalog for every user-facing string this plugin produces.
 *
 * Design: one flat key space shared by `en` and `zh`; placeholders use
 * `{name}` and are filled by {@link t}. Business modules never embed prose, so
 * a new language only adds a table here. Tool descriptions stay English on
 * purpose: they are model-facing protocol text, not UI copy.
 * @module @local/open-model/lib/i18n
 */

/** @typedef {'zh' | 'en'} Locale */

const en = {
  'common.unknown': 'unknown',
  'common.none': 'none',
  'common.auto': 'auto',
  'common.loaded': 'loaded',
  'common.notLoaded': 'not loaded',
  'common.yes': 'yes',
  'common.no': 'no',

  'source.huggingface': 'HuggingFace',
  'source.hf-mirror': 'hf-mirror',
  'source.modelscope': 'ModelScope',
  'source.local': 'local',

  'format.gguf': 'GGUF',
  'format.safetensors': 'safetensors',
  'format.mlx': 'MLX',
  'format.unknown': 'unknown format',

  'runtime.llama': 'llama-server',
  'runtime.mlxcel': 'mlxcel-server',
  'runtime.auto': 'auto',

  'state.queued': 'queued',
  'state.running': 'running',
  'state.completed': 'completed',
  'state.failed': 'failed',
  'state.cancelled': 'cancelled',
  'state.interrupted': 'interrupted',

  'search.title': 'Found {count} model(s) on {source} via {endpoint}.',
  'search.empty': 'No model matched "{query}" on {source} ({endpoint}).',
  'search.line': '{index}. {repoId} — {downloads} downloads, {likes} likes, updated {updatedAt}{task}{tags}',
  'search.task': ', task {task}',
  'search.tags': ', tags: {tags}',
  'search.files': '   files ({count}{truncated}): {files}',
  'search.filesTruncated': ', showing {shown}',
  'search.homepage': '   homepage: {url}',
  'search.downloadHint': '   next: {hint}',
  'search.guidance': 'Choose a repoId above and call model_download(repoId, source). Use include to download a single quantization file; use localDir to place it under a specific model root.',
  'search.noSiblings': 'the hub does not expose a file list for this repository',

  'download.start': 'Downloading {repoId} from {source} into {dir} using {method}…',
  'download.done': 'Download completed in {elapsed}; {size} on disk.',
  'download.background': 'Download started in the background as {id}; poll model_download_status and cancel there if needed.',
  'download.failed': 'Download failed: {error}',
  'download.resume': 'Partial files were kept, so retrying the same repo resumes instead of restarting.',
  'download.cancelled': 'Download cancelled; partial files were kept for resume.',
  'download.cliPreferred': 'Download method: {method}.',
  'download.method.auto': 'auto-detected CLI',
  'download.method.hf-cli': 'HuggingFace CLI',
  'download.method.hf-sdk': 'huggingface_hub Python SDK',
  'download.method.modelscope-cli': 'ModelScope CLI',
  'download.method.modelscope-sdk': 'ModelScope Python SDK',
  'download.status.title': 'Downloads ({count}).',
  'download.status.empty': 'No download was started in this plugin instance.',
  'download.status.line': '{id} · {repoId} ({source}) · {state} · {bytes}{total} · {speed} · ETA {eta}',
  'download.status.total': ' / {total}',
  'download.status.cancelDone': 'Cancellation requested for {id}.',
  'download.status.cancelUnknown': 'No active download with id {id}.',
  'download.status.dir': '   dir: {dir}',
  'download.status.error': '   error: {error}',
  'download.noTooling': 'No usable download path: neither the hub CLI nor the Python SDK was found in this environment. Install huggingface_hub/hf or modelscope, then retry.',

  'scan.title': 'Scanned {roots}. Found {count} model(s); {newCount} not registered yet.',
  'scan.empty': 'No model files found under {roots}. Download one with model_download, or add roots to the modelRoots config.',
  'scan.line': '{index}. {format} · {quant} · {size} · {path}{registered}{evidence}',
  'scan.registered': ' · registered as {id}',
  'scan.unregistered': ' · not registered yet',
  'scan.evidence': ' · quant from {evidence}',
  'scan.next': 'Register a new candidate with model_register(path="<path>"), or model_register(modelId="<id>") after a scan returned an id.',
  'scan.warning': 'Note: {message}',
  'scan.warn.mmproj': 'this is a multimodal projector (mmproj), not a standalone model; pair it with its base GGUF',
  'scan.warn.header': 'the GGUF header could not be read ({detail}); quantization fell back to the filename',
  'scan.rootMissing': '{root} does not exist',

  'evidence.gguf-header': 'GGUF file header',
  'evidence.gguf-tensor-types': 'GGUF tensor types',
  'evidence.safetensors-header': 'safetensors header',
  'evidence.config.quantization': 'config.json quantization block',
  'evidence.config.quantization_config': 'config.json quantization_config',
  'evidence.config.torch_dtype': 'config.json torch_dtype',
  'evidence.filename': 'filename (header unreadable)',
  'evidence.none': 'no reliable evidence',

  'register.done': 'Registered {id} ({format}, {quant}) at {path}.',
  'register.updated': 'Refreshed registry entry {id}.',
  'register.missingArg': 'Provide modelId or path.',
  'register.notFound': 'Nothing at {path} looks like a supported model, and no scan candidate has id {id}.',
  'register.next': 'It is now listed in the system prompt and can be started with model_load(modelId="{id}").',

  'load.starting': 'Starting {runtime} for {modelId}…',
  'load.already': '{modelId} is already loaded on port {port} (pid {pid}).',
  'load.ready': '{modelId} is ready at {baseUrl} via {runtime} (pid {pid}, startup {elapsed}).',
  'load.unsupported': 'No supported runtime for format {format} on {platform}/{arch}. Windows uses llama-server with GGUF; Apple Silicon uses mlxcel-server with MLX models.',
  'load.runtimeMissing': 'The {runtime} runtime is not installed. Call runtime_status to inspect, then runtime_install.',
  'load.failed': 'Failed to start {runtime}: {error}',
  'load.timeout': 'Timed out after {seconds}s waiting for {runtime} to become ready. Last output: {output}',
  'load.exit': '{runtime} exited during startup (code {code}). Output: {output}',

  'unload.stopping': 'Stopping {modelId} ({pid})…',
  'unload.done': 'Stopped {modelId} (pid {pid}).',
  'unload.forced': 'Stopped {modelId} after escalating to a forced kill.',
  'unload.notLoaded': '{modelId} is not loaded; nothing to stop.',
  'unload.unknown': 'No registry entry with id {modelId}.',

  'infer.notLoaded': '{modelId} is not loaded. Call model_load first.',
  'infer.done': '{modelId} answered in {elapsed} ({tokens} tokens).',
  'infer.failed': 'Inference failed: {error}',
  'infer.dead': '{modelId} looks loaded but its server is unreachable on port {port}; the stale state was cleared, call model_load again.',

  'runtime.status.title': 'Runtime status · {platform}/{arch} · language {locale}.',
  'runtime.status.supported': 'Supported runtimes: {list}.',
  'runtime.status.none': 'no inference runtime is available yet',
  'runtime.status.line': '{name}: {state}{version}{path}{missing}',
  'runtime.status.stateOk': 'available',
  'runtime.status.stateMissing': 'not found',
  'runtime.status.version': ' · {version}',
  'runtime.status.path': ' · {path}',
  'runtime.status.missing': ' · missing: {list}',
  'runtime.status.cuda': 'CUDA runtime check: {state}.',
  'runtime.status.cudaOk': 'all required DLLs are next to the executable',
  'runtime.status.cudaMissing': 'missing DLLs {list}; put them beside {exe} or on PATH',
  'runtime.status.cudaNotCuda': 'this build has no CUDA backend (CPU/Vulkan), so no CUDA DLLs are needed',
  'runtime.status.mlxcelUnsupported': 'mlxcel targets Apple Silicon only; this {arch} Mac is not supported.',
  'runtime.status.mlxcelLinux': 'mlxcel is only supported on macOS (Apple Silicon); Windows uses llama-server.',
  'runtime.status.models': 'Registered models: {count} ({loaded} loaded).',
  'runtime.status.modelsNone': 'No model is registered yet.',
  'runtime.status.modelLine': '   {id} · {format} · {quant} · {loaded}{port}',
  'runtime.status.port': ' · port {port}',
  'runtime.status.registry': 'Registry: {path}',
  'runtime.status.recent': 'Recent automatic releases: {items}',
  'runtime.status.released': '{id} at {at}',

  'runtime.install.resolving': 'Resolving the latest {runtime} release for {platform}/{arch}…',
  'runtime.install.noRelease': 'No {runtime} release with matching assets was found.',
  'runtime.install.plan': 'Plan: {commands}',
  'runtime.install.dryRun': 'Dry run only; nothing was downloaded or installed.',
  'runtime.install.downloading': 'Downloading {name} ({size})…',
  'runtime.install.proxyRetry': 'Direct download failed ({error}); retrying through the configured GitHub proxy prefix.',
  'runtime.install.noProxy': 'Direct download failed ({error}) and no githubProxyPrefix is configured. Set githubProxyPrefix in the plugin config or pass proxyPrefix explicitly; nothing is hardcoded.',
  'runtime.install.extracting': 'Extracting {name}…',
  'runtime.install.done': 'Installed {runtime} {version} at {path}.',
  'runtime.install.brew': 'Installing mlxcel through Homebrew ({commands}).',
  'runtime.install.brewMissing': 'Homebrew is not available; falling back to the macOS release archive.',
  'runtime.install.intel': 'mlxcel supports Apple Silicon only; install was refused on this {arch} Mac.',
  'runtime.install.unsupportedPlatform': 'Runtime {runtime} is not supported on {platform}/{arch}.',
  'runtime.install.layout': 'Archive layout kept as published (including any mlx.metallib or runtime libraries shipped beside the binaries).',
  'runtime.install.verify': 'Verified by running "{command}" → {version}.',
  'runtime.install.verifyFailed': 'Installed files were extracted, but "{command}" did not verify: {error}',
  'runtime.install.assetMissing': 'Release {tag} has no asset matching {pattern}.',
  'runtime.install.cudartMissing': 'Release {tag} does not publish the matching cudart archive for {backend}; CUDA DLLs must be provided separately.',
  'runtime.install.reasonChecksum': 'The downloaded archive did not match its published SHA-256; nothing was installed.',
  'runtime.install.reasonIncomplete': 'The archive did not contain mlxcel-server; nothing was installed.',
  'runtime.install.reasonBrewFailed': 'Homebrew installation failed: {error}',

  'idle.released': 'Released {modelId} after {minutes} min idle; {runtime} on port {port} was stopped.',
  'idle.header': 'Model hub notices:',

  'sys.sectionHeader': 'Local model hub (this session):',
  'sys.modelLine': '- {id} · {format} · {quant} · {loaded}',
  'sys.loadedWith': ' {loaded}',
  'sys.guidance': 'Use model_load before model_infer; llama-server serves GGUF and mlxcel-server serves MLX. Idle servers are released automatically after {minutes} min.',
  'sys.guidanceNoModels': 'No local model is registered yet. Use model_search then model_download to fetch one, or model_scan to adopt files already on disk.',
  'sys.downloadMethod': 'Verified download tooling: {method}. Prefer it over the other path.',
  'sys.recent': 'Recently released automatically: {items}.',

  'errors.http': 'HTTP {status} from {url}: {body}',
  'errors.fetch': 'Request to {url} failed: {error}',
  'errors.json': 'Invalid JSON returned by {url}.',
  'errors.curlMissing': 'A proxy is configured but curl was not found; install curl or unset the proxy config.',
  'errors.pythonMissing': 'The {package} Python package is not available, and no CLI was found either.',
  'errors.source': 'Unknown source "{source}". Use one of: huggingface, hf-mirror, modelscope.',
  'errors.timeout': 'Request timed out after {seconds}s.',
  'errors.registryReset': 'The model registry was unreadable and was reset to empty: {error}',
  'errors.entryMissing': 'No registry entry with id {modelId}. Run model_scan and model_register first.',
  'errors.badArgs': 'Invalid arguments: {message}',
  'errors.downloadFailed': 'The download command failed with code {code}: {error}',
  'errors.notSupported': '{feature} is not supported on {platform}.',
  'errors.cancelled': 'The operation was cancelled.',
  'search.failed': 'The {source} search failed: {error}',
  'runtime.install.failed': 'Runtime installation failed: {error}',
};

const zh = {
  'common.unknown': '未知',
  'common.none': '无',
  'common.auto': '自动',
  'common.loaded': '已加载',
  'common.notLoaded': '未加载',
  'common.yes': '是',
  'common.no': '否',

  'source.huggingface': 'HuggingFace',
  'source.hf-mirror': 'hf-mirror',
  'source.modelscope': 'ModelScope',
  'source.local': '本地',

  'format.gguf': 'GGUF',
  'format.safetensors': 'safetensors',
  'format.mlx': 'MLX',
  'format.unknown': '未知格式',

  'runtime.llama': 'llama-server',
  'runtime.mlxcel': 'mlxcel-server',
  'runtime.auto': '自动',

  'state.queued': '排队中',
  'state.running': '下载中',
  'state.completed': '已完成',
  'state.failed': '失败',
  'state.cancelled': '已取消',
  'state.interrupted': '已中断',

  'search.title': '在 {source}（{endpoint}）找到 {count} 个模型。',
  'search.empty': '在 {source}（{endpoint}）没有匹配「{query}」的模型。',
  'search.line': '{index}. {repoId} — 下载 {downloads}，点赞 {likes}，更新于 {updatedAt}{task}{tags}',
  'search.task': '，任务 {task}',
  'search.tags': '，标签：{tags}',
  'search.files': '   文件（共 {count} 个{truncated}）：{files}',
  'search.filesTruncated': '，显示前 {shown} 个',
  'search.homepage': '   主页：{url}',
  'search.downloadHint': '   下一步：{hint}',
  'search.guidance': '选定上面的 repoId 后调用 model_download(repoId, source)。用 include 只下载某个量化文件；用 localDir 指定落到哪个模型目录。',
  'search.noSiblings': '该仓库没有返回文件列表',

  'download.start': '正在从 {source} 用 {method} 下载 {repoId} 到 {dir}…',
  'download.done': '下载完成，耗时 {elapsed}，磁盘占用 {size}。',
  'download.background': '已转入后台下载，任务 id 为 {id}；可用 model_download_status 查看进度或取消。',
  'download.failed': '下载失败：{error}',
  'download.resume': '已保留分片文件，重试同一仓库会断点续传而不是从头开始。',
  'download.cancelled': '下载已取消，分片文件已保留，可续传。',
  'download.cliPreferred': '下载方式：{method}。',
  'download.method.auto': '自动检测到的 CLI',
  'download.method.hf-cli': 'HuggingFace CLI',
  'download.method.hf-sdk': 'huggingface_hub Python SDK',
  'download.method.modelscope-cli': 'ModelScope CLI',
  'download.method.modelscope-sdk': 'ModelScope Python SDK',
  'download.status.title': '下载任务（{count} 个）。',
  'download.status.empty': '本插件实例尚未启动过下载。',
  'download.status.line': '{id} · {repoId}（{source}） · {state} · {bytes}{total} · {speed} · 剩余 {eta}',
  'download.status.total': ' / {total}',
  'download.status.cancelDone': '已请求取消 {id}。',
  'download.status.cancelUnknown': '没有正在进行的下载任务 {id}。',
  'download.status.dir': '   目录：{dir}',
  'download.status.error': '   错误：{error}',
  'download.noTooling': '没有可用的下载通道：环境中既没有 hub CLI，也没有可导入的 Python SDK。请先安装 huggingface_hub/hf 或 modelscope 后重试。',

  'scan.title': '已扫描 {roots}，发现 {count} 个模型，其中 {newCount} 个尚未注册。',
  'scan.empty': '在 {roots} 下没有找到模型文件。可以先用 model_download 下载，或在 modelRoots 配置里追加根目录。',
  'scan.line': '{index}. {format} · {quant} · {size} · {path}{registered}{evidence}',
  'scan.registered': ' · 已注册为 {id}',
  'scan.unregistered': ' · 尚未注册',
  'scan.evidence': ' · 量化来自 {evidence}',
  'scan.next': '用 model_register(path="<路径>") 注册新条目；扫描结果里的 id 也可以直接传给 model_register(modelId="<id>")。',
  'scan.warning': '注意：{message}',
  'scan.warn.mmproj': '这是多模态投影文件（mmproj），并非可独立运行的模型，请与其基础 GGUF 配套使用',
  'scan.warn.header': 'GGUF 文件头无法解析（{detail}），量化信息回退为文件名推断',
  'scan.rootMissing': '{root} 不存在',

  'evidence.gguf-header': 'GGUF 文件头',
  'evidence.gguf-tensor-types': 'GGUF 张量类型',
  'evidence.safetensors-header': 'safetensors 文件头',
  'evidence.config.quantization': 'config.json 的 quantization 配置',
  'evidence.config.quantization_config': 'config.json 的 quantization_config',
  'evidence.config.torch_dtype': 'config.json 的 torch_dtype',
  'evidence.filename': '文件名（文件头不可读）',
  'evidence.none': '没有可靠依据',

  'register.done': '已注册 {id}（{format}，{quant}），路径 {path}。',
  'register.updated': '已刷新注册表条目 {id}。',
  'register.missingArg': '请提供 modelId 或 path。',
  'register.notFound': '{path} 不像是受支持的模型，扫描结果里也没有 id 为 {id} 的候选。',
  'register.next': '该模型已进入系统提示词的本地模型清单，可用 model_load(modelId="{id}") 启动。',

  'load.starting': '正在为 {modelId} 启动 {runtime}…',
  'load.already': '{modelId} 已在端口 {port} 上加载（pid {pid}）。',
  'load.ready': '{modelId} 已通过 {runtime} 就绪：{baseUrl}（pid {pid}，启动耗时 {elapsed}）。',
  'load.unsupported': '在 {platform}/{arch} 上，{format} 格式没有可用的推理运行时。Windows 用 llama-server 跑 GGUF；Apple Silicon 用 mlxcel-server 跑 MLX 模型。',
  'load.runtimeMissing': '运行时 {runtime} 尚未安装。先调用 runtime_status 查看，再调用 runtime_install。',
  'load.failed': '启动 {runtime} 失败：{error}',
  'load.timeout': '等待 {runtime} 就绪超过 {seconds}s。最后输出：{output}',
  'load.exit': '{runtime} 在启动过程中退出（退出码 {code}）。输出：{output}',

  'unload.stopping': '正在停止 {modelId}（{pid}）…',
  'unload.done': '已停止 {modelId}（pid {pid}）。',
  'unload.forced': '已升级为强制终止并停止 {modelId}。',
  'unload.notLoaded': '{modelId} 未加载，无需停止。',
  'unload.unknown': '注册表里没有 id 为 {modelId} 的条目。',

  'infer.notLoaded': '{modelId} 未加载，请先调用 model_load。',
  'infer.done': '{modelId} 在 {elapsed} 内完成回答（{tokens} 个 token）。',
  'infer.failed': '推理失败：{error}',
  'infer.dead': '{modelId} 显示已加载，但端口 {port} 上的服务已不可达；已清理过期状态，请重新调用 model_load。',

  'runtime.status.title': '运行时状态 · {platform}/{arch} · 当前语言 {locale}。',
  'runtime.status.supported': '可用运行时：{list}。',
  'runtime.status.none': '还没有可用的推理运行时',
  'runtime.status.line': '{name}：{state}{version}{path}{missing}',
  'runtime.status.stateOk': '可用',
  'runtime.status.stateMissing': '未找到',
  'runtime.status.version': ' · {version}',
  'runtime.status.path': ' · {path}',
  'runtime.status.missing': ' · 缺少：{list}',
  'runtime.status.cuda': 'CUDA 运行时检查：{state}。',
  'runtime.status.cudaOk': '所需 DLL 与可执行文件同目录',
  'runtime.status.cudaMissing': '缺少 {list}；请放到 {exe} 同目录或加入 PATH',
  'runtime.status.cudaNotCuda': '当前是 CPU/Vulkan 版本，没有 CUDA 后端，无需 CUDA DLL',
  'runtime.status.mlxcelUnsupported': 'mlxcel 只支持 Apple Silicon；当前 {arch} Mac 不受支持。',
  'runtime.status.mlxcelLinux': 'mlxcel 仅支持 macOS（Apple Silicon）；Windows 请使用 llama-server。',
  'runtime.status.models': '已注册模型 {count} 个（{loaded} 个已加载）。',
  'runtime.status.modelsNone': '还没有注册任何模型。',
  'runtime.status.modelLine': '   {id} · {format} · {quant} · {loaded}{port}',
  'runtime.status.port': ' · 端口 {port}',
  'runtime.status.registry': '注册表：{path}',
  'runtime.status.recent': '最近的自动释放：{items}',
  'runtime.status.released': '{id}（{at}）',

  'runtime.install.resolving': '正在为 {platform}/{arch} 解析最新的 {runtime} 发行版…',
  'runtime.install.noRelease': '没有找到带匹配资产的 {runtime} 发行版。',
  'runtime.install.plan': '计划执行：{commands}',
  'runtime.install.dryRun': '仅为预演，未下载或安装任何内容。',
  'runtime.install.downloading': '正在下载 {name}（{size}）…',
  'runtime.install.proxyRetry': '直连下载失败（{error}），改用已配置的 GitHub 代理前缀重试。',
  'runtime.install.noProxy': '直连下载失败（{error}），且未配置 githubProxyPrefix。请在插件配置中设置 githubProxyPrefix，或显式传入 proxyPrefix；插件不会硬编码代理地址。',
  'runtime.install.extracting': '正在解压 {name}…',
  'runtime.install.done': '已安装 {runtime} {version} 到 {path}。',
  'runtime.install.brew': '正在通过 Homebrew 安装 mlxcel（{commands}）。',
  'runtime.install.brewMissing': '未检测到 Homebrew，回退到 macOS 发行版压缩包。',
  'runtime.install.intel': 'mlxcel 仅支持 Apple Silicon，当前 {arch} Mac 已拒绝安装。',
  'runtime.install.unsupportedPlatform': '运行时 {runtime} 不支持 {platform}/{arch}。',
  'runtime.install.layout': '按发行版原始布局保留文件（包括随二进制发布的 mlx.metallib 等运行时库）。',
  'runtime.install.verify': '已通过 "{command}" 验证 → {version}。',
  'runtime.install.verifyFailed': '文件已解压，但 "{command}" 验证失败：{error}',
  'runtime.install.assetMissing': '发行版 {tag} 中没有匹配 {pattern} 的资产。',
  'runtime.install.cudartMissing': '发行版 {tag} 没有为 {backend} 发布对应的 cudart 压缩包，CUDA DLL 需要另行提供。',
  'runtime.install.reasonChecksum': '下载的压缩包与发布的 SHA-256 不一致，未安装任何内容。',
  'runtime.install.reasonIncomplete': '压缩包里没有 mlxcel-server，未安装任何内容。',
  'runtime.install.reasonBrewFailed': 'Homebrew 安装失败：{error}',

  'idle.released': '{modelId} 空闲 {minutes} 分钟后已释放；端口 {port} 上的 {runtime} 已停止。',
  'idle.header': '模型中枢通知：',

  'sys.sectionHeader': '本地模型中枢（本会话）：',
  'sys.modelLine': '- {id} · {format} · {quant} · {loaded}',
  'sys.loadedWith': ' {loaded}',
  'sys.guidance': '推理前先用 model_load；llama-server 提供 GGUF，mlxcel-server 提供 MLX。空闲 {minutes} 分钟后服务会自动释放。',
  'sys.guidanceNoModels': '目前还没有注册本地模型。用 model_search 搜索后再用 model_download 下载，或用 model_scan 收纳磁盘上已有的文件。',
  'sys.downloadMethod': '已验证可用的下载工具：{method}，请优先使用它。',
  'sys.recent': '最近自动释放：{items}。',

  'errors.http': '{url} 返回 HTTP {status}：{body}',
  'errors.fetch': '请求 {url} 失败：{error}',
  'errors.json': '{url} 返回的不是合法 JSON。',
  'errors.curlMissing': '配置了代理但找不到 curl；请安装 curl，或取消代理配置。',
  'errors.pythonMissing': 'Python 包 {package} 不可用，同时也没有找到可用的 CLI。',
  'errors.source': '未知来源 "{source}"。可选：huggingface、hf-mirror、modelscope。',
  'errors.timeout': '请求超过 {seconds}s 超时。',
  'errors.registryReset': '注册表无法读取，已重置为空：{error}',
  'errors.entryMissing': '注册表中没有 id 为 {modelId} 的条目。请先执行 model_scan 与 model_register。',
  'errors.badArgs': '参数不合法：{message}',
  'errors.downloadFailed': '下载命令退出码 {code}：{error}',
  'errors.notSupported': '{feature} 在 {platform} 上不受支持。',
  'errors.cancelled': '操作已取消。',
  'search.failed': '{source} 搜索失败：{error}',
  'runtime.install.failed': '运行时安装失败：{error}',
};

/** @type {Record<Locale, Record<string, string>>} */
export const messages = { en, zh };

/**
 * Translate one key.
 * @param {Locale | string | undefined} locale
 * @param {string} key
 * @param {Record<string, string | number>} [vars]
 * @returns {string}
 */
export function t(locale, key, vars) {
  const table = messages[locale === 'zh' ? 'zh' : 'en'];
  let template = table[key];
  if (template === undefined) template = en[key];
  if (template === undefined) return key;
  if (vars === undefined) return template;
  return template.replace(/\{([a-z0-9_]+)\}/giu, (match, name) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * Bind a locale once so callers write `tt('scan.title', vars)`.
 * @param {Locale | string | undefined} locale
 * @returns {(key: string, vars?: Record<string, string | number>) => string}
 */
export function translator(locale) {
  const bound = locale === 'zh' ? 'zh' : 'en';
  return (key, vars) => t(bound, key, vars);
}

/**
 * Pick the message for the active locale.
 * @param {Locale | string | undefined} locale
 * @param {string} key
 * @param {Record<string, string | number>} [vars]
 * @returns {string}
 */
export function localized(locale, key, vars) {
  return t(locale, key, vars);
}
