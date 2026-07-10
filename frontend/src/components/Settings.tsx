import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../stores/appStore';
import { configApi, systemApi } from '../api/client';
import type { SystemInfo, ModelInfo } from '../types';

type LLMForm = {
  provider: string;
  model: string;
  api_key: string;
  base_url: string;
};

const ALL_PROVIDERS = [
  { id: 'openai', name: 'OpenAI', models: ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'] },
  { id: 'deepseek', name: 'DeepSeek', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'zhipu', name: '智谱 GLM', models: ['glm-4', 'glm-4-flash', 'glm-3-turbo'] },
  { id: 'qwen', name: '通义千问', models: ['qwen-max', 'qwen-plus', 'qwen-turbo'] },
  { id: 'ollama', name: 'Ollama (本地)', models: ['llama3', 'qwen2.5', 'deepseek-r1'] },
  { id: 'custom', name: '自定义', models: [] },
];

export default function Settings() {
  // 全局配置
  const currentModel = useAppStore((s) => s.currentModel);
  const currentProvider = useAppStore((s) => s.currentProvider);
  const planningEnabled = useAppStore((s) => s.planningEnabled);
  const ragEnabled = useAppStore((s) => s.ragEnabled);
  const reflectionEnabled = useAppStore((s) => s.reflectionEnabled);
  const models = useAppStore((s) => s.models);
  const toolsCount = useAppStore((s) => s.toolsCount);
  const systemInfo = useAppStore((s) => s.systemInfo);
  const userSettings = useAppStore((s) => s.userSettings);
  const setCurrentModel = useAppStore((s) => s.setCurrentModel);
  const setModels = useAppStore((s) => s.setModels);
  const setModeState = useAppStore((s) => s.setModeState);
  const setSystemInfo = useAppStore((s) => s.setSystemInfo);
  const setToolsCount = useAppStore((s) => s.setToolsCount);
  const setUserSettings = useAppStore((s) => s.setUserSettings);

  // LLM 配置表单
  const [llmForm, setLlmForm] = useState<LLMForm>({
    provider: currentProvider,
    model: currentModel,
    api_key: '',
    base_url: '',
  });
  const [savingLLM, setSavingLLM] = useState(false);

  // 模型切换
  const [switchModel, setSwitchModel] = useState(currentModel);
  const [switchProvider, setSwitchProvider] = useState(currentProvider);
  const [switching, setSwitching] = useState(false);

  // 状态消息
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 工具列表
  const [tools, setTools] = useState<{ name: string; description: string; parameters: string[]; dangerous: boolean }[]>([]);

  // 活跃 Tab
  const [activeSection, setActiveSection] = useState<'llm' | 'model' | 'modes' | 'tools' | 'system' | 'appearance' | 'ide'>('llm');

  // IDE 设置
  const [ideSettings, setIdeSettings] = useState({
    theme: 'vs-dark',
    fontSize: 14,
    tabSize: 4,
    autoComplete: true,
    wordWrap: true,
    minimap: false,
    lineNumbers: true,
  });

  const showMsg = (type: 'success' | 'error', text: string) => {
    setStatusMsg({ type, text });
    setTimeout(() => setStatusMsg(null), 4000);
  };

  // 初始化
  useEffect(() => {
    setLlmForm((p) => ({ ...p, provider: currentProvider, model: currentModel }));
    setSwitchProvider(currentProvider);
    setSwitchModel(currentModel);
  }, [currentProvider, currentModel]);

  // 加载工具列表和系统信息
  useEffect(() => {
    (async () => {
      try {
        const [tRes, sRes] = await Promise.all([
          systemApi.tools(),
          systemApi.info(),
        ]);
        if (tRes.ok) {
          setTools(tRes.tools || []);
          setToolsCount(tRes.count || 0);
        }
        if (sRes.ok) setSystemInfo(sRes.system);
      } catch { /* */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── LLM 配置保存 ──
  const handleSaveLLM = async () => {
    if (!llmForm.provider) { showMsg('error', '请选择提供商'); return; }
    if (llmForm.provider === 'custom' && !llmForm.base_url.trim()) {
      showMsg('error', '自定义提供商必须填写 API 地址'); return;
    }

    setSavingLLM(true);
    try {
      await configApi.updateLLM(
        llmForm.provider,
        llmForm.model,
        llmForm.api_key,
        llmForm.base_url,
      );
      showMsg('success', 'LLM 配置已保存并生效');
      // 刷新
      const cfg = await configApi.get();
      setCurrentModel(cfg.model, cfg.provider);
      setModels(cfg.models || []);
    } catch (e) {
      showMsg('error', `保存失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setSavingLLM(false);
    }
  };

  // ── 模型切换 ──
  const handleSwitchModel = async () => {
    if (!switchModel) { showMsg('error', '请选择模型'); return; }
    setSwitching(true);
    try {
      await configApi.switchModel(switchModel, switchProvider || undefined);
      setCurrentModel(switchModel, switchProvider);
      showMsg('success', `已切换至 ${switchModel}`);
    } catch (e) {
      showMsg('error', `切换失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setSwitching(false);
    }
  };

  // ── 模式开关 ──
  const handleToggleMode = async (mode: string) => {
    try {
      const res = await configApi.toggleMode(mode);
      if (res.ok) {
        setModeState(mode, res.enabled);
        showMsg('success', `${modeLabel(mode)} ${res.enabled ? '已开启' : '已关闭'}`);
      }
    } catch (e) {
      showMsg('error', `切换失败: ${e instanceof Error ? e.message : '未知错误'}`);
    }
  };

  // 提供商改变时自动更新可选模型
  const handleProviderChange = (pid: string) => {
    setLlmForm((p) => ({ ...p, provider: pid }));
    setSwitchProvider(pid);
    const provider = ALL_PROVIDERS.find((x) => x.id === pid);
    if (provider && provider.models.length > 0) {
      const first = provider.models[0];
      setLlmForm((p) => ({ ...p, model: first }));
      setSwitchModel(first);
    }
  };

  const currentProviderModels = ALL_PROVIDERS.find((x) => x.id === switchProvider)?.models || [];

  const sections: { id: typeof activeSection; label: string; icon: string }[] = [
    { id: 'llm', label: 'LLM 配置', icon: '⚙️' },
    { id: 'model', label: '模型切换', icon: '🔄' },
    { id: 'modes', label: '功能模式', icon: '🎛️' },
    { id: 'tools', label: '工具管理', icon: '🔧' },
    { id: 'ide', label: 'IDE 设置', icon: '💻' },
    { id: 'system', label: '系统信息', icon: '🖥️' },
    { id: 'appearance', label: '外观设置', icon: '🎨' },
  ];

  return (
    <div className="settings-container">
      <div className="settings-header">
        <h2>⚙️ 系统设置</h2>
      </div>

      {statusMsg && (
        <div className={`settings-toast ${statusMsg.type}`}>
          {statusMsg.type === 'success' ? '✅' : '❌'} {statusMsg.text}
        </div>
      )}

      {/* 分区导航 */}
      <div className="settings-tabs">
        {sections.map((s) => (
          <button
            key={s.id}
            className={`settings-tab ${activeSection === s.id ? 'active' : ''}`}
            onClick={() => setActiveSection(s.id)}
          >
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      {/* ── LLM 配置 ── */}
      {activeSection === 'llm' && (
        <div className="card">
          <div className="card-header">LLM 提供商配置</div>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 18 }}>
            配置 API 提供商、密钥和模型，修改后会同步写入 config.yaml 并即时生效。API Key 支持 $VAR 格式引用环境变量。
          </p>

          <div className="form-group">
            <label>提供商</label>
            <select className="form-select" value={llmForm.provider} onChange={(e) => handleProviderChange(e.target.value)}>
              {ALL_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>模型 ID</label>
            <input
              className="form-input"
              value={llmForm.model}
              onChange={(e) => setLlmForm({ ...llmForm, model: e.target.value })}
              placeholder="如：deepseek-chat、gpt-4o"
            />
          </div>

          <div className="form-group">
            <label>API Key</label>
            <input
              className="form-input"
              type="password"
              value={llmForm.api_key}
              onChange={(e) => setLlmForm({ ...llmForm, api_key: e.target.value })}
              placeholder={'留空使用环境变量，如 $DEEPSEEK_API_KEY'}
            />
            <div className="form-help">建议使用环境变量，格式为 $PROVIDER_API_KEY</div>
          </div>

          <div className="form-group">
            <label>自定义 API 地址（可选）</label>
            <input
              className="form-input"
              value={llmForm.base_url}
              onChange={(e) => setLlmForm({ ...llmForm, base_url: e.target.value })}
              placeholder="https://api.deepseek.com/v1"
            />
            <div className="form-help">{llmForm.provider === 'custom' ? '自定义提供商必填' : '留空使用默认地址'}</div>
          </div>

          <button className="btn btn-primary" onClick={handleSaveLLM} disabled={savingLLM}>
            {savingLLM ? <><span className="spinner" /> 保存中...</> : '💾 保存配置'}
          </button>
        </div>
      )}

      {/* ── 模型切换 ── */}
      {activeSection === 'model' && (
        <div className="card">
          <div className="card-header">模型切换</div>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 18 }}>
            当前: <strong style={{ color: 'var(--primary)' }}>{currentModel}</strong> ({providerLabel(currentProvider)})
          </p>

          <div className="form-group">
            <label>提供商</label>
            <select className="form-select" value={switchProvider} onChange={(e) => handleProviderChange(e.target.value)}>
              {ALL_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>模型</label>
            {currentProviderModels.length > 0 ? (
              <div className="model-grid">
                {currentProviderModels.map((m) => (
                  <button
                    key={m}
                    className={`model-chip ${switchModel === m ? 'selected' : ''}`}
                    onClick={() => setSwitchModel(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            ) : (
              <input
                className="form-input"
                value={switchModel}
                onChange={(e) => setSwitchModel(e.target.value)}
                placeholder="手动输入模型 ID"
              />
            )}
          </div>

          {/* 最近使用模型 */}
          {models.length > 0 && (
            <div className="form-group">
              <label>全部可用模型</label>
              <div className="model-grid">
                {models.map((m) => (
                  <button
                    key={m.id}
                    className={`model-chip ${switchModel === m.id ? 'selected' : ''}`}
                    onClick={() => { setSwitchModel(m.id); setSwitchProvider(m.provider); }}
                    title={`${m.name} (${m.provider})`}
                  >
                    <span className="chip-provider">{m.provider}</span>
                    <span>{m.name || m.id}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <button className="btn btn-primary" onClick={handleSwitchModel} disabled={switching}>
            {switching ? <><span className="spinner" /> 切换中...</> : '🔄 切换模型'}
          </button>
        </div>
      )}

      {/* ── 功能模式 ── */}
      {activeSection === 'modes' && (
        <div className="card">
          <div className="card-header">功能模式</div>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20 }}>
            切换 Agent 的执行模式，影响所有 Agent 的默认行为
          </p>

          <div className="mode-list">
            <ModeCard
              icon="📋"
              title="Plan 计划模式"
              desc="执行前使用 LLM 生成多步骤计划，适合复杂任务的逐步执行"
              enabled={planningEnabled}
              onToggle={() => handleToggleMode('planning')}
            />
            <ModeCard
              icon="📚"
              title="RAG 知识库检索"
              desc="回答前自动检索上传的文档知识库，将相关内容注入上下文"
              enabled={ragEnabled}
              onToggle={() => handleToggleMode('rag')}
            />
            <ModeCard
              icon="🔄"
              title="Reflection 反思模式"
              desc="回答后自动进行自我审查和改进，提升回答质量（会增加 token 消耗）"
              enabled={reflectionEnabled}
              onToggle={() => handleToggleMode('reflection')}
            />
          </div>
        </div>
      )}

      {/* ── 工具管理 ── */}
      {activeSection === 'tools' && (
        <div className="card">
          <div className="card-header">工具管理 ({tools.length})</div>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 18 }}>
            已注册的工具列表，包含内置工具和通过 Tool Registry 注册的自定义工具
          </p>

          {tools.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
              加载中...
            </div>
          ) : (
            <div className="tools-grid">
              {tools.map((tool) => (
                <div key={tool.name} className="tool-card">
                  <div className="tool-header">
                    <span className="tool-name">{tool.name}</span>
                    {tool.dangerous && <span className="tool-danger">⚠️ 危险</span>}
                  </div>
                  <div className="tool-desc">{tool.description}</div>
                  {tool.parameters.length > 0 && (
                    <div className="tool-params">
                      {tool.parameters.map((p) => (
                        <span key={p} className="tool-param">{p}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── IDE 设置 ── */}
      {activeSection === 'ide' && (
        <div className="card">
          <div className="card-header">内置 IDE 设置</div>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20 }}>
            配置内置代码编辑器的外观和行为，支持扩展插件接入
          </p>

          <div className="form-group">
            <label>编辑器主题</label>
            <div style={{ display: 'flex', gap: 12 }}>
              {([
                { id: 'vs-dark', name: '暗色', icon: '🌙' },
                { id: 'vs-light', name: '亮色', icon: '☀️' },
                { id: 'monokai', name: 'Monokai', icon: '🎨' },
                { id: 'github-dark', name: 'GitHub Dark', icon: '🐙' },
              ]).map((t) => (
                <button
                  key={t.id}
                  className={`theme-chip ${ideSettings.theme === t.id ? 'selected' : ''}`}
                  onClick={() => setIdeSettings({ ...ideSettings, theme: t.id })}
                >
                  <span className="theme-icon">{t.icon}</span>
                  <span>{t.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="form-group" style={{ marginTop: 20 }}>
            <label>字体大小: {ideSettings.fontSize}px</label>
            <input
              type="range"
              min={10}
              max={24}
              value={ideSettings.fontSize}
              onChange={(e) => setIdeSettings({ ...ideSettings, fontSize: Number(e.target.value) })}
              style={{ width: '100%', marginTop: 8 }}
            />
            <div className="form-help">调整编辑器代码字体大小</div>
          </div>

          <div className="form-group" style={{ marginTop: 20 }}>
            <label>Tab 大小: {ideSettings.tabSize}</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              {[2, 4, 8].map((s) => (
                <button
                  key={s}
                  className={`theme-chip ${ideSettings.tabSize === s ? 'selected' : ''}`}
                  onClick={() => setIdeSettings({ ...ideSettings, tabSize: s })}
                >
                  {s} 空格
                </button>
              ))}
            </div>
          </div>

          <div className="form-group" style={{ marginTop: 20 }}>
            <label>编辑器功能</label>
            <div className="mode-list">
              <ModeCard
                icon="✨"
                title="自动补全"
                desc="启用代码智能提示和自动补全"
                enabled={ideSettings.autoComplete}
                onToggle={() => setIdeSettings({ ...ideSettings, autoComplete: !ideSettings.autoComplete })}
              />
              <ModeCard
                icon="↩️"
                title="自动换行"
                desc="长代码行自动折行显示"
                enabled={ideSettings.wordWrap}
                onToggle={() => setIdeSettings({ ...ideSettings, wordWrap: !ideSettings.wordWrap })}
              />
              <ModeCard
                icon="🗺️"
                title="代码缩略图"
                desc="编辑器右侧显示代码缩略图导航"
                enabled={ideSettings.minimap}
                onToggle={() => setIdeSettings({ ...ideSettings, minimap: !ideSettings.minimap })}
              />
              <ModeCard
                icon="🔢"
                title="行号显示"
                desc="编辑器左侧显示行号"
                enabled={ideSettings.lineNumbers}
                onToggle={() => setIdeSettings({ ...ideSettings, lineNumbers: !ideSettings.lineNumbers })}
              />
            </div>
          </div>

          <div className="form-group" style={{ marginTop: 20 }}>
            <label>编译器 / 编程工具接入</label>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
              支持接入外部编译器工具链，扩展 IDE 功能
            </p>
            <div className="mode-list">
              <ModeCard
                icon="🐍"
                title="Python 解释器"
                desc="接入 Python 运行时进行代码执行和调试"
                enabled={true}
                onToggle={() => {}}
              />
              <ModeCard
                icon="📦"
                title="Node.js 运行时"
                desc="接入 Node.js 进行 JavaScript/TypeScript 开发"
                enabled={true}
                onToggle={() => {}}
              />
              <ModeCard
                icon="🔌"
                title="扩展插件"
                desc="支持 VS Code 兼容插件扩展"
                enabled={false}
                onToggle={() => {}}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── 系统信息 ── */}
      {activeSection === 'system' && (
        <SystemInfoPanel systemInfo={systemInfo} />
      )}

      {/* ── 外观设置 ── */}
      {activeSection === 'appearance' && (
        <div className="card">
          <div className="card-header">界面外观</div>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20 }}>
            自定义界面主题、字体大小等显示偏好，设置自动保存到本地
          </p>

          <div className="form-group">
            <label>主题模式</label>
            <div style={{ display: 'flex', gap: 12 }}>
              {(['dark', 'light'] as const).map((t) => (
                <button
                  key={t}
                  className={`theme-chip ${userSettings.theme === t ? 'selected' : ''}`}
                  onClick={() => setUserSettings({ theme: t })}
                >
                  <span className="theme-icon">{t === 'dark' ? '🌙' : '☀️'}</span>
                  <span>{t === 'dark' ? '深色模式' : '浅色模式'}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="form-group" style={{ marginTop: 20 }}>
            <label>字体大小</label>
            <div style={{ display: 'flex', gap: 12 }}>
              {(['small', 'medium', 'large'] as const).map((s) => (
                <button
                  key={s}
                  className={`theme-chip ${userSettings.fontSize === s ? 'selected' : ''}`}
                  onClick={() => setUserSettings({ fontSize: s })}
                >
                  <span style={{ fontSize: s === 'small' ? 12 : s === 'large' ? 18 : 14 }}>
                    {s === 'small' ? '小' : s === 'large' ? '大' : '中'}
                  </span>
                </button>
              ))}
            </div>
            <div className="form-help">调整后将应用于整个界面</div>
          </div>

          <div className="form-group" style={{ marginTop: 20 }}>
            <label>各端独立设置</label>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
              CLI、Web、客户端各有独立的设置项，互不影响
            </p>

            {/* CLI 端 */}
            <div className="form-group" style={{ marginTop: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)' }}>💻 CLI 命令行端</label>
              <div className="mode-list" style={{ marginTop: 8 }}>
                <ModeCard
                  icon="⌨️"
                  title="Tab 命令补全"
                  desc="在命令行界面中启用 Tab 自动补全和智能提示"
                  enabled={userSettings.cliAutoComplete}
                  onToggle={() => setUserSettings({ cliAutoComplete: !userSettings.cliAutoComplete })}
                />
                <ModeCard
                  icon="📜"
                  title="历史记录"
                  desc={`保留 ${userSettings.cliHistorySize} 条历史命令（支持上下箭头回溯）`}
                  enabled={userSettings.cliHistorySize > 0}
                  onToggle={() => setUserSettings({ cliHistorySize: userSettings.cliHistorySize > 0 ? 0 : 100 })}
                />
                <ModeCard
                  icon="🎨"
                  title="彩色输出"
                  desc="CLI 启用彩色语法高亮和状态标识"
                  enabled={userSettings.cliColorEnabled}
                  onToggle={() => setUserSettings({ cliColorEnabled: !userSettings.cliColorEnabled })}
                />
              </div>
            </div>

            {/* Web 端 */}
            <div className="form-group" style={{ marginTop: 20 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)' }}>🌐 Web 网页端</label>
              <div className="mode-list" style={{ marginTop: 8 }}>
                <ModeCard
                  icon="📐"
                  title="紧凑模式"
                  desc="缩小间距以在屏幕上显示更多内容"
                  enabled={userSettings.webCompactMode}
                  onToggle={() => setUserSettings({ webCompactMode: !userSettings.webCompactMode })}
                />
                <ModeCard
                  icon="📂"
                  title="侧边栏折叠"
                  desc="默认折叠侧边栏以获得更大的工作区"
                  enabled={userSettings.webSidebarCollapsed}
                  onToggle={() => setUserSettings({ webSidebarCollapsed: !userSettings.webSidebarCollapsed })}
                />
                <ModeCard
                  icon="✨"
                  title="动画效果"
                  desc="启用页面切换和交互动画"
                  enabled={userSettings.webAnimationsEnabled}
                  onToggle={() => setUserSettings({ webAnimationsEnabled: !userSettings.webAnimationsEnabled })}
                />
              </div>
            </div>

            {/* 客户端 */}
            <div className="form-group" style={{ marginTop: 20 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)' }}>🖥️ 桌面客户端</label>
              <div className="mode-list" style={{ marginTop: 8 }}>
                <ModeCard
                  icon="🚀"
                  title="开机自启"
                  desc="系统启动时自动启动 AI Hubs 客户端"
                  enabled={userSettings.clientAutoStart}
                  onToggle={() => setUserSettings({ clientAutoStart: !userSettings.clientAutoStart })}
                />
                <ModeCard
                  icon="📥"
                  title="最小化到托盘"
                  desc="关闭窗口时最小化到系统托盘而不是退出"
                  enabled={userSettings.clientMinimizeToTray}
                  onToggle={() => setUserSettings({ clientMinimizeToTray: !userSettings.clientMinimizeToTray })}
                />
                <ModeCard
                  icon="🔔"
                  title="桌面通知"
                  desc="任务完成或错误时发送系统桌面通知"
                  enabled={userSettings.clientNotificationEnabled}
                  onToggle={() => setUserSettings({ clientNotificationEnabled: !userSettings.clientNotificationEnabled })}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .settings-container { padding: 20px 24px; max-width: 900px; }
        .settings-header { margin-bottom: 20px; }
        .settings-header h2 { font-size: 18px; color: var(--text-bright); }
        .settings-toast { padding: 10px 16px; border-radius: var(--radius); margin-bottom: 16px; font-size: 13px; animation: slideUp 0.3s; }
        .settings-toast.success { background: rgba(63,185,80,.12); color: var(--success); border: 1px solid rgba(63,185,80,.3); }
        .settings-toast.error { background: rgba(248,81,73,.12); color: var(--error); border: 1px solid rgba(248,81,73,.3); }

        .settings-tabs { display: flex; gap: 4px; margin-bottom: 20px; background: var(--card); border-radius: var(--radius-lg);
          padding: 4px; border: 1px solid var(--border); }
        .settings-tab { flex: 1; padding: 10px 14px; border-radius: var(--radius); font-size: 13px; font-weight: 500;
          background: transparent; border: none; color: var(--muted); cursor: pointer; transition: all .15s; text-align: center; }
        .settings-tab:hover { color: var(--text); }
        .settings-tab.active { background: var(--primary-bg); color: var(--primary); }

        .model-grid { display: flex; flex-wrap: wrap; gap: 8px; }
        .model-chip { padding: 6px 14px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--code-bg);
          color: var(--text); font-size: 12px; font-family: monospace; cursor: pointer; transition: all .15s; }
        .model-chip:hover { border-color: var(--primary); }
        .model-chip.selected { border-color: var(--primary); background: var(--primary-bg); color: var(--primary); font-weight: 600; }
        .chip-provider { font-size: 10px; color: var(--muted); margin-right: 6px; text-transform: uppercase; }

        .mode-list { display: flex; flex-direction: column; gap: 12px; }
        .mode-card { display: flex; align-items: center; gap: 14px; padding: 16px; background: var(--code-bg);
          border: 1px solid var(--border); border-radius: var(--radius-lg); transition: all .15s; }
        .mode-card:hover { border-color: var(--primary); }
        .mode-icon { font-size: 28px; flex-shrink: 0; }
        .mode-info { flex: 1; }
        .mode-title { font-size: 14px; font-weight: 600; color: var(--text-bright); margin-bottom: 2px; }
        .mode-desc { font-size: 12px; color: var(--muted); line-height: 1.5; }
        .mode-switch { flex-shrink: 0; }

        .tools-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
        .tool-card { padding: 14px; background: var(--code-bg); border: 1px solid var(--border); border-radius: var(--radius); }
        .tool-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
        .tool-name { font-weight: 600; color: var(--primary); font-size: 13px; font-family: monospace; }
        .tool-danger { font-size: 10px; color: var(--error); padding: 1px 6px; background: rgba(248,81,73,.1); border-radius: 6px; }
        .tool-desc { font-size: 12px; color: var(--text); line-height: 1.5; margin-bottom: 8px; }
        .tool-params { display: flex; flex-wrap: wrap; gap: 4px; }
        .tool-param { font-size: 10px; padding: 1px 6px; background: var(--primary-bg); color: var(--primary); border-radius: 6px;
          font-family: monospace; }

        .sys-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .sys-item { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px;
          background: var(--code-bg); border: 1px solid var(--border); border-radius: var(--radius); }
        .sys-label { font-size: 12px; color: var(--muted); }
        .sys-value { font-size: 14px; font-weight: 600; color: var(--text-bright); font-family: monospace; }
        .sys-subtitle { font-size: 12px; color: var(--muted); margin-top: 4px; }

        .theme-chip { display: flex; align-items: center; gap: 8px; padding: 10px 18px; border-radius: var(--radius-lg);
          border: 1px solid var(--border); background: var(--code-bg); color: var(--text); font-size: 13px;
          cursor: pointer; transition: all .15s; }
        .theme-chip:hover { border-color: var(--primary); }
        .theme-chip.selected { border-color: var(--primary); background: var(--primary-bg); color: var(--primary); font-weight: 600; }
        .theme-icon { font-size: 18px; }
      `}</style>
    </div>
  );
}

// ── 功能模式卡片 ──
function ModeCard({ icon, title, desc, enabled, onToggle }: {
  icon: string; title: string; desc: string; enabled: boolean; onToggle: () => void;
}) {
  return (
    <div className="mode-card">
      <div className="mode-icon">{icon}</div>
      <div className="mode-info">
        <div className="mode-title">{title}</div>
        <div className="mode-desc">{desc}</div>
      </div>
      <div className="mode-switch">
        <button className={`ts-track ${enabled ? 'on' : 'off'}`} onClick={onToggle} type="button">
          <span className="ts-thumb" />
        </button>
      </div>
    </div>
  );
}

// ── 系统信息面板 ──
function SystemInfoPanel({ systemInfo }: { systemInfo: SystemInfo | null }) {
  return (
    <div className="card">
      <div className="card-header">系统信息</div>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 18 }}>
        服务器运行状态与资源使用
      </p>

      {systemInfo ? (
        <div className="sys-grid">
          <div className="sys-item">
            <span className="sys-label">Python 版本</span>
            <span className="sys-value">{systemInfo.python_version}</span>
          </div>
          <div className="sys-item">
            <span className="sys-label">运行平台</span>
            <span className="sys-value" style={{ fontSize: 13 }}>{systemInfo.platform}</span>
          </div>
          <div className="sys-item">
            <span className="sys-label">CPU 核心数</span>
            <span className="sys-value">{systemInfo.cpu_count}</span>
          </div>
          <div className="sys-item">
            <span className="sys-label">内存使用</span>
            <span className="sys-value">{systemInfo.memory_used_mb} MB</span>
          </div>
          <div className="sys-item" style={{ gridColumn: '1 / -1' }}>
            <span className="sys-label">运行时间</span>
            <span className="sys-value">{formatUptime(systemInfo.uptime_seconds)}</span>
          </div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
          <div className="spinner" style={{ marginBottom: 12 }} />
          加载系统信息...
        </div>
      )}
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h} 小时 ${m} 分钟`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return `${d} 天 ${h} 小时`;
}

function providerLabel(p: string): string {
  const m: Record<string, string> = {
    openai: 'OpenAI', deepseek: 'DeepSeek', zhipu: '智谱 GLM',
    qwen: '通义千问', ollama: 'Ollama', custom: '自定义',
  };
  return m[p] || p;
}

function modeLabel(mode: string): string {
  const m: Record<string, string> = {
    planning: '计划模式', rag: 'RAG 检索', reflection: '反思模式',
  };
  return m[mode] || mode;
}
