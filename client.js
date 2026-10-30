/**
 * dsh-open-model — client half: the Settings page for this bundle.
 *
 * The page edits the Host plugin's volatile Config fields through the shared
 * settings transport (`ctx.configForms.get('dsh-open-model')`): reads ride the
 * one describe mirror and writes are revisioned namespace mutations, so a
 * concurrent writer cannot be silently overwritten. It registers into
 * `settings.section` only while the Host serves the namespace.
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
      description: 'Search, download, register and run local models. Saving restarts this plugin and stops every model server it started.',
      loading: 'Loading configuration…',
      unavailable: 'This plugin row is not active, so its configuration is unavailable.',
      readOnly: 'This deployment stores settings read-only.',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved. The plugin restarts with the new configuration.',
      saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
      discard: 'Discard changes',
      reset: 'Reset to default',
      overridden: 'Overridden',
      noChanges: 'No changes to save.',
      fixErrors: 'Fix the highlighted fields before saving.',
      restartNote: 'Writes persist to this profile’s patch and restart the plugin row. Running models are stopped; download and registry data are kept.',
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
      }
    };

    const zh = {
      nav: '开源模型中枢',
      title: '开源模型中枢',
      description: '搜索、下载、注册并运行本地模型。保存后会重启本插件，并停止它启动的所有模型服务。',
      loading: '正在加载配置…',
      unavailable: '该插件行未激活，暂时无法读取配置。',
      readOnly: '本部署的设置为只读。',
      save: '保存',
      saving: '保存中…',
      saved: '已保存，插件将按新配置重启。',
      saveFailed: '本部署没有接受这些值，已保留供你修改。',
      discard: '放弃修改',
      reset: '恢复默认',
      overridden: '已覆盖',
      noChanges: '没有需要保存的修改。',
      fixErrors: '请先修正标红的字段再保存。',
      restartNote: '写入会持久化到本 profile 的 patch 并重启插件行；正在运行的模型会停止，下载与注册表数据保留。',
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
      }
    };

    // ---------------------------------------------------------------------
    // Field specification
    // ---------------------------------------------------------------------

    const FIELDS = [
      { key: 'defaultSource', group: 'search', kind: 'select', options: ['hf-mirror', 'huggingface', 'modelscope'] },
      { key: 'downloadMethod', group: 'search', kind: 'select', options: ['auto', 'cli', 'sdk'] },
      { key: 'scanDepth', group: 'search', kind: 'number', min: 1, max: 12 },
      { key: 'proxy', group: 'network', kind: 'proxy' },
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

    // ---------------------------------------------------------------------
    // Value <-> draft helpers
    // ---------------------------------------------------------------------

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
     * Render one stored value into its input text.
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
      if (field.kind === 'proxy') {
        return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
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
     * Parse one draft field. Empty means "use the inherited/default value".
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
        if (!Number.isFinite(parsed)) return { error: t('error.number') };
        const scaled = Math.round(parsed * (field.scale ?? 1));
        const minLabel = field.min === undefined ? '' : String(round(field.min / (field.scale ?? 1), 3));
        const maxLabel = field.max === undefined ? '' : String(round(field.max / (field.scale ?? 1), 3));
        if ((field.min !== undefined && scaled < field.min) || (field.max !== undefined && scaled > field.max)) {
          return { error: t('error.range', { min: minLabel, max: maxLabel }) };
        }
        return { value: scaled };
      }
      if (field.kind === 'list') {
        const items = trimmed.split(/[\n,]+/u).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
        return { value: items };
      }
      if (field.kind === 'select') {
        return field.options.includes(trimmed) ? { value: trimmed } : { error: t('error.option') };
      }
      if (field.kind === 'proxy') {
        if (trimmed.startsWith('{')) {
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: t('error.json') };
            return { value: parsed };
          } catch {
            return { error: t('error.json') };
          }
        }
        return { value: trimmed };
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
     * Build the ordered mutation for the current draft.
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
    // Presentation
    // ---------------------------------------------------------------------

    const CSS = `
.om-page { display: flex; flex-direction: column; gap: 20px; max-width: 760px; padding: 4px 0 40px; color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px; }
.om-head { display: flex; flex-direction: column; gap: 6px; }
.om-title { margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; }
.om-desc { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.om-notice { margin: 0; color: var(--dsw-alias-state-warn-primary); font-size: 12px; line-height: 18px; }
.om-group { display: flex; flex-direction: column; gap: 14px; padding-top: 16px; border-top: 1px solid var(--dsw-alias-border-l1); }
.om-group-title { margin: 0; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-secondary); text-transform: uppercase; letter-spacing: .04em; }
.om-row { display: flex; flex-direction: column; gap: 6px; }
.om-label-row { display: flex; align-items: center; gap: 8px; }
.om-label { font-weight: 500; }
.om-badge { font-size: 11px; line-height: 18px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; color: var(--dsw-alias-brand-primary); }
.om-reset { margin-left: auto; padding: 0; border: none; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; text-decoration: underline; cursor: pointer; }
.om-reset:disabled { opacity: .5; cursor: default; }
.om-input, .om-select, .om-textarea { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; }
.om-input:focus, .om-select:focus, .om-textarea:focus { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; border-color: var(--dsw-alias-brand-primary); }
.om-input[aria-invalid="true"], .om-select[aria-invalid="true"], .om-textarea[aria-invalid="true"] { border-color: var(--dsw-alias-state-error-primary); }
.om-textarea { resize: vertical; min-height: 64px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; line-height: 20px; }
.om-hint { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.om-error { margin: 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
.om-footer { position: sticky; bottom: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px 0; background: var(--dsw-alias-bg-base); border-top: 1px solid var(--dsw-alias-border-l1); }
.om-primary, .om-secondary { padding: 8px 16px; border-radius: 8px; font: inherit; font-weight: 500; cursor: pointer; }
.om-primary { border: 1px solid var(--dsw-alias-brand-primary); background: transparent; color: var(--dsw-alias-brand-primary); }
.om-secondary { border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-secondary); }
.om-primary:hover:not(:disabled), .om-secondary:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.om-primary:disabled, .om-secondary:disabled { opacity: .5; cursor: default; }
.om-status { font-size: 12px; line-height: 18px; }
.om-status-ok { color: var(--dsw-alias-state-success-primary); }
.om-status-error { color: var(--dsw-alias-state-error-primary); }
.om-status-info { color: var(--dsw-alias-label-secondary); }
.om-state { margin: 0; color: var(--dsw-alias-label-secondary); }
`;

    /**
     * @param {any} field
     * @param {{ id: string, value: string, disabled: boolean, invalid: boolean, placeholder?: string, onChange: (value: string) => void }} props
     * @returns {any}
     */
    function renderControl(field, props) {
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
      if (field.kind === 'list' || field.kind === 'proxy') {
        return h('textarea', {
          ...common,
          className: 'om-textarea',
          rows: field.kind === 'proxy' ? 3 : 4,
          spellCheck: false,
          placeholder: props.placeholder
        });
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

    /**
     * The Settings section page.
     * @param {any} props
     * @returns {any}
     */
    function OpenModelSettingsPage(props) {
      const { controller, locale, fallbackT } = props;
      const t = typeof props.t === 'function' ? props.t : fallbackT;
      const snapshot = React.useSyncExternalStore(
        (listener) => controller.subscribe(listener),
        () => controller.getSnapshot(),
        () => controller.getSnapshot()
      );
      const [, bumpLocale] = React.useReducer((value) => value + 1, 0);
      React.useEffect(() => {
        if (locale === undefined || typeof locale.subscribe !== 'function') return undefined;
        return locale.subscribe(() => bumpLocale());
      }, [locale]);

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

      /**
       * @param {string} key
       * @param {string} value
       */
      function update(key, value) {
        setDraft((previous) => ({ ...previous, [key]: value }));
        setMessage(null);
      }

      async function save() {
        const result = buildMutation(snapshot, draft, t);
        if (Object.keys(result.errors).length > 0) {
          setShowErrors(true);
          setMessage({ kind: 'error', text: t('fixErrors') });
          return;
        }
        if (result.ops.length === 0) {
          setMessage({ kind: 'info', text: t('noChanges') });
          return;
        }
        setBusy(true);
        setMessage(null);
        try {
          const ok = await controller.mutate(result.ops);
          setMessage(ok ? { kind: 'ok', text: t('saved') } : { kind: 'error', text: t('saveFailed') });
          if (ok) setShowErrors(false);
        } catch {
          setMessage({ kind: 'error', text: t('saveFailed') });
        } finally {
          setBusy(false);
        }
      }

      async function resetField(key) {
        setBusy(true);
        setMessage(null);
        try {
          const ok = await controller.unset(key);
          setMessage(ok ? { kind: 'ok', text: t('saved') } : { kind: 'error', text: t('saveFailed') });
        } catch {
          setMessage({ kind: 'error', text: t('saveFailed') });
        } finally {
          setBusy(false);
        }
      }

      if (snapshot.status === 'loading') {
        return h('div', { className: 'om-page' },
          h('style', null, CSS),
          h('p', { className: 'om-state' }, t('loading')));
      }
      if (snapshot.status === 'unavailable') {
        return h('div', { className: 'om-page' },
          h('style', null, CSS),
          h('h2', { className: 'om-title' }, t('title')),
          h('p', { className: 'om-state' }, t('unavailable')));
      }

      const user = snapshot.user !== null && typeof snapshot.user === 'object' ? snapshot.user : {};
      const groups = [];
      for (const group of GROUP_ORDER) {
        const fields = FIELDS.filter((field) => field.group === group);
        if (fields.length === 0) continue;
        groups.push(h('section', { className: 'om-group', key: group },
          h('h3', { className: 'om-group-title' }, t(`group.${group}`)),
          fields.map((field) => {
            const id = `om-field-${field.key}`;
            const overridden = Object.hasOwn(user, field.key);
            const error = showErrors ? errors[field.key] : undefined;
            const unit = field.unit === undefined ? '' : t(`unit.${field.unit}`);
            return h('div', { className: 'om-row', key: field.key },
              h('div', { className: 'om-label-row' },
                h('label', { className: 'om-label', htmlFor: id }, t(`field.${field.key}`)),
                unit.length > 0 ? h('span', { className: 'om-hint' }, `(${unit})`) : null,
                overridden
                  ? h('span', { className: 'om-badge' }, t('overridden'))
                  : null,
                overridden
                  ? h('button', {
                    type: 'button',
                    className: 'om-reset',
                    disabled: busy || !writable,
                    onClick: () => { void resetField(field.key); }
                  }, t('reset'))
                  : null),
              renderControl(field, {
                id,
                value: draft[field.key],
                disabled: busy || !writable,
                invalid: error !== undefined,
                placeholder: field.placeholder === undefined
                  ? (field.kind === 'list' ? t('placeholder.list') : t('placeholder.text'))
                  : t(`placeholder.${field.placeholder}`),
                optionLabel: (value) => {
                  const key = `option.${field.key}.${value}`;
                  const label = t(key);
                  return label === key ? value : label;
                },
                onChange: (value) => update(field.key, value)
              }),
              h('p', { className: 'om-hint' }, t(`hint.${field.key}`)),
              error === undefined ? null : h('p', { className: 'om-error' }, error));
          })));
      }

      return h('div', { className: 'om-page' },
        h('style', null, CSS),
        h('header', { className: 'om-head' },
          h('h2', { className: 'om-title' }, t('title')),
          h('p', { className: 'om-desc' }, t('description')),
          writable ? null : h('p', { className: 'om-notice' }, t('readOnly'))),
        groups,
        h('footer', { className: 'om-footer' },
          h('button', {
            type: 'button',
            className: 'om-primary',
            disabled: busy || !writable || !dirty,
            onClick: () => { void save(); }
          }, busy ? t('saving') : t('save')),
          h('button', {
            type: 'button',
            className: 'om-secondary',
            disabled: busy,
            onClick: () => {
              setDraft(toDraft(snapshot.value));
              setShowErrors(false);
              setMessage(null);
            }
          }, t('discard')),
          message === null
            ? null
            : h('span', {
              className: `om-status om-status-${message.kind}`,
              role: 'status'
            }, message.text)),
        h('p', { className: 'om-hint' }, t('restartNote')));
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
      const Page = (props) => h(OpenModelSettingsPage, {
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
