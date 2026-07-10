import { useState, useCallback } from 'react';
import { useAppStore } from '../stores/appStore';

interface CodeEditorProps {
  onClose?: () => void;
}

interface FileTab {
  id: string;
  name: string;
  content: string;
  language: string;
  saved: boolean;
}

interface PluginInfo {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  icon: string;
}

const BUILTIN_PLUGINS: PluginInfo[] = [
  { id: 'python-runner', name: 'Python 运行器', description: '在 IDE 中运行 Python 代码', installed: true, icon: '🐍' },
  { id: 'js-runner', name: 'JavaScript 运行器', description: '在浏览器中运行 JS 代码', installed: true, icon: '🟨' },
  { id: 'prettier', name: '代码格式化', description: '自动格式化代码排版', installed: false, icon: '✨' },
  { id: 'linter', name: '代码检查', description: '语法和风格检查', installed: false, icon: '🔍' },
  { id: 'git-integration', name: 'Git 集成', description: '内置 Git 版本控制', installed: false, icon: '🔀' },
  { id: 'theme-customizer', name: '主题定制', description: '自定义编辑器配色方案', installed: false, icon: '🎨' },
  { id: 'snippets', name: '代码片段', description: '常用代码模板快速插入', installed: false, icon: '📋' },
  { id: 'vscode-remote', name: 'VS Code 远程', description: '连接 VS Code Server 远程开发', installed: false, icon: '🔗' },
];

const LANGUAGE_MAP: Record<string, string> = {
  py: 'python',
  js: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  jsx: 'javascript',
  html: 'html',
  css: 'css',
  json: 'json',
  md: 'markdown',
  yaml: 'yaml',
  yml: 'yaml',
  sql: 'sql',
  sh: 'bash',
  txt: 'text',
};

function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return LANGUAGE_MAP[ext] || 'text';
}

function syntaxHighlight(code: string, lang: string): string {
  // 简单的语法高亮
  let html = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 字符串
  html = html.replace(/(&quot;.*?&quot;|&#39;.*?&#39;|'[^']*'|"[^"]*"|`[^`]*`)/g,
    '<span class="ide-string">$1</span>');

  // 注释 (单行)
  if (['python', 'yaml', 'bash'].includes(lang)) {
    html = html.replace(/(#.*)/g, '<span class="ide-comment">$1</span>');
  } else {
    html = html.replace(/(\/\/.*)/g, '<span class="ide-comment">$1</span>');
  }

  // Python 关键字
  if (lang === 'python') {
    const pyKeywords = [
      'import', 'from', 'def', 'class', 'return', 'if', 'elif', 'else',
      'for', 'while', 'try', 'except', 'finally', 'with', 'as', 'pass',
      'break', 'continue', 'and', 'or', 'not', 'in', 'is', 'None', 'True',
      'False', 'self', 'async', 'await', 'yield', 'raise', 'lambda',
    ];
    pyKeywords.forEach((kw) => {
      html = html.replace(new RegExp(`\\b(${kw})\\b`, 'g'),
        '<span class="ide-keyword">$1</span>');
    });
  }

  // JS/TS 关键字
  if (['javascript', 'typescript'].includes(lang)) {
    const jsKeywords = [
      'import', 'export', 'from', 'const', 'let', 'var', 'function',
      'return', 'if', 'else', 'for', 'while', 'class', 'extends',
      'new', 'this', 'async', 'await', 'try', 'catch', 'throw',
      'typeof', 'instanceof', 'interface', 'type', 'enum', 'default',
      'null', 'undefined', 'true', 'false', 'void',
    ];
    jsKeywords.forEach((kw) => {
      html = html.replace(new RegExp(`\\b(${kw})\\b`, 'g'),
        '<span class="ide-keyword">$1</span>');
    });
  }

  // HTML 标签
  if (lang === 'html') {
    html = html.replace(/(<\/?[a-zA-Z][a-zA-Z0-9-]*)/g,
      '<span class="ide-tag">$1</span>');
  }

  // 数字
  html = html.replace(/\b(\d+\.?\d*)\b/g,
    '<span class="ide-number">$1</span>');

  return html;
}

export default function CodeEditor({ onClose }: CodeEditorProps) {
  const userSettings = useAppStore((s) => s.userSettings);
  const [tabs, setTabs] = useState<FileTab[]>([
    {
      id: 'welcome',
      name: 'welcome.py',
      content: '# AI Hubs 内置 IDE\n# 在这里编写和测试代码\n\ndef hello():\n    print("欢迎使用 AI Hubs IDE!")\n\nif __name__ == "__main__":\n    hello()\n',
      language: 'python',
      saved: true,
    },
  ]);
  const [activeTabId, setActiveTabId] = useState('welcome');
  const [explorerVisible, setExplorerVisible] = useState(true);
  const [pluginPanel, setPluginPanel] = useState(false);
  const [plugins, setPlugins] = useState<PluginInfo[]>(BUILTIN_PLUGINS);
  const [runOutput, setRunOutput] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  const fontSize = userSettings.fontSize === 'small' ? 12 : userSettings.fontSize === 'large' ? 16 : 14;

  const updateContent = useCallback((content: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, content, saved: false } : t))
    );
  }, [activeTabId]);

  const newFile = () => {
    const name = prompt('文件名 (如 test.py):', 'untitled.py');
    if (!name) return;
    const id = `file_${Date.now()}`;
    const lang = detectLanguage(name);
    const newTab: FileTab = {
      id,
      name,
      content: lang === 'python' ? '# ' + name + '\n' : '',
      language: lang,
      saved: true,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(id);
  };

  const saveFile = (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    // 触发下载
    const blob = new Blob([tab.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = tab.name;
    a.click();
    URL.revokeObjectURL(url);
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, saved: true } : t))
    );
  };

  const closeTab = (tabId: string) => {
    if (tabs.length <= 1) return;
    const newTabs = tabs.filter((t) => t.id !== tabId);
    setTabs(newTabs);
    if (activeTabId === tabId) {
      setActiveTabId(newTabs[newTabs.length - 1].id);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      saveFile(activeTabId);
    }
  };

  const runCode = async () => {
    setRunning(true);
    setRunOutput(null);
    const code = activeTab.content;
    const lang = activeTab.language;

    if (lang === 'javascript' || lang === 'typescript') {
      try {
        const originalLog = console.log;
        const logs: string[] = [];
        console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
        // eslint-disable-next-line no-eval
        const result = eval(code);
        console.log = originalLog;
        const output = logs.length > 0 ? logs.join('\n') : String(result ?? '执行完成（无输出）');
        setRunOutput(output);
      } catch (e: unknown) {
        setRunOutput(`错误: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (lang === 'python') {
      setRunOutput(
        '🐍 Python 代码需要在服务器端运行。\n' +
        '提示：将代码保存后通过终端或 Agent 执行。\n' +
        '或使用 Ctrl+S 下载后在本地 Python 环境运行。\n\n' +
        '--- 即将支持远程执行 ---\n' +
        '代码行数: ' + code.split('\n').length + ' · 字符数: ' + code.length
      );
    } else if (lang === 'html') {
      const win = window.open('', '_blank', 'width=800,height=600');
      if (win) {
        win.document.write(code);
        win.document.close();
        setRunOutput('HTML 已在新窗口中打开');
      } else {
        setRunOutput('弹窗被阻止，请允许弹出窗口后重试');
      }
    } else {
      setRunOutput(`暂不支持运行 ${lang} 代码。已支持: Python(即将支持), JavaScript, HTML`);
    }
    setRunning(false);
  };

  const togglePlugin = (id: string) => {
    setPlugins((prev) =>
      prev.map((p) => (p.id === id ? { ...p, installed: !p.installed } : p))
    );
  };

  return (
    <div className="ide-container">
      {/* 工具栏 */}
      <div className="ide-toolbar">
        <div className="ide-toolbar-left">
          <button
            className={`ide-toolbar-btn${explorerVisible ? ' active' : ''}`}
            onClick={() => setExplorerVisible(!explorerVisible)}
            title="文件浏览器"
          >
            📁
          </button>
          <button className="ide-toolbar-btn" onClick={newFile} title="新建文件">
            📄 +
          </button>
          <button
            className={`ide-toolbar-btn run-btn${running ? ' running' : ''}`}
            onClick={runCode}
            disabled={running}
            title={`运行 (${activeTab.language})`}
          >
            {running ? '⏳' : '▶'} 运行
          </button>
          <button
            className={`ide-toolbar-btn${pluginPanel ? ' active' : ''}`}
            onClick={() => setPluginPanel(!pluginPanel)}
            title="扩展插件"
          >
            🧩 扩展
          </button>
          <span className="ide-toolbar-title">AI Hubs IDE</span>
        </div>
        <div className="ide-toolbar-right">
          {!activeTab.saved && (
            <span className="ide-unsaved">● 未保存</span>
          )}
          <button
            className="ide-toolbar-btn"
            onClick={() => saveFile(activeTabId)}
            title="保存 (Ctrl+S)"
          >
            💾
          </button>
          {onClose && (
            <button className="ide-toolbar-btn ide-close-btn" onClick={onClose}>
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="ide-main">
        {/* 文件浏览器 */}
        {explorerVisible && (
          <div className="ide-explorer">
            <div className="ide-explorer-header">文件</div>
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={`ide-file-item${tab.id === activeTabId ? ' active' : ''}`}
                onClick={() => setActiveTabId(tab.id)}
                title={tab.name}
              >
                <span className="ide-file-icon">
                  {{ python: '🐍', javascript: '🟨', typescript: '🟦', html: '🌐', css: '🎨', json: '📋', markdown: '📝', yaml: '⚙️', sql: '🗄️', text: '📄' }[tab.language] || '📄'}
                </span>
                <span className="ide-file-name">{tab.name}</span>
                {!tab.saved && <span className="ide-file-dirty">●</span>}
              </div>
            ))}
          </div>
        )}

        {/* 编辑器区域 */}
        <div className="ide-editor-area">
          {/* 标签栏 */}
          <div className="ide-tabs">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={`ide-tab${tab.id === activeTabId ? ' active' : ''}`}
                onClick={() => setActiveTabId(tab.id)}
              >
                <span className="ide-tab-name">{tab.name}</span>
                {!tab.saved && <span className="ide-tab-dirty">●</span>}
                {tabs.length > 1 && (
                  <span
                    className="ide-tab-close"
                    onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                  >
                    ✕
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* 代码编辑器 */}
          <div className="ide-editor" onKeyDown={handleKeyDown}>
            <div className="ide-line-numbers">
              {activeTab.content.split('\n').map((_, i) => (
                <div key={i} className="ide-line-num" style={{ fontSize }}>{i + 1}</div>
              ))}
            </div>
            <div className="ide-input-wrapper">
              <pre
                className="ide-highlight"
                style={{ fontSize }}
                dangerouslySetInnerHTML={{
                  __html: syntaxHighlight(activeTab.content, activeTab.language) + '\n',
                }}
              />
              <textarea
                className="ide-textarea"
                style={{ fontSize }}
                value={activeTab.content}
                onChange={(e) => updateContent(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
              />
            </div>
          </div>

          {/* 运行输出面板 */}
          {runOutput !== null && (
            <div className="ide-run-output">
              <div className="ide-run-header">
                <span>▶ 运行输出 ({activeTab.language})</span>
                <button className="ide-toolbar-btn" onClick={() => setRunOutput(null)}>✕</button>
              </div>
              <pre className="ide-run-content">{runOutput}</pre>
            </div>
          )}

          {/* 底部状态栏 */}
          <div className="ide-statusbar">
            <span>{activeTab.name} · {activeTab.language} · 字号: {fontSize}px</span>
            <span>
              {activeTab.content.split('\n').length} 行 · {activeTab.content.length} 字符
              {activeTab.saved ? '' : ' · 未保存'}
            </span>
          </div>
        </div>

        {/* 扩展插件面板 */}
        {pluginPanel && (
          <div className="ide-plugin-panel">
            <div className="ide-plugin-header">
              <span>🧩 扩展插件 ({plugins.filter(p => p.installed).length}/{plugins.length} 已安装)</span>
              <button className="ide-toolbar-btn" onClick={() => setPluginPanel(false)}>✕</button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 10px' }}>
              安装扩展增强 IDE 功能。支持接入外部编程工具（VS Code Remote等）
            </p>
            <div className="ide-plugin-list">
              {plugins.map((p) => (
                <div key={p.id} className={`ide-plugin-item${p.installed ? ' installed' : ''}`}>
                  <span className="ide-plugin-icon">{p.icon}</span>
                  <div className="ide-plugin-info">
                    <div className="ide-plugin-name">{p.name}</div>
                    <div className="ide-plugin-desc">{p.description}</div>
                  </div>
                  <button
                    className={`btn btn-xs${p.installed ? ' btn-primary' : ''}`}
                    onClick={() => togglePlugin(p.id)}
                  >
                    {p.installed ? '已安装' : '安装'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
