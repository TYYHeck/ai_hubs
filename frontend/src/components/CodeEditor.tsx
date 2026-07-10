import { useState, useCallback } from 'react';

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

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

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
                <div key={i} className="ide-line-num">{i + 1}</div>
              ))}
            </div>
            <div className="ide-input-wrapper">
              <pre
                className="ide-highlight"
                dangerouslySetInnerHTML={{
                  __html: syntaxHighlight(activeTab.content, activeTab.language) + '\n',
                }}
              />
              <textarea
                className="ide-textarea"
                value={activeTab.content}
                onChange={(e) => updateContent(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
              />
            </div>
          </div>

          {/* 底部状态栏 */}
          <div className="ide-statusbar">
            <span>{activeTab.name} · {activeTab.language}</span>
            <span>
              {activeTab.content.split('\n').length} 行 · {activeTab.content.length} 字符
              {activeTab.saved ? '' : ' · 未保存'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
