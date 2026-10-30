/**
 * dsh-open-model — client half: the Settings → Open Model Hub control panel.
 *
 * Tabs: overview, model browser (search / download / local models), runtime
 * management, and the plugin configuration form. Dashboard data and actions go
 * through the plugin's same-origin JSON bridge (`/api/open-model/*`), which runs
 * the exact Host tool implementations; configuration rides the shared settings
 * transport (`ctx.configForms`).
 *
 * No Harness Client package is imported: React comes from the browser module
 * table, controls are plain elements, and colors come from `--dsw-alias-*`
 * theme tokens.
 *
 * @module dsh-open-model/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-open-model',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Localization namespace owned by this page. */
    const NS = 'settings.openModel';
    /** Host settings namespace: the Loader row's patch id. */
    const CONFIG_NS = 'dsh-open-model';
    /** Slot id for the Settings navigation entry. */
    const SECTION_ID = 'dsh-open-model';

    // ---------------------------------------------------------------------
    // Copy
    // ---------------------------------------------------------------------

    const en = {
      nav: 'Open Model Hub',
      title: 'Open Model Hub',
      subtitle: 'Search, download, register and run local models, all in one place.',
      tabs: { overview: 'Overview', models: 'Models', runtime: 'Runtime', settings: 'Settings' },
      common: {
        refresh: 'Refresh',
        retry: 'Retry',
        copy: 'Copy',
        copied: 'Copied',
        cancel: 'Cancel',
        close: 'Close',
        loading: 'Loading…',
        error: 'Something went wrong',
        none: 'None',
        yes: 'Yes',
        no: 'No'
      },
      overview: {
        quickTitle: 'How it works',
        step1: 'Search a model in the Models tab (or ask the assistant to search).',
        step2: 'Pick a repository and download it — the files land in your model folder.',
        step3: 'Start it from the local model list; llama-server serves GGUF models.',
        step4: 'Idle servers are released automatically after the configured timeout.',
        rootsTitle: 'Where local models live',
        rootsHint: 'Downloads land in <root>/<owner>/<name>. Put models you already have under one of these folders, then scan.',
        downloadPattern: 'Example: {path}',
        runtimeTitle: 'Inference runtime',
        runtimeReady: '{name} is ready ({version}).',
        runtimeMissing: '{name} is not installed yet.',
        runtimeAction: 'Open runtime settings',
        modelsTitle: 'Your models',
        modelCount: '{total} registered, {loaded} running.',
        modelCountNone: 'No model registered yet. Search and download one, or scan your model folder.',
        noRoots: 'No model folder is configured; the default is ${DSH_HOME}/models.'
      },
      models: {
        searchTitle: 'Search open models',
        query: 'Search',
        queryPlaceholder: 'For example qwen2.5 gguf',
        source: 'Source',
        limit: 'Results',
        include: 'File filter',
        includePlaceholder: 'Optional: *Q4_K_M.gguf',
        includeHint: 'Leave empty to download the whole repository. A filter downloads one quantization, which is usually what you want.',
        search: 'Search',
        searching: 'Searching…',
        results: 'Results',
        noResults: 'No model matched. Try a shorter query or another source.',
        downloads: 'downloads',
        updated: 'updated',
        files: 'files',
        download: 'Download',
        downloading: 'Starting…',
        downloadStarted: 'Download started: {repoId}',
        downloadsTitle: 'Downloads',
        noDownloads: 'No download in this session.',
        cancelDownload: 'Cancel',
        cancelled: 'Cancellation requested.',
        localTitle: 'Local models',
        localHint: 'Models live in the folders listed in Settings → Model roots. Files already on disk can be adopted with scan.',
        scan: 'Scan folders',
        scanning: 'Scanning…',
        scanResult: 'Found {count} model(s); {newCount} new.',
        discovered: 'Discovered',
        register: 'Register',
        registering: 'Registering…',
        registered: 'Registered {id}.',
        load: 'Start',
        loading: 'Starting…',
        unload: 'Stop',
        unloading: 'Stopping…',
        noLocal: 'No registered model yet.',
        noDiscovered: 'No new model file found.',
        state: { queued: 'queued', running: 'running', completed: 'completed', failed: 'failed', cancelled: 'cancelled', interrupted: 'interrupted' }
      },
      runtime: {
        title: 'Inference runtime',
        hint: 'Windows uses llama-server for GGUF; Apple Silicon uses mlxcel-server for MLX. Installers download from the official releases through the configured proxy.',
        available: 'Available',
        missing: 'Not installed',
        install: 'Install llama-server',
        installing: 'Installing… this can take a few minutes',
        backend: 'Backend',
        version: 'Version',
        path: 'Path',
        source: 'Source',
        mlxcelNote: 'mlxcel is supported on Apple Silicon only; this platform uses llama-server.',
        inspect: 'Refresh status',
        installNote: 'The CUDA build needs the matching NVIDIA runtime; the installer also fetches cudart.',
        installed: 'Installed. Version {version}.',
        unsupported: 'This runtime is not supported on this platform.'
      },
      settings: {
        description: 'Saving restarts this plugin and stops every model server it started.',
        group: {
          search: 'Search & download',
          network: 'Network & mirrors',
          runtime: 'Inference & resources',
          models: 'Local models',
          advanced: 'Advanced',
          interface: 'Interface'
        },
        field: {
          defaultSource: 'Default source',
          downloadMethod: 'Download transport',
          scanDepth: 'Scan depth',
          proxy: 'Proxy',
          githubProxyPrefix: 'GitHub proxy prefix',
          hfEndpoint: 'HuggingFace endpoint',
          hfMirrorEndpoint: 'hf-mirror endpoint',
          modelscopeEndpoint: 'ModelScope endpoint',
          serverHost: 'Bind address',
          backend: 'llama.cpp backend',
          idleTimeoutMs: 'Idle release after',
          idleCheckIntervalMs: 'Idle check every',
          loadTimeoutMs: 'Startup timeout',
          requestTimeoutMs: 'Request timeout',
          stopGraceMs: 'Stop grace period',
          modelRoots: 'Model roots',
          runtimeDir: 'Runtime directory',
          llamaArgs: 'llama-server arguments',
          mlxcelArgs: 'mlxcel-server arguments',
          locale: 'Output language'
        },
        hint: {
          defaultSource: 'Used when a model tool call omits its source.',
          downloadMethod: 'auto prefers the CLI verified in this environment, then the Python SDK.',
          scanDepth: 'Directory recursion depth for model_scan.',
          proxy: 'HTTP/SOCKS URL. A { http, https, all, noProxy } object is also accepted as JSON. Empty values are never forwarded to child processes.',
          githubProxyPrefix: 'Prepended to GitHub release URLs only after a direct attempt fails. Leave empty to disable; nothing is built in.',
          hfEndpoint: 'Empty uses HF_ENDPOINT, then the official site.',
          hfMirrorEndpoint: 'Injected as HF_ENDPOINT for source=hf-mirror.',
          modelscopeEndpoint: 'modelscope.cn or www.modelscope.ai. Tokens never cross sites.',
          serverHost: 'Loopback address used by local inference servers.',
          backend: 'Windows only. auto selects CUDA when nvidia-smi exists.',
          idleTimeoutMs: 'A loaded model is stopped after this much inactivity.',
          idleCheckIntervalMs: 'How often the idle reaper runs.',
          loadTimeoutMs: 'How long a new server may take to become healthy.',
          requestTimeoutMs: 'Per model_infer request.',
          stopGraceMs: 'Grace period between the graceful signal and a forced kill.',
          modelRoots: 'One path per line. Empty means ${DSH_HOME}/models.',
          runtimeDir: 'Directory holding llama-server / mlxcel-server binaries.',
          llamaArgs: 'One argv item per line, appended to the server command.',
          mlxcelArgs: 'One argv item per line, appended to the server command.',
          locale: 'auto follows the session language.'
        },
        option: {
          'defaultSource.hf-mirror': 'hf-mirror',
          'defaultSource.huggingface': 'HuggingFace',
          'defaultSource.modelscope': 'ModelScope',
          'downloadMethod.auto': 'Auto',
          'downloadMethod.cli': 'CLI',
          'downloadMethod.sdk': 'SDK',
          'backend.auto': 'Auto',
          'backend.cpu': 'CPU',
          'backend.cuda': 'CUDA',
          'backend.vulkan': 'Vulkan',
          'locale.auto': 'Auto (follow session)',
          'locale.zh': '中文',
          'locale.en': 'English'
        },
        unit: { minutes: 'min', seconds: 's' },
        error: {
          number: 'Enter a number, or leave blank to use the default.',
          range: 'Enter a value between {min} and {max}.',
          json: 'Enter a URL string or a valid JSON object.',
          option: 'Choose one of the listed values.'
        },
        placeholder: {
          proxy: 'http://127.0.0.1:7890',
          modelRoots: 'C:\\models',
          runtimeDir: 'C:\\tools\\llama.cpp',
          list: 'one item per line',
          text: 'leave blank to use the default'
        },
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved. The plugin restarts with the new configuration.',
        saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
        discard: 'Discard changes',
        reset: 'Reset to default',
        overridden: 'Overridden',
        noChanges: 'No changes to save.',
        fixErrors: 'Fix the highlighted fields before saving.',
        readOnly: 'This deployment stores settings read-only.',
        unavailable: 'This plugin row is not active, so its configuration is unavailable.',
        restartNote: 'Writes persist to this profile’s patch and restart the plugin row. Running models are stopped; download and registry data are kept.'
      }
    };

    const zh = {
      nav: '开源模型中枢',
      title: '开源模型中枢',
      subtitle: '搜索、下载、注册并运行本地模型，一个页面完成。',
      tabs: { overview: '总览', models: '模型', runtime: '运行时', settings: '设置' },
      common: {
        refresh: '刷新',
        retry: '重试',
        copy: '复制',
        copied: '已复制',
        cancel: '取消',
        close: '关闭',
        loading: '加载中…',
        error: '出错了',
        none: '无',
        yes: '是',
        no: '否'
      },
      overview: {
        quickTitle: '使用流程',
        step1: '在「模型」页搜索模型（也可以在对话里让我帮你搜）。',
        step2: '选中仓库并下载，文件会落到你的模型目录。',
        step3: '在本地模型列表里启动；GGUF 由 llama-server 提供推理。',
        step4: '空闲超过设定时间后，服务会自动释放。',
        rootsTitle: '本地模型放这里',
        rootsHint: '下载会落到 <根目录>/<owner>/<name>。已有模型放进这些目录后点「扫描」即可收录。',
        downloadPattern: '例如：{path}',
        runtimeTitle: '推理运行时',
        runtimeReady: '{name} 已就绪（{version}）。',
        runtimeMissing: '{name} 还没有安装。',
        runtimeAction: '打开运行时设置',
        modelsTitle: '你的模型',
        modelCount: '已注册 {total} 个，正在运行 {loaded} 个。',
        modelCountNone: '还没有注册模型。可以搜索下载，或扫描你的模型目录。',
        noRoots: '没有配置模型目录；默认是 ${DSH_HOME}/models。'
      },
      models: {
        searchTitle: '搜索开源模型',
        query: '搜索',
        queryPlaceholder: '例如 qwen2.5 gguf',
        source: '来源',
        limit: '结果数',
        include: '文件过滤',
        includePlaceholder: '可选：*Q4_K_M.gguf',
        includeHint: '留空表示下载整个仓库；建议填量化过滤，只下载需要的那个文件。',
        search: '搜索',
        searching: '搜索中…',
        results: '结果',
        noResults: '没有匹配的模型，换个短一点的关键词或来源试试。',
        downloads: '下载量',
        updated: '更新于',
        files: '文件',
        download: '下载',
        downloading: '启动中…',
        downloadStarted: '已开始下载：{repoId}',
        downloadsTitle: '下载任务',
        noDownloads: '本次会话还没有下载任务。',
        cancelDownload: '取消',
        cancelled: '已请求取消。',
        localTitle: '本地模型',
        localHint: '模型放在「设置 → 模型根目录」列出的目录里；磁盘上已有的文件可以点「扫描」收录。',
        scan: '扫描目录',
        scanning: '扫描中…',
        scanResult: '发现 {count} 个模型，其中 {newCount} 个是新的。',
        discovered: '新发现',
        register: '注册',
        registering: '注册中…',
        registered: '已注册 {id}。',
        load: '启动',
        loading: '启动中…',
        unload: '停止',
        unloading: '停止中…',
        noLocal: '还没有已注册的模型。',
        noDiscovered: '没有发现新的模型文件。',
        state: { queued: '排队中', running: '下载中', completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' }
      },
      runtime: {
        title: '推理运行时',
        hint: 'Windows 用 llama-server 跑 GGUF；Apple Silicon 用 mlxcel-server 跑 MLX。安装会通过配置的代理从官方 releases 下载。',
        available: '可用',
        missing: '未安装',
        install: '安装 llama-server',
        installing: '安装中…可能需要几分钟',
        backend: '后端',
        version: '版本',
        path: '路径',
        source: '来源',
        mlxcelNote: 'mlxcel 仅支持 Apple Silicon；当前平台使用 llama-server。',
        inspect: '刷新状态',
        installNote: 'CUDA 版需要对应的 NVIDIA 运行库；安装器会一并下载 cudart。',
        installed: '安装完成，版本 {version}。',
        unsupported: '当前平台不支持该运行时。'
      },
      settings: {
        description: '保存后会重启本插件，并停止它启动的所有模型服务。',
        group: {
          search: '搜索与下载',
          network: '网络与镜像',
          runtime: '推理与资源',
          models: '本地模型',
          advanced: '高级',
          interface: '界面'
        },
        field: {
          defaultSource: '默认来源',
          downloadMethod: '下载通道',
          scanDepth: '扫描深度',
          proxy: '代理',
          githubProxyPrefix: 'GitHub 代理前缀',
          hfEndpoint: 'HuggingFace 端点',
          hfMirrorEndpoint: 'hf-mirror 端点',
          modelscopeEndpoint: 'ModelScope 端点',
          serverHost: '监听地址',
          backend: 'llama.cpp 后端',
          idleTimeoutMs: '空闲释放时间',
          idleCheckIntervalMs: '空闲检查间隔',
          loadTimeoutMs: '启动超时',
          requestTimeoutMs: '请求超时',
          stopGraceMs: '停止宽限期',
          modelRoots: '模型根目录',
          runtimeDir: '运行时目录',
          llamaArgs: 'llama-server 参数',
          mlxcelArgs: 'mlxcel-server 参数',
          locale: '输出语言'
        },
        hint: {
          defaultSource: '模型的工具调用未指定 source 时使用。',
          downloadMethod: 'auto 优先使用环境中已验证的 CLI，其次才是 Python SDK。',
          scanDepth: 'model_scan 的目录递归深度。',
          proxy: 'HTTP/SOCKS 地址；也接受 { http, https, all, noProxy } 形式的 JSON。空值不会传给子进程。',
          githubProxyPrefix: '仅在 GitHub 直连失败后拼接。留空表示禁用；插件不内置任何代理地址。',
          hfEndpoint: '留空则使用 HF_ENDPOINT，最后才回退官方站点。',
          hfMirrorEndpoint: 'source=hf-mirror 时注入为 HF_ENDPOINT。',
          modelscopeEndpoint: 'modelscope.cn 或 www.modelscope.ai；两个站点的 token 不互通。',
          serverHost: '本地推理服务使用的回环地址。',
          backend: '仅 Windows 生效；auto 在检测到 nvidia-smi 时选择 CUDA。',
          idleTimeoutMs: '加载后的模型空闲超过该时间会被停止。',
          idleCheckIntervalMs: '空闲扫描的执行间隔。',
          loadTimeoutMs: '新服务等待健康检查的最长时间。',
          requestTimeoutMs: '单次 model_infer 请求的超时时间。',
          stopGraceMs: '优雅终止信号与强制结束之间的等待时间。',
          modelRoots: '每行一个路径；留空表示 ${DSH_HOME}/models。',
          runtimeDir: '存放 llama-server / mlxcel-server 可执行文件的目录。',
          llamaArgs: '每行一个参数，追加到启动命令。',
          mlxcelArgs: '每行一个参数，追加到启动命令。',
          locale: 'auto 跟随会话语言。'
        },
        option: {
          'defaultSource.hf-mirror': 'hf-mirror',
          'defaultSource.huggingface': 'HuggingFace',
          'defaultSource.modelscope': 'ModelScope',
          'downloadMethod.auto': '自动',
          'downloadMethod.cli': 'CLI',
          'downloadMethod.sdk': 'SDK',
          'backend.auto': '自动',
          'backend.cpu': 'CPU',
          'backend.cuda': 'CUDA',
          'backend.vulkan': 'Vulkan',
          'locale.auto': '自动（跟随会话）',
          'locale.zh': '中文',
          'locale.en': 'English'
        },
        unit: { minutes: '分钟', seconds: '秒' },
        error: {
          number: '请填数字；留空表示使用默认值。',
          range: '请输入 {min} 到 {max} 之间的值。',
          json: '请输入 URL 字符串或合法的 JSON 对象。',
          option: '请从列出的值中选择。'
        },
        placeholder: {
          proxy: 'http://127.0.0.1:7890',
          modelRoots: 'C:\\models',
          runtimeDir: 'C:\\tools\\llama.cpp',
          list: '每行一项',
          text: '留空表示使用默认值'
        },
        save: '保存',
        saving: '保存中…',
        saved: '已保存，插件将按新配置重启。',
        saveFailed: '本部署没有接受这些值，已保留供你修改。',
        discard: '放弃修改',
        reset: '恢复默认',
        overridden: '已覆盖',
        noChanges: '没有需要保存的修改。',
        fixErrors: '请先修正标红的字段再保存。',
        readOnly: '本部署的设置为只读。',
        unavailable: '该插件行未激活，暂时无法读取配置。',
        restartNote: '写入会持久化到本 profile 的 patch 并重启插件行；正在运行的模型会停止，下载与注册表数据保留。'
      }
    };

    // ---------------------------------------------------------------------
    // Config form specification (Settings tab)
    // ---------------------------------------------------------------------

    const FIELDS = [
      { key: 'defaultSource', group: 'search', kind: 'select', options: ['hf-mirror', 'huggingface', 'modelscope'] },
      { key: 'downloadMethod', group: 'search', kind: 'select', options: ['auto', 'cli', 'sdk'] },
      { key: 'scanDepth', group: 'search', kind: 'number', min: 1, max: 12 },
      { key: 'proxy', group: 'network', kind: 'text', placeholder: 'proxy' },
      { key: 'githubProxyPrefix', group: 'network', kind: 'text' },
      { key: 'hfEndpoint', group: 'network', kind: 'text' },
      { key: 'hfMirrorEndpoint', group: 'network', kind: 'text' },
      { key: 'modelscopeEndpoint', group: 'network', kind: 'text' },
      { key: 'serverHost', group: 'runtime', kind: 'text' },
      { key: 'backend', group: 'runtime', kind: 'select', options: ['auto', 'cpu', 'cuda', 'vulkan'] },
      { key: 'idleTimeoutMs', group: 'runtime', kind: 'number', scale: 60000, min: 30000, max: 604800000, unit: 'minutes' },
      { key: 'idleCheckIntervalMs', group: 'runtime', kind: 'number', scale: 1000, min: 1000, max: 3600000, unit: 'seconds' },
      { key: 'loadTimeoutMs', group: 'runtime', kind: 'number', scale: 1000, min: 5000, max: 3600000, unit: 'seconds' },
      { key: 'requestTimeoutMs', group: 'runtime', kind: 'number', scale: 1000, min: 1000, max: 3600000, unit: 'seconds' },
      { key: 'stopGraceMs', group: 'runtime', kind: 'number', scale: 1000, min: 500, max: 120000, unit: 'seconds' },
      { key: 'modelRoots', group: 'models', kind: 'list', placeholder: 'modelRoots' },
      { key: 'runtimeDir', group: 'models', kind: 'text' },
      { key: 'llamaArgs', group: 'advanced', kind: 'list' },
      { key: 'mlxcelArgs', group: 'advanced', kind: 'list' },
      { key: 'locale', group: 'interface', kind: 'select', options: ['auto', 'zh', 'en'] }
    ];

    const GROUP_ORDER = ['search', 'network', 'runtime', 'models', 'advanced', 'interface'];

    /**
     * @param {number} value
     * @param {number} digits
     * @returns {number}
     */
    function round(value, digits) {
      const factor = 10 ** digits;
      return Math.round(value * factor) / factor;
    }

    /**
     * @param {any} field
     * @param {unknown} value
     * @returns {string}
     */
    function valueToText(field, value) {
      if (value === undefined || value === null) return '';
      if (field.kind === 'number') {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return '';
        return String(round(numeric / (field.scale ?? 1), 3));
      }
      if (field.kind === 'list') {
        return Array.isArray(value) ? value.map((entry) => String(entry)).join('\n') : String(value);
      }
      return String(value);
    }

    /**
     * @param {unknown} value
     * @returns {Record<string, string>}
     */
    function toDraft(value) {
      const draft = {};
      const source = value !== null && typeof value === 'object' ? value : {};
      for (const field of FIELDS) draft[field.key] = valueToText(field, source[field.key]);
      return draft;
    }

    /**
     * @param {any} field
     * @param {string} text
     * @param {(key: string, vars?: Record<string, string | number>) => string} t
     * @returns {{ empty?: true, value?: unknown, error?: string }}
     */
    function parseField(field, text, t) {
      const raw = typeof text === 'string' ? text : '';
      const trimmed = raw.trim();
      if (trimmed.length === 0) return { empty: true };
      if (field.kind === 'number') {
        const parsed = Number(trimmed.replace(',', '.'));
        if (!Number.isFinite(parsed)) return { error: t('settings.error.number') };
        const scaled = Math.round(parsed * (field.scale ?? 1));
        const minLabel = field.min === undefined ? '' : String(round(field.min / (field.scale ?? 1), 3));
        const maxLabel = field.max === undefined ? '' : String(round(field.max / (field.scale ?? 1), 3));
        if ((field.min !== undefined && scaled < field.min) || (field.max !== undefined && scaled > field.max)) {
          return { error: t('settings.error.range', { min: minLabel, max: maxLabel }) };
        }
        return { value: scaled };
      }
      if (field.kind === 'list') {
        const items = trimmed.split(/[\n,]+/u).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
        return { value: items };
      }
      if (field.kind === 'select') {
        return field.options.includes(trimmed) ? { value: trimmed } : { error: t('settings.error.option') };
      }
      return { value: trimmed };
    }

    /**
     * @param {unknown} left
     * @param {unknown} right
     * @returns {boolean}
     */
    function sameValue(left, right) {
      return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
    }

    /**
     * @param {any} snapshot
     * @param {Record<string, string>} draft
     * @param {(key: string, vars?: Record<string, string | number>) => string} t
     * @returns {{ ops: Array<Record<string, unknown>>, errors: Record<string, string> }}
     */
    function buildMutation(snapshot, draft, t) {
      const ops = [];
      const errors = {};
      const value = snapshot.value !== null && typeof snapshot.value === 'object' ? snapshot.value : {};
      const base = snapshot.base !== null && typeof snapshot.base === 'object' ? snapshot.base : undefined;
      const user = snapshot.user !== null && typeof snapshot.user === 'object' ? snapshot.user : {};
      for (const field of FIELDS) {
        const parsed = parseField(field, draft[field.key], t);
        if (parsed.error !== undefined) {
          errors[field.key] = parsed.error;
          continue;
        }
        const overridden = Object.hasOwn(user, field.key);
        if (parsed.empty === true) {
          if (overridden) ops.push({ op: 'unset', path: [field.key] });
          continue;
        }
        if (sameValue(parsed.value, value[field.key])) continue;
        const inherited = base === undefined ? undefined : base[field.key];
        if (overridden && inherited !== undefined && sameValue(parsed.value, inherited)) {
          ops.push({ op: 'unset', path: [field.key] });
        } else {
          ops.push({ op: 'set', path: [field.key], value: parsed.value });
        }
      }
      return { ops, errors };
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    /**
     * @param {number | null | undefined} bytes
     * @returns {string}
     */
    function formatBytes(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—';
      const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
      let value = bytes;
      let index = 0;
      while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index += 1;
      }
      return `${value >= 100 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
    }

    /**
     * @param {number | null | undefined} seconds
     * @returns {string}
     */
    function formatEta(seconds) {
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—';
      const total = Math.round(seconds);
      if (total < 60) return `${total}s`;
      const minutes = Math.floor(total / 60);
      return `${minutes}m${String(total % 60).padStart(2, '0')}s`;
    }

    /**
     * @param {string} iso
     * @returns {string}
     */
    function formatDate(iso) {
      if (typeof iso !== 'string' || iso.length === 0) return '—';
      const date = new Date(iso);
      return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 10);
    }

    /**
     * POST JSON to the plugin bridge.
     * @param {string} path
     * @param {unknown} body
     * @returns {Promise<any>}
     */
    async function postJson(path, body) {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {})
      });
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`);
      if (payload?.ok === false) throw new Error(payload.error ?? 'request failed');
      return payload.value;
    }

    /**
     * @param {string} name
     * @param {unknown} args
     * @returns {Promise<any>}
     */
    function runTool(name, args) {
      return postJson('/api/open-model/tool', { name, arguments: args ?? {} });
    }

    // ---------------------------------------------------------------------
    // Shared UI pieces
    // ---------------------------------------------------------------------

    const CSS = `
.om-page { display: flex; flex-direction: column; gap: 18px; max-width: 880px; padding: 4px 0 40px; color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px; }
.om-head { display: flex; flex-direction: column; gap: 4px; }
.om-title { margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; }
.om-desc { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.om-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.om-tab { padding: 8px 12px; border: none; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.om-tab:hover { color: var(--dsw-alias-label-primary); }
.om-tab[aria-selected="true"] { color: var(--dsw-alias-brand-primary); border-bottom-color: var(--dsw-alias-brand-primary); font-weight: 600; }
.om-card { display: flex; flex-direction: column; gap: 12px; padding: 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.om-card-title { margin: 0; font-size: 14px; font-weight: 600; }
.om-card-sub { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.om-row { display: flex; flex-direction: column; gap: 6px; }
.om-label-row { display: flex; align-items: center; gap: 8px; }
.om-label { font-weight: 500; }
.om-badge { font-size: 11px; line-height: 18px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; color: var(--dsw-alias-brand-primary); }
.om-badge-ok { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.om-badge-warn { color: var(--dsw-alias-state-warn-primary); border-color: var(--dsw-alias-state-warn-primary); }
.om-reset { margin-left: auto; padding: 0; border: none; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; text-decoration: underline; cursor: pointer; }
.om-input, .om-select, .om-textarea { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; }
.om-input:focus, .om-select:focus, .om-textarea:focus { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; border-color: var(--dsw-alias-brand-primary); }
.om-textarea { resize: vertical; min-height: 64px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; line-height: 20px; }
.om-hint { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.om-error { margin: 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
.om-ok { margin: 0; color: var(--dsw-alias-state-success-primary); font-size: 12px; line-height: 18px; }
.om-toolbar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; }
.om-toolbar > .om-grow { flex: 1 1 220px; min-width: 180px; }
.om-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.om-button { padding: 7px 14px; border-radius: 8px; font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; }
.om-primary { border: 1px solid var(--dsw-alias-brand-primary); background: transparent; color: var(--dsw-alias-brand-primary); }
.om-secondary { border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-secondary); }
.om-button:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.om-button:disabled { opacity: .5; cursor: default; }
.om-list { display: flex; flex-direction: column; gap: 8px; }
.om-item { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-base); }
.om-item-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.om-item-title { font-weight: 600; overflow-wrap: anywhere; }
.om-item-meta { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.om-item-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-left: auto; }
.om-path { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.om-path code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; padding: 3px 8px; border-radius: 6px; background: var(--dsw-alias-bg-layer-2); overflow-wrap: anywhere; }
.om-progress { height: 6px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
.om-progress > span { display: block; height: 100%; background: var(--dsw-alias-brand-primary); }
.om-steps { margin: 0; padding-left: 20px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 22px; }
.om-footer { position: sticky; bottom: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px 0; background: var(--dsw-alias-bg-base); border-top: 1px solid var(--dsw-alias-border-l1); }
.om-status { font-size: 12px; line-height: 18px; }
.om-status-ok { color: var(--dsw-alias-state-success-primary); }
.om-status-error { color: var(--dsw-alias-state-error-primary); }
.om-status-info { color: var(--dsw-alias-label-secondary); }
.om-grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
.om-kv { display: flex; flex-direction: column; gap: 2px; }
.om-kv-label { color: var(--dsw-alias-label-secondary); font-size: 12px; }
`;

    /**
     * @param {{ className?: string, children?: any }} props
     * @returns {any}
     */
    function Card(props) {
      return h('section', { className: `om-card ${props.className ?? ''}`.trim() }, props.children);
    }

    /**
     * @param {{ children?: any, onClick?: () => void, disabled?: boolean, variant?: 'primary'|'secondary', title?: string, type?: 'button'|'submit' }} props
     * @returns {any}
     */
    function Button(props) {
      return h('button', {
        type: props.type ?? 'button',
        className: `om-button ${props.variant === 'primary' ? 'om-primary' : 'om-secondary'}`,
        onClick: props.onClick,
        disabled: props.disabled,
        title: props.title
      }, props.children);
    }

    /**
     * Copy one path with a short confirmation.
     * @param {{ text: string, t: any, label?: string }} props
     * @returns {any}
     */
    function CopyButton(props) {
      const [copied, setCopied] = React.useState(false);
      React.useEffect(() => {
        if (!copied) return undefined;
        const timer = setTimeout(() => setCopied(false), 1500);
        return () => clearTimeout(timer);
      }, [copied]);
      return h(Button, {
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(props.text);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        },
        title: props.text
      }, copied ? props.t('common.copied') : (props.label ?? props.t('common.copy')));
    }

    // ---------------------------------------------------------------------
    // Overview
    // ---------------------------------------------------------------------

    /**
     * @param {{ status: any, t: any, onGoRuntime: () => void }} props
     * @returns {any}
     */
    function OverviewPanel(props) {
      const { status, t } = props;
      const roots = Array.isArray(status?.roots) ? status.roots : [];
      const models = Array.isArray(status?.models) ? status.models : [];
      const loaded = models.filter((model) => model.loaded === true);
      const runtimes = Array.isArray(status?.runtimes) ? status.runtimes : [];
      const llama = runtimes.find((runtime) => runtime.name === 'llama-server');
      const mlxcel = runtimes.find((runtime) => runtime.name === 'mlxcel-server');
      const active = llama?.available === true ? llama : (mlxcel?.available === true ? mlxcel : (llama ?? mlxcel));
      const sample = roots.length > 0 ? `${roots[0]}\\owner\\model-name` : '';

      return h('div', { className: 'om-page' },
        h('style', null, CSS),
        h(Card, null,
          h('h3', { className: 'om-card-title' }, t('overview.quickTitle')),
          h('ol', { className: 'om-steps' },
            h('li', null, t('overview.step1')),
            h('li', null, t('overview.step2')),
            h('li', null, t('overview.step3')),
            h('li', null, t('overview.step4')))),
        h(Card, null,
          h('h3', { className: 'om-card-title' }, t('overview.rootsTitle')),
          h('p', { className: 'om-card-sub' }, t('overview.rootsHint')),
          roots.length === 0
            ? h('p', { className: 'om-hint' }, t('overview.noRoots'))
            : h('div', { className: 'om-list' }, roots.map((root) => h('div', { className: 'om-path', key: root },
              h('code', null, root),
              h(CopyButton, { text: root, t })))),
          sample.length > 0 ? h('p', { className: 'om-hint' }, t('overview.downloadPattern', { path: sample })) : null),
        h(Card, null,
          h('h3', { className: 'om-card-title' }, t('overview.runtimeTitle')),
          active === undefined
            ? h('p', { className: 'om-hint' }, t('overview.runtimeMissing', { name: 'llama-server' }))
            : h('div', { className: 'om-kv' },
              h('span', { className: 'om-item-title' }, active.name),
              h('span', { className: 'om-item-meta' }, active.available
                ? t('overview.runtimeReady', { name: active.name, version: active.version ?? '—' })
                : t('overview.runtimeMissing', { name: active.name })),
              active.path ? h('span', { className: 'om-item-meta' }, active.path) : null),
          h('div', { className: 'om-actions' },
            h(Button, { onClick: props.onGoRuntime }, t('overview.runtimeAction')))),
        h(Card, null,
          h('h3', { className: 'om-card-title' }, t('overview.modelsTitle')),
          models.length === 0
            ? h('p', { className: 'om-card-sub' }, t('overview.modelCountNone'))
            : h('p', { className: 'om-card-sub' }, t('overview.modelCount', { total: models.length, loaded: loaded.length })),
          models.length === 0 ? null : h('div', { className: 'om-list' }, models.slice(0, 6).map((model) => h('div', { className: 'om-item', key: model.id },
            h('div', { className: 'om-item-head' },
              h('span', { className: 'om-item-title' }, model.id),
              h('span', { className: `om-badge ${model.loaded ? 'om-badge-ok' : ''}` }, model.loaded ? `${t('common.yes')}${model.port ? ` · ${model.port}` : ''}` : t('common.no'))),
            h('span', { className: 'om-item-meta' }, `${model.format} · ${model.quant} · ${formatBytes(model.sizeBytes)}`))))));
    }

    // ---------------------------------------------------------------------
    // Models: search, downloads, local models
    // ---------------------------------------------------------------------

    /**
     * @param {{ status: any, refreshStatus: () => Promise<void>, t: any }} props
     * @returns {any}
     */
    function ModelsPanel(props) {
      const { status, refreshStatus, t } = props;
      const [query, setQuery] = React.useState('');
      const [source, setSource] = React.useState('hf-mirror');
      const [limit, setLimit] = React.useState('8');
      const [include, setInclude] = React.useState('');
      const [results, setResults] = React.useState(null);
      const [searching, setSearching] = React.useState(false);
      const [error, setError] = React.useState('');
      const [notice, setNotice] = React.useState('');
      const [downloading, setDownloading] = React.useState({});
      const [localBusy, setLocalBusy] = React.useState('');
      const [scanning, setScanning] = React.useState(false);
      const [discovered, setDiscovered] = React.useState(null);

      const downloads = Array.isArray(status?.downloads) ? status.downloads : [];
      const models = Array.isArray(status?.models) ? status.models : [];
      const roots = Array.isArray(status?.roots) ? status.roots : [];

      async function search() {
        setSearching(true);
        setError('');
        setNotice('');
        try {
          const value = await runTool('model_search', {
            query: query.trim(),
            source,
            limit: Number.parseInt(limit, 10) || 8
          });
          setResults(Array.isArray(value?.results) ? value.results : []);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught));
        } finally {
          setSearching(false);
        }
      }

      async function download(repoId) {
        setDownloading((previous) => ({ ...previous, [repoId]: true }));
        setError('');
        try {
          await runTool('model_download', {
            repoId,
            source,
            include: include.trim().length > 0 ? include.trim() : undefined,
            background: true
          });
          setNotice(t('models.downloadStarted', { repoId }));
          await refreshStatus();
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught));
        } finally {
          setDownloading((previous) => ({ ...previous, [repoId]: false }));
        }
      }

      async function cancelDownload(id) {
        setError('');
        try {
          await runTool('model_download_status', { downloadId: id, cancel: true });
          setNotice(t('models.cancelled'));
          await refreshStatus();
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      }

      async function scan() {
        setScanning(true);
        setError('');
        setNotice('');
        try {
          const value = await runTool('model_scan', {});
          const found = Array.isArray(value?.discovered) ? value.discovered.filter((entry) => entry.registered !== true) : [];
          setDiscovered(found);
          setNotice(t('models.scanResult', { count: value?.discovered?.length ?? 0, newCount: value?.newCount ?? found.length }));
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught));
        } finally {
          setScanning(false);
        }
      }

      async function register(entry) {
        setLocalBusy(`register:${entry.path}`);
        setError('');
        try {
          const value = await runTool('model_register', { path: entry.path, source: 'local' });
          setNotice(t('models.registered', { id: value?.entry?.id ?? entry.id }));
          setDiscovered((previous) => (previous ?? []).filter((item) => item.path !== entry.path));
          await refreshStatus();
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught));
        } finally {
          setLocalBusy('');
        }
      }

      async function toggleModel(model) {
        setLocalBusy(`${model.loaded ? 'unload' : 'load'}:${model.id}`);
        setError('');
        try {
          await runTool(model.loaded ? 'model_unload' : 'model_load', { modelId: model.id });
          await refreshStatus();
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught));
        } finally {
          setLocalBusy('');
        }
      }

      return h('div', { className: 'om-page' },
        h('style', null, CSS),
        h(Card, null,
          h('h3', { className: 'om-card-title' }, t('models.searchTitle')),
          h('div', { className: 'om-toolbar' },
            h('div', { className: 'om-grow om-row' },
              h('label', { className: 'om-label' }, t('models.query')),
              h('input', {
                className: 'om-input',
                type: 'text',
                value: query,
                placeholder: t('models.queryPlaceholder'),
                onChange: (event) => setQuery(event.target.value),
                onKeyDown: (event) => { if (event.key === 'Enter') void search(); }
              })),
            h('div', { className: 'om-row' },
              h('label', { className: 'om-label' }, t('models.source')),
              h('select', { className: 'om-select', value: source, onChange: (event) => setSource(event.target.value) },
                h('option', { value: 'hf-mirror' }, 'hf-mirror'),
                h('option', { value: 'huggingface' }, 'HuggingFace'),
                h('option', { value: 'modelscope' }, 'ModelScope'))),
            h('div', { className: 'om-row' },
              h('label', { className: 'om-label' }, t('models.limit')),
              h('select', { className: 'om-select', value: limit, onChange: (event) => setLimit(event.target.value) },
                ['4', '8', '12', '20'].map((value) => h('option', { key: value, value }, value)))),
            h(Button, { variant: 'primary', onClick: () => { void search(); }, disabled: searching }, searching ? t('models.searching') : t('models.search'))),
          h('div', { className: 'om-row' },
            h('label', { className: 'om-label' }, t('models.include')),
            h('input', {
              className: 'om-input',
              type: 'text',
              value: include,
              placeholder: t('models.includePlaceholder'),
              onChange: (event) => setInclude(event.target.value)
            }),
            h('p', { className: 'om-hint' }, t('models.includeHint'))),
          error.length > 0 ? h('p', { className: 'om-error' }, error) : null,
          notice.length > 0 ? h('p', { className: 'om-ok' }, notice) : null,
          results === null
            ? null
            : h('div', { className: 'om-list' },
              h('h4', { className: 'om-card-title' }, t('models.results')),
              results.length === 0
                ? h('p', { className: 'om-hint' }, t('models.noResults'))
                : results.map((entry) => h('div', { className: 'om-item', key: entry.repoId },
                  h('div', { className: 'om-item-head' },
                    h('span', { className: 'om-item-title' }, entry.repoId),
                    h('span', { className: 'om-item-actions' },
                      h(Button, {
                        variant: 'primary',
                        disabled: downloading[entry.repoId] === true,
                        onClick: () => { void download(entry.repoId); }
                      }, downloading[entry.repoId] === true ? t('models.downloading') : t('models.download')))),
                  h('span', { className: 'om-item-meta' },
                    `${entry.downloads ?? '—'} ${t('models.downloads')} · ${entry.pipelineTag ?? '—'} · ${t('models.updated')} ${formatDate(entry.updatedAt)} · ${entry.fileCount ?? 0} ${t('models.files')}`))))),
        h(Card, null,
          h('h3', { className: 'om-card-title' }, t('models.downloadsTitle')),
          downloads.length === 0
            ? h('p', { className: 'om-hint' }, t('models.noDownloads'))
            : h('div', { className: 'om-list' }, downloads.map((download) => {
              const total = typeof download.totalBytes === 'number' && download.totalBytes > 0 ? download.totalBytes : null;
              const percent = total === null ? null : Math.min(100, Math.round((download.bytes / total) * 100));
              const activeState = download.state === 'running' || download.state === 'queued';
              return h('div', { className: 'om-item', key: download.id },
                h('div', { className: 'om-item-head' },
                  h('span', { className: 'om-item-title' }, download.repoId),
                  h('span', { className: `om-badge ${download.state === 'completed' ? 'om-badge-ok' : (download.state === 'failed' ? 'om-badge-warn' : '')}` }, t(`models.state.${download.state}`)),
                  activeState
                    ? h('span', { className: 'om-item-actions' }, h(Button, { onClick: () => { void cancelDownload(download.id); } }, t('models.cancelDownload')))
                    : null),
                percent === null ? null : h('div', { className: 'om-progress' }, h('span', { style: { width: `${percent}%` } })),
                h('span', { className: 'om-item-meta' },
                  `${formatBytes(download.bytes)}${total === null ? '' : ` / ${formatBytes(total)}`} · ${download.speedBps ? `${formatBytes(download.speedBps)}/s` : '—'} · ETA ${formatEta(download.etaSeconds)}`),
                download.error ? h('p', { className: 'om-error' }, download.error) : null);
            }))),
        h(Card, null,
          h('h3', { className: 'om-card-title' }, t('models.localTitle')),
          h('p', { className: 'om-card-sub' }, t('models.localHint')),
          roots.length > 0
            ? h('div', { className: 'om-path' }, h('code', null, roots.join('  ·  ')))
            : h('p', { className: 'om-hint' }, t('overview.noRoots')),
          h('div', { className: 'om-actions' },
            h(Button, { onClick: () => { void scan(); }, disabled: scanning }, scanning ? t('models.scanning') : t('models.scan'))),
          models.length === 0
            ? h('p', { className: 'om-hint' }, t('models.noLocal'))
            : h('div', { className: 'om-list' }, models.map((model) => h('div', { className: 'om-item', key: model.id },
              h('div', { className: 'om-item-head' },
                h('span', { className: 'om-item-title' }, model.id),
                h('span', { className: `om-badge ${model.loaded ? 'om-badge-ok' : ''}` }, model.loaded ? `${t('common.yes')}${model.port ? ` · ${model.port}` : ''}` : t('common.no')),
                h('span', { className: 'om-item-actions' },
                  h(Button, {
                    variant: model.loaded ? 'secondary' : 'primary',
                    disabled: localBusy.startsWith(`${model.loaded ? 'unload' : 'load'}:`) && localBusy.endsWith(model.id),
                    onClick: () => { void toggleModel(model); }
                  }, model.loaded
                    ? (localBusy === `unload:${model.id}` ? t('models.unloading') : t('models.unload'))
                    : (localBusy === `load:${model.id}` ? t('models.loading') : t('models.load'))))),
              h('span', { className: 'om-item-meta' }, `${model.format} · ${model.quant} · ${formatBytes(model.sizeBytes)}`),
              h('span', { className: 'om-item-meta' }, model.path)))),
          discovered === null || discovered.length === 0
            ? null
            : h('div', { className: 'om-list' },
              h('h4', { className: 'om-card-title' }, t('models.discovered')),
              discovered.map((entry) => h('div', { className: 'om-item', key: entry.path },
                h('div', { className: 'om-item-head' },
                  h('span', { className: 'om-item-title' }, entry.displayName ?? entry.path),
                  h('span', { className: 'om-item-actions' },
                    h(Button, {
                      variant: 'primary',
                      disabled: localBusy === `register:${entry.path}`,
                      onClick: () => { void register(entry); }
                    }, localBusy === `register:${entry.path}` ? t('models.registering') : t('models.register')))),
                h('span', { className: 'om-item-meta' }, `${entry.format} · ${entry.quant} · ${formatBytes(entry.sizeBytes)}`))))));
    }

    // ---------------------------------------------------------------------
    // Runtime
    // ---------------------------------------------------------------------

    /**
     * @param {{ status: any, refreshStatus: () => Promise<void>, t: any }} props
     * @returns {any}
     */
    function RuntimePanel(props) {
      const { status, refreshStatus, t } = props;
      const [backend, setBackend] = React.useState('auto');
      const [busy, setBusy] = React.useState(false);
      const [message, setMessage] = React.useState(null);
      const runtimes = Array.isArray(status?.runtimes) ? status.runtimes : [];

      async function install() {
        setBusy(true);
        setMessage(null);
        try {
          const value = await runTool('runtime_install', { runtime: 'llama-server', backend });
          if (value?.ok === true) {
            setMessage({ kind: 'ok', text: t('runtime.installed', { version: value.version ?? '—' }) });
          } else {
            setMessage({ kind: 'error', text: value?.reason ? String(value.reason) : t('common.error') });
          }
          await refreshStatus();
        } catch (caught) {
          setMessage({ kind: 'error', text: caught instanceof Error ? caught.message : String(caught) });
        } finally {
          setBusy(false);
        }
      }

      return h('div', { className: 'om-page' },
        h('style', null, CSS),
        h(Card, null,
          h('h3', { className: 'om-card-title' }, t('runtime.title')),
          h('p', { className: 'om-card-sub' }, t('runtime.hint')),
          h('div', { className: 'om-list' }, runtimes.map((runtime) => h('div', { className: 'om-item', key: runtime.name },
            h('div', { className: 'om-item-head' },
              h('span', { className: 'om-item-title' }, runtime.name),
              h('span', { className: `om-badge ${runtime.available ? 'om-badge-ok' : 'om-badge-warn'}` }, runtime.available ? t('runtime.available') : t('runtime.missing'))),
            h('div', { className: 'om-grid-2' },
              h('span', { className: 'om-kv' },
                h('span', { className: 'om-kv-label' }, t('runtime.version')),
                h('span', null, runtime.version ?? '—')),
              h('span', { className: 'om-kv' },
                h('span', { className: 'om-kv-label' }, t('runtime.source')),
                h('span', null, runtime.source ?? '—'))),
            runtime.path ? h('span', { className: 'om-item-meta' }, runtime.path) : null,
            Array.isArray(runtime.missing) && runtime.missing.length > 0
              ? h('p', { className: 'om-error' }, runtime.missing.join(', '))
              : null)))),
        h(Card, null,
          h('h3', { className: 'om-card-title' }, t('runtime.install')),
          h('div', { className: 'om-toolbar' },
            h('div', { className: 'om-row' },
              h('label', { className: 'om-label' }, t('runtime.backend')),
              h('select', { className: 'om-select', value: backend, onChange: (event) => setBackend(event.target.value) },
                h('option', { value: 'auto' }, 'auto'),
                h('option', { value: 'cpu' }, 'CPU'),
                h('option', { value: 'cuda' }, 'CUDA'),
                h('option', { value: 'vulkan' }, 'Vulkan'))),
            h(Button, { variant: 'primary', disabled: busy, onClick: () => { void install(); } },
              busy ? t('runtime.installing') : t('runtime.install'))),
          h('p', { className: 'om-hint' }, t('runtime.installNote')),
          message === null ? null : h('p', { className: message.kind === 'ok' ? 'om-ok' : 'om-error' }, message.text)),
        h(Card, null,
          h('h3', { className: 'om-card-title' }, t('runtime.inspect')),
          h('p', { className: 'om-hint' }, t('runtime.mlxcelNote')),
          h('div', { className: 'om-actions' }, h(Button, { onClick: () => { void refreshStatus(); } }, t('common.refresh')))));
    }

    // ---------------------------------------------------------------------
    // Settings form
    // ---------------------------------------------------------------------

    /**
     * @param {{ controller: any, locale: any, fallbackT: any, t: any }} props
     * @returns {any}
     */
    function SettingsPanel(props) {
      const t = props.t;
      const controller = props.controller;
      const snapshot = React.useSyncExternalStore(
        (listener) => controller.subscribe(listener),
        () => controller.getSnapshot(),
        () => controller.getSnapshot()
      );
      const [draft, setDraft] = React.useState(() => toDraft(snapshot.value));
      const [showErrors, setShowErrors] = React.useState(false);
      const [busy, setBusy] = React.useState(false);
      const [message, setMessage] = React.useState(null);

      const revision = snapshot.revision;
      React.useEffect(() => {
        setDraft(toDraft(snapshot.value));
        setShowErrors(false);
      }, [revision, snapshot.status]);

      const { ops, errors } = buildMutation(snapshot, draft, t);
      const errored = Object.keys(errors).length > 0;
      const dirty = ops.length > 0 || (showErrors && errored);
      const writable = snapshot.writable !== false;

      function update(key, value) {
        setDraft((previous) => ({ ...previous, [key]: value }));
        setMessage(null);
      }

      async function save() {
        const result = buildMutation(snapshot, draft, t);
        if (Object.keys(result.errors).length > 0) {
          setShowErrors(true);
          setMessage({ kind: 'error', text: t('settings.fixErrors') });
          return;
        }
        if (result.ops.length === 0) {
          setMessage({ kind: 'info', text: t('settings.noChanges') });
          return;
        }
        setBusy(true);
        setMessage(null);
        try {
          const ok = await controller.mutate(result.ops);
          setMessage(ok ? { kind: 'ok', text: t('settings.saved') } : { kind: 'error', text: t('settings.saveFailed') });
          if (ok) setShowErrors(false);
        } catch {
          setMessage({ kind: 'error', text: t('settings.saveFailed') });
        } finally {
          setBusy(false);
        }
      }

      async function resetField(key) {
        setBusy(true);
        setMessage(null);
        try {
          const ok = await controller.unset(key);
          setMessage(ok ? { kind: 'ok', text: t('settings.saved') } : { kind: 'error', text: t('settings.saveFailed') });
        } catch {
          setMessage({ kind: 'error', text: t('settings.saveFailed') });
        } finally {
          setBusy(false);
        }
      }

      if (snapshot.status === 'loading') {
        return h('div', { className: 'om-page' }, h('style', null, CSS), h('p', { className: 'om-hint' }, t('common.loading')));
      }
      if (snapshot.status === 'unavailable') {
        return h('div', { className: 'om-page' }, h('style', null, CSS), h('p', { className: 'om-hint' }, t('settings.unavailable')));
      }

      const user = snapshot.user !== null && typeof snapshot.user === 'object' ? snapshot.user : {};
      const groups = [];
      for (const group of GROUP_ORDER) {
        const fields = FIELDS.filter((field) => field.group === group);
        if (fields.length === 0) continue;
        groups.push(h('section', { className: 'om-card', key: group },
          h('h3', { className: 'om-card-title' }, t(`settings.group.${group}`)),
          fields.map((field) => {
            const id = `om-field-${field.key}`;
            const overridden = Object.hasOwn(user, field.key);
            const error = showErrors ? errors[field.key] : undefined;
            const unit = field.unit === undefined ? '' : t(`settings.unit.${field.unit}`);
            const placeholderKey = field.placeholder ?? (field.kind === 'list' ? 'list' : 'text');
            return h('div', { className: 'om-row', key: field.key },
              h('div', { className: 'om-label-row' },
                h('label', { className: 'om-label', htmlFor: id }, t(`settings.field.${field.key}`)),
                unit.length > 0 ? h('span', { className: 'om-hint' }, `(${unit})`) : null,
                overridden ? h('span', { className: 'om-badge' }, t('settings.overridden')) : null,
                overridden
                  ? h('button', {
                    type: 'button',
                    className: 'om-reset',
                    disabled: busy || !writable,
                    onClick: () => { void resetField(field.key); }
                  }, t('settings.reset'))
                  : null),
              renderSettingsControl(field, {
                id,
                value: draft[field.key],
                disabled: busy || !writable,
                invalid: error !== undefined,
                placeholder: t(`settings.placeholder.${placeholderKey}`),
                optionLabel: (value) => {
                  const key = `settings.option.${field.key}.${value}`;
                  const label = t(key);
                  return label === key ? value : label;
                },
                onChange: (value) => update(field.key, value)
              }),
              h('p', { className: 'om-hint' }, t(`settings.hint.${field.key}`)),
              error === undefined ? null : h('p', { className: 'om-error' }, error));
          })));
      }

      return h('div', { className: 'om-page' },
        h('style', null, CSS),
        h('p', { className: 'om-desc' }, t('settings.description')),
        writable ? null : h('p', { className: 'om-error' }, t('settings.readOnly')),
        groups,
        h('footer', { className: 'om-footer' },
          h(Button, { variant: 'primary', disabled: busy || !writable || !dirty, onClick: () => { void save(); } }, busy ? t('settings.saving') : t('settings.save')),
          h(Button, {
            disabled: busy,
            onClick: () => {
              setDraft(toDraft(snapshot.value));
              setShowErrors(false);
              setMessage(null);
            }
          }, t('settings.discard')),
          message === null ? null : h('span', { className: `om-status om-status-${message.kind}`, role: 'status' }, message.text)),
        h('p', { className: 'om-hint' }, t('settings.restartNote')));
    }

    /**
     * @param {any} field
     * @param {{ id: string, value: string, disabled: boolean, invalid: boolean, placeholder?: string, optionLabel: (value: string) => string, onChange: (value: string) => void }} props
     * @returns {any}
     */
    function renderSettingsControl(field, props) {
      const common = {
        id: props.id,
        disabled: props.disabled,
        'aria-invalid': props.invalid ? 'true' : undefined,
        value: props.value,
        onChange: (event) => props.onChange(event.target.value)
      };
      if (field.kind === 'select') {
        return h('select', { ...common, className: 'om-select' },
          field.options.map((option) => h('option', { key: option, value: option }, props.optionLabel(option))));
      }
      if (field.kind === 'list') {
        return h('textarea', { ...common, className: 'om-textarea', rows: 4, spellCheck: false, placeholder: props.placeholder });
      }
      if (field.kind === 'number') {
        return h('input', {
          ...common,
          className: 'om-input',
          type: 'number',
          inputMode: 'decimal',
          step: field.scale === 60000 ? 0.5 : 1,
          placeholder: props.placeholder
        });
      }
      return h('input', {
        ...common,
        className: 'om-input',
        type: 'text',
        spellCheck: false,
        autoComplete: 'off',
        placeholder: props.placeholder
      });
    }

    // ---------------------------------------------------------------------
    // Page
    // ---------------------------------------------------------------------

    const TABS = [
      { id: 'overview', key: 'overview' },
      { id: 'models', key: 'models' },
      { id: 'runtime', key: 'runtime' },
      { id: 'settings', key: 'settings' }
    ];

    /**
     * @param {{ controller: any, locale: any, fallbackT: any, t: any }} props
     * @returns {any}
     */
    function OpenModelPage(props) {
      const t = props.t;
      const [tab, setTab] = React.useState('overview');
      const [status, setStatus] = React.useState(null);
      const [statusError, setStatusError] = React.useState('');

      const refreshStatus = React.useCallback(async () => {
        try {
          const value = await postJson('/api/open-model/status', {});
          setStatus(value);
          setStatusError('');
        } catch (caught) {
          setStatusError(caught instanceof Error ? caught.message : String(caught));
        }
      }, []);

      React.useEffect(() => {
        void refreshStatus();
      }, [refreshStatus]);

      const activeDownloads = Array.isArray(status?.downloads)
        ? status.downloads.some((download) => download.state === 'running' || download.state === 'queued')
        : false;
      React.useEffect(() => {
        if (!activeDownloads) return undefined;
        const timer = setInterval(() => { void refreshStatus(); }, 1500);
        return () => clearInterval(timer);
      }, [activeDownloads, refreshStatus]);

      return h('div', { className: 'om-page' },
        h('style', null, CSS),
        h('header', { className: 'om-head' },
          h('h2', { className: 'om-title' }, t('title')),
          h('p', { className: 'om-desc' }, t('subtitle'))),
        h('div', { className: 'om-tabs', role: 'tablist' },
          TABS.map((entry) => h('button', {
            key: entry.id,
            type: 'button',
            role: 'tab',
            className: 'om-tab',
            'aria-selected': tab === entry.id ? 'true' : 'false',
            onClick: () => setTab(entry.id)
          }, t(`tabs.${entry.key}`)))),
        statusError.length > 0 && tab !== 'settings'
          ? h('div', { className: 'om-actions' },
            h('p', { className: 'om-error' }, `${t('common.error')}: ${statusError}`),
            h(Button, { onClick: () => { void refreshStatus(); } }, t('common.retry')))
          : null,
        tab === 'overview'
          ? (status === null
            ? h('p', { className: 'om-hint' }, t('common.loading'))
            : h(OverviewPanel, { status, t, onGoRuntime: () => setTab('runtime') }))
          : null,
        tab === 'models'
          ? (status === null
            ? h('p', { className: 'om-hint' }, t('common.loading'))
            : h(ModelsPanel, { status, refreshStatus, t }))
          : null,
        tab === 'runtime'
          ? (status === null
            ? h('p', { className: 'om-hint' }, t('common.loading'))
            : h(RuntimePanel, { status, refreshStatus, t }))
          : null,
        tab === 'settings' ? h(SettingsPanel, props) : null);
    }

    // ---------------------------------------------------------------------
    // Plugin
    // ---------------------------------------------------------------------

    /**
     * @param {any} ctx
     */
    function apply(ctx) {
      const bound = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-open-model: settings dictionaries');

      const controller = ctx.configForms.get(CONFIG_NS);
      const Page = (props) => h(OpenModelPage, {
        ...props,
        controller,
        locale: ctx.locale,
        fallbackT: bound
      });

      ctx.effect(() => ctx.configForms.whileServed([CONFIG_NS], () => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: SECTION_ID,
        order: 300,
        label: () => bound('nav'),
        locale: NS
      }, Page))), 'dsh-open-model: settings section');
    }

    return {
      inject: ['slots', 'locale', 'configForms'],
      apply
    };
  }
});
