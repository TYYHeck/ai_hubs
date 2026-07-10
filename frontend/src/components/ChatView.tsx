import { useState, useRef, useEffect, useCallback } from 'react';
import { useAppStore, createUserMessage, createAgentMessage } from '../stores/appStore';
import { chatStream } from '../api/client';
import type { ChatMessage } from '../types';

// ── 对话即管理：斜杠命令 ──
const SLASH_COMMANDS: Record<string, { desc: string; action: (setInput: (v: string) => void) => void }> = {
  '/agent': { desc: '查看 Agent 列表', action: (setInput) => setInput('列出当前所有可用的 Agent') },
  '/task': { desc: '创建新任务', action: (setInput) => setInput('创建一个新任务：') },
  '/clear': { desc: '清空对话', action: () => { /* handled in component */ } },
  '/recall': { desc: '检索相关记忆', action: (setInput) => setInput('回忆一下之前关于 ') },
  '/code': { desc: '编写代码', action: (setInput) => setInput('写一段 Python 代码：') },
  '/skill': { desc: '使用技能', action: (setInput) => setInput('帮我用以下技能完成任务：') },
  '/search': { desc: '联网搜索', action: (setInput) => setInput('搜索：') },
  '/config': { desc: '系统配置', action: (setInput) => setInput('当前系统配置是什么？') },
};

export default function ChatView() {
  const messages = useAppStore((s) => s.messages);
  const isStreaming = useAppStore((s) => s.isStreaming);
  const addMessage = useAppStore((s) => s.addMessage);
  const updateLastMessage = useAppStore((s) => s.updateLastMessage);
  const clearMessages = useAppStore((s) => s.clearMessages);
  const setStreaming = useAppStore((s) => s.setStreaming);
  const agents = useAppStore((s) => s.agents);
  const setActiveTab = useAppStore((s) => s.setActiveTab);

  const [input, setInput] = useState('');
  const [showCommands, setShowCommands] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const quickPanelRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    // 处理斜杠命令
    if (text === '/clear') {
      clearMessages();
      setInput('');
      return;
    }

    setInput('');
    setShowCommands(false);

    const userMsg = createUserMessage(text);
    const agentMsg = createAgentMessage();
    addMessage(userMsg);
    addMessage(agentMsg);
    setStreaming(true);

    let fullContent = '';

    abortRef.current = chatStream(
      text,
      (evt) => {
        if (evt.type === 'text' && typeof evt.content === 'string') {
          fullContent += evt.content;
          updateLastMessage(fullContent);
        } else if (evt.type === 'tool_call') {
          const name = evt.name || '';
          fullContent += `\n\n> 🔧 调用工具: **${name}**\n`;
          updateLastMessage(fullContent);
        } else if (evt.type === 'tool_result') {
          const result = typeof evt.result === 'string' ? evt.result.slice(0, 300) : '';
          fullContent += `\n> ✅ 工具返回: ${result}\n\n`;
          updateLastMessage(fullContent);
        } else if (evt.type === 'error') {
          fullContent += `\n\n❌ 错误: ${evt.content || '未知错误'}`;
          updateLastMessage(fullContent);
        }
      },
      () => {
        updateLastMessage(fullContent || '(无回复)');
        setStreaming(false);
      },
      (err) => {
        updateLastMessage(`请求失败: ${err.message}`);
        setStreaming(false);
      }
    );
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setStreaming(false);
  };

  const handleInputChange = (value: string) => {
    setInput(value);
    setShowCommands(value.startsWith('/') && value.length <= 8);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      setShowCommands(false);
    }
  };

  const renderMessageContent = (msg: ChatMessage) => {
    if (msg.role === 'system') {
      return (
        <div style={{ fontStyle: 'italic', color: 'var(--muted)', fontSize: 12, padding: '4px 0' }}>
          系统: {msg.content}
        </div>
      );
    }

    const isUser = msg.role === 'user';

    return (
      <div className={`chat-msg ${isUser ? 'user' : 'agent'}`}>
        <div className="chat-msg-header">
          {isUser ? (
            <span className="chat-badge user-badge">你</span>
          ) : (
            <span className="chat-badge agent-badge">
              {msg.agentName || 'AI Hubs'}
            </span>
          )}
          <span className="chat-time">
            {new Date(msg.timestamp).toLocaleTimeString()}
          </span>
        </div>
        <div className={`chat-body ${isUser ? 'user-body' : 'agent-body'}`}>
          <MarkdownRenderer content={msg.content} />
          {msg.isStreaming && <span className="loading-dots" />}
        </div>
      </div>
    );
  };

  return (
    <div className="chat-container">
      {/* 头部 */}
      <div className="chat-header">
        <div className="chat-header-left">
          <h2>💬 对话</h2>
          <span className="chat-agent-count">
            {agents.length} 个 Agent 可用
          </span>
        </div>
        <div className="chat-header-right">
          <button className="btn btn-sm" onClick={clearMessages} disabled={isStreaming}>
            清空对话
          </button>
        </div>
      </div>

      {/* 消息列表 */}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon">🤖</div>
            <h3>AI Hubs 已就绪</h3>
            <p>输入你的任务，让我来帮你完成。支持联网搜索、代码执行、文件生成、多Agent协作等功能。</p>
            <div className="chat-suggestions">
              <SuggestionButton onClick={setInput} text="帮我分析今天的热点新闻" />
              <SuggestionButton onClick={setInput} text="用 Python 写一个快速排序算法" />
              <SuggestionButton onClick={setInput} text="对比 React 和 Vue 的优缺点" />
              <SuggestionButton onClick={setInput} text="帮我生成一份项目周报模板" />
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id}>{renderMessageContent(msg)}</div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 */}
      <div className="chat-input-area">
        {/* 斜杠命令面板 */}
        {showCommands && (
          <div className="chat-commands-panel">
            {Object.entries(SLASH_COMMANDS).map(([cmd, { desc, action }]) => (
              <div
                key={cmd}
                className={`chat-command-item${input === cmd ? ' active' : ''}`}
                onClick={() => action(setInput)}
              >
                <span className="chat-command-cmd">{cmd}</span>
                <span className="chat-command-desc">{desc}</span>
              </div>
            ))}
          </div>
        )}

        {/* 快速操作面板 */}
        {!showCommands && messages.length === 0 && (
          <div className="chat-quick-panel" ref={quickPanelRef}>
            <span className="chat-quick-label">快捷操作：</span>
            {[
              { icon: '🤖', label: 'Agent', onClick: () => setActiveTab('agents') },
              { icon: '📋', label: '任务', onClick: () => setActiveTab('tasks') },
              { icon: '🎯', label: '技能', onClick: () => setActiveTab('skills') },
              { icon: '📁', label: 'IDE', onClick: () => setActiveTab('ide') },
            ].map((btn) => (
              <button key={btn.label} className="chat-quick-btn" onClick={btn.onClick}>
                {btn.icon} {btn.label}
              </button>
            ))}
          </div>
        )}

        <div className="chat-input-row">
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder={showCommands ? '输入命令或继续输入...' : '输入你的任务，Shift+Enter 换行，Enter 发送...（输入 / 查看命令）'}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isStreaming}
          />
          {isStreaming ? (
            <button className="btn btn-danger btn-sm" onClick={handleStop}>
              停止
            </button>
          ) : (
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSend}
              disabled={!input.trim()}
            >
              发送
            </button>
          )}
        </div>
      </div>

      <style>{`
        .chat-container { display:flex; flex-direction:column; height:100%; }
        .chat-header { display:flex; align-items:center; justify-content:space-between; padding:14px 24px; border-bottom:1px solid var(--border); flex-shrink:0; }
        .chat-header-left { display:flex; align-items:center; gap:12px; }
        .chat-header-left h2 { font-size:16px; color:var(--text-bright); }
        .chat-agent-count { font-size:12px; color:var(--muted); background:var(--card); padding:2px 10px; border-radius:10px; }
        .chat-header-right { display:flex; gap:8px; }

        .chat-messages { flex:1; overflow-y:auto; padding:20px 24px; display:flex; flex-direction:column; gap:12px; }
        .chat-empty { text-align:center; padding:60px 20px; }
        .chat-empty-icon { font-size:64px; margin-bottom:16px; }
        .chat-empty h3 { color:var(--text-bright); font-size:20px; margin-bottom:8px; }
        .chat-empty p { color:var(--muted); font-size:13px; max-width:460px; margin:0 auto 24px; }
        .chat-suggestions { display:flex; flex-wrap:wrap; gap:8px; justify-content:center; }
        .chat-suggest-btn { background:var(--card); border:1px solid var(--border); color:var(--text); padding:8px 16px; border-radius:20px; font-size:13px; cursor:pointer; transition:all .15s; }
        .chat-suggest-btn:hover { background:var(--primary-bg); color:var(--primary); border-color:var(--primary); }

        .chat-msg { display:flex; flex-direction:column; max-width:88%; animation:msgIn .25s; }
        .chat-msg.user { align-items:flex-end; align-self:flex-end; }
        .chat-msg.agent { align-items:flex-start; align-self:flex-start; }
        @keyframes msgIn { from{opacity:0;transform:translateY(8px);} to{opacity:1;transform:translateY(0);} }

        .chat-msg-header { display:flex; align-items:center; gap:8px; margin-bottom:4px; }
        .chat-badge { padding:2px 10px; border-radius:10px; font-size:11px; font-weight:600; }
        .chat-badge.user-badge { background:var(--primary); color:#fff; }
        .chat-badge.agent-badge { background:var(--purple); color:#fff; }
        .chat-time { color:var(--muted); font-size:10px; }

        .chat-body { padding:14px 18px; border-radius:16px; font-size:14px; line-height:1.7; word-break:break-word; }
        .chat-body.user-body { background:var(--user-bg); color:#fff; border-bottom-right-radius:4px; }
        .chat-body.agent-body { background:var(--agent-bg); color:var(--text); border:1px solid var(--border); border-bottom-left-radius:4px; }

        .chat-body pre { background:var(--code-bg); padding:12px; border-radius:8px; overflow-x:auto; font-size:13px; margin:8px 0; border:1px solid var(--border); }
        .chat-body code { background:var(--code-bg); padding:2px 6px; border-radius:4px; font-size:13px; font-family:'Cascadia Code',Consolas,monospace; }
        .chat-body pre code { padding:0; background:none; }
        .chat-body ul,.chat-body ol { padding-left:20px; margin:6px 0; }
        .chat-body h1,.chat-body h2,.chat-body h3 { color:var(--text-bright); margin:12px 0 6px; }
        .chat-body blockquote { border-left:3px solid var(--primary); padding-left:12px; margin:8px 0; color:var(--muted); }
        .chat-body table { border-collapse:collapse; width:100%; margin:8px 0; }
        .chat-body th,.chat-body td { border:1px solid var(--border); padding:6px 12px; text-align:left; font-size:13px; }
        .chat-body th { background:var(--code-bg); color:var(--text-bright); }

        .chat-input-area { padding:12px 24px 16px; border-top:1px solid var(--border); flex-shrink:0; }
        .chat-input-row { display:flex; gap:10px; align-items:flex-end; }
        .chat-input { flex:1; background:var(--card); border:1px solid var(--border); border-radius:var(--radius); padding:10px 14px; color:var(--text); font-size:14px; font-family:inherit; resize:none; outline:none; max-height:120px; }
        .chat-input:focus { border-color:var(--primary); }
        .chat-input::placeholder { color:var(--muted); }
      `}</style>
    </div>
  );
}

// ── 建议按钮 ──
function SuggestionButton({ text, onClick }: { text: string; onClick: (v: string) => void }) {
  return (
    <button className="chat-suggest-btn" onClick={() => onClick(text)}>
      {text.length > 30 ? text.slice(0, 30) + '…' : text}
    </button>
  );
}

// ── Markdown 渲染器 (简易版，无需额外依赖) ──
function MarkdownRenderer({ content }: { content: string }) {
  if (!content) return null;

  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeLang = '';

  const pushCodeBlock = () => {
    if (codeLines.length > 0) {
      elements.push(
        <pre key={`cb-${i}`}><code>{codeLines.join('\n')}</code></pre>
      );
      codeLines = [];
      inCodeBlock = false;
    }
  };

  const processInline = (text: string): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let key = 0;

    // bold
    remaining = remaining.replace(/\*\*(.+?)\*\*/g, (_, c) => `__BOLD__${c}__/BOLD__`);
    // italic
    remaining = remaining.replace(/\*(.+?)\*/g, (_, c) => `__ITALIC__${c}__/ITALIC__`);
    // inline code
    remaining = remaining.replace(/`([^`]+)`/g, (_, c) => `__CODE__${c}__/CODE__`);
    // link
    remaining = remaining.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => `__LINK__${t}|${u}__/LINK__`);

    const segs = remaining.split(/(__BOLD__|__\/BOLD__|__ITALIC__|__\/ITALIC__|__CODE__|__\/CODE__|__LINK__|__\/LINK__)/);
    let inBold = false, inItalic = false, inCode = false, inLink = false;
    let linkText = '', linkUrl = '';

    for (const seg of segs) {
      if (seg === '__BOLD__') { inBold = true; continue; }
      if (seg === '__/BOLD__') { inBold = false; continue; }
      if (seg === '__ITALIC__') { inItalic = true; continue; }
      if (seg === '__/ITALIC__') { inItalic = false; continue; }
      if (seg === '__CODE__') { inCode = true; continue; }
      if (seg === '__/CODE__') { inCode = false; continue; }
      if (seg === '__LINK__') { inLink = true; continue; }
      if (seg === '__/LINK__') { inLink = false; parts.push(<a key={key++} href={linkUrl} target="_blank" rel="noopener noreferrer">{linkText}</a>); continue; }

      if (inLink) {
        const [t, u] = seg.split('|');
        linkText = t || '';
        linkUrl = u || '';
        continue;
      }

      let el: React.ReactNode = seg;
      if (inCode) el = <code key={key}>{seg}</code>;
      else if (inBold) el = <strong key={key}>{seg}</strong>;
      else if (inItalic) el = <em key={key}>{seg}</em>;
      parts.push(<span key={key++}>{el}</span>);

      if (inLink) {
        parts.push(<a key={key++} href={linkUrl} target="_blank" rel="noopener noreferrer">{linkText}</a>);
        inLink = false;
      }
    }

    return <>{parts}</>;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        pushCodeBlock();
      } else {
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
        codeLines = [];
      }
      i++;
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      i++;
      continue;
    }

    // headings
    if (line.startsWith('### ')) {
      elements.push(<h3 key={i}>{processInline(line.slice(4))}</h3>);
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i}>{processInline(line.slice(3))}</h2>);
    } else if (line.startsWith('# ')) {
      elements.push(<h1 key={i}>{processInline(line.slice(2))}</h1>);
    } else if (line.startsWith('> ')) {
      elements.push(<blockquote key={i}>{processInline(line.slice(2))}</blockquote>);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(<li key={i}>{processInline(line.slice(2))}</li>);
    } else if (/^\d+\.\s/.test(line)) {
      elements.push(<li key={i}>{processInline(line.replace(/^\d+\.\s/, ''))}</li>);
    } else if (line.startsWith('---') || line.startsWith('***')) {
      elements.push(<hr key={i} />);
    } else if (line.trim() === '') {
      elements.push(<br key={i} />);
    } else {
      elements.push(<p key={i}>{processInline(line)}</p>);
    }
    i++;
  }

  pushCodeBlock();

  return <>{elements}</>;
}
