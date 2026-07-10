import { useState, useCallback, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import { agentsApi, skillsApi } from '../api/client';
import type { AgentInfo } from '../types';

const ALL_PROVIDERS = ['openai', 'deepseek', 'zhipu', 'qwen', 'ollama', 'custom'] as const;

interface CreateForm {
  name: string;
  provider: string;
  model: string;
  skills: string[];
  useAllSkills: boolean;
  description: string;
  system_prompt: string;
  max_iterations: number;
  enable_planning: boolean;
  enable_rag: boolean;
  enable_reflection: boolean;
}

const emptyForm: CreateForm = {
  name: '',
  provider: 'deepseek',
  model: 'deepseek-chat',
  skills: [],
  useAllSkills: false,
  description: '',
  system_prompt: '',
  max_iterations: 15,
  enable_planning: false,
  enable_rag: true,
  enable_reflection: false,
};

export default function AgentManager() {
  const agents = useAppStore((s) => s.agents);
  const setAgents = useAppStore((s) => s.setAgents);
  const currentProvider = useAppStore((s) => s.currentProvider);
  const currentModel = useAppStore((s) => s.currentModel);

  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<string | null>(null);
  const [form, setForm] = useState<CreateForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [installedSkills, setInstalledSkills] = useState<{ id: string; name: string }[]>([]);

  // 加载已安装技能列表（用于多选）
  useEffect(() => {
    skillsApi.list('', true).then((res) => {
      if (res.ok) setInstalledSkills(res.skills.map((s) => ({ id: s.id, name: s.name })));
    }).catch(() => { /* ignore */ });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await agentsApi.list();
      setAgents(res.agents || []);
    } catch { /* ignore */ }
  }, [setAgents]);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setStatusMsg({ type, text });
    setTimeout(() => setStatusMsg(null), 3000);
  };

  const resetForm = () => {
    setForm(emptyForm);
    setEditTarget(null);
    setShowCreate(false);
  };

  const handleCreate = () => {
    setEditTarget(null);
    setForm({ ...emptyForm, provider: currentProvider, model: currentModel });
    setShowCreate(true);
  };

  const handleEdit = async (name: string) => {
    try {
      const res = await agentsApi.getConfig(name);
      if (res.ok && res.config) {
        const c = res.config as Record<string, unknown>;
        const sk = Array.isArray(c.skills) ? (c.skills as string[]) : [];
        setForm({
          name,
          provider: (c.provider as string) || currentProvider,
          model: (c.model as string) || currentModel,
          skills: sk,
          useAllSkills: false,
          description: (c.description as string) || '',
          system_prompt: (c.system_prompt as string) || '',
          max_iterations: (c.max_iterations as number) || 15,
          enable_planning: !!(c.enable_planning),
          enable_rag: c.enable_rag !== false,
          enable_reflection: !!(c.enable_reflection),
        });
      }
      setEditTarget(name);
      setShowCreate(true);
    } catch {
      showMsg('error', '获取 Agent 配置失败');
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      showMsg('error', 'Agent 名称不能为空');
      return;
    }
    if (form.name.trim().length > 50) {
      showMsg('error', 'Agent 名称不能超过 50 个字符');
      return;
    }

    setSaving(true);
    try {
      // 技能：若选择「使用全部技能」，则发送所有已安装技能 ID
      const finalSkills = form.useAllSkills
        ? installedSkills.map((s) => s.id)
        : form.skills;
      if (editTarget) {
        await agentsApi.update(editTarget, {
          skills: finalSkills,
          description: form.description,
          system_prompt: form.system_prompt,
          max_iterations: form.max_iterations,
          enable_planning: form.enable_planning,
          enable_rag: form.enable_rag,
          enable_reflection: form.enable_reflection,
        });
        showMsg('success', `Agent "${editTarget}" 更新成功`);
      } else {
        await agentsApi.create({
          name: form.name.trim(),
          provider: form.provider,
          model: form.model,
          skills: finalSkills,
          description: form.description,
          system_prompt: form.system_prompt,
          max_iterations: form.max_iterations,
          enable_planning: form.enable_planning,
          enable_rag: form.enable_rag,
          enable_reflection: form.enable_reflection,
        });
        showMsg('success', `Agent "${form.name.trim()}" 创建成功`);
      }
      resetForm();
      await refresh();
    } catch (e) {
      showMsg('error', `保存失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await agentsApi.delete(name);
      showMsg('success', `Agent "${name}" 已删除`);
      setDeleteConfirm(null);
      await refresh();
    } catch (e) {
      showMsg('error', `删除失败: ${e instanceof Error ? e.message : '未知错误'}`);
    }
  };

  const busyAgents = agents.filter((a) => a.status === 'busy').length;
  const idleAgents = agents.filter((a) => a.status === 'idle').length;

  return (
    <div className="agent-manager">
      {/* 头部 */}
      <div className="am-header">
        <div>
          <h2><AgentIcon /> Agent 管理</h2>
          <span className="am-subtitle">
            {agents.length} 个 Agent · {busyAgents} 忙 / {idleAgents} 空闲
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={refresh}>&#x21bb; 刷新</button>
          <button className="btn btn-primary" onClick={handleCreate}>+ 新建 Agent</button>
        </div>
      </div>

      {/* 状态消息 */}
      {statusMsg && (
        <div className={`am-toast ${statusMsg.type}`}>
          {statusMsg.type === 'success' ? '✅' : '❌'} {statusMsg.text}
        </div>
      )}

      {/* Agent 列表 */}
      {agents.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><AgentIcon /></div>
          <div className="empty-title">暂无 Agent</div>
          <div className="empty-desc">点击「新建 Agent」创建第一个 AI 助手</div>
        </div>
      ) : (
        <div className="am-grid">
          {agents.map((agent) => (
            <AgentCard
              key={agent.name}
              agent={agent}
              onEdit={() => handleEdit(agent.name)}
              onDelete={() => setDeleteConfirm(agent.name)}
            />
          ))}
        </div>
      )}

      {/* 新建 / 编辑弹窗 */}
      {showCreate && (
        <div className="modal-overlay" onClick={resetForm}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <h3>{editTarget ? `✏️ 编辑 Agent: ${editTarget}` : '🆕 新建 Agent'}</h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <div className="form-group">
                <label>Agent 名称 *</label>
                <input
                  className="form-input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="如：代码专家、数据分析师"
                  disabled={!!editTarget}
                />
                {editTarget && <div className="form-help">名称创建后不可修改</div>}
              </div>

              <div className="form-group">
                <label>LLM 提供商</label>
                <select className="form-select" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
                  {ALL_PROVIDERS.map((p) => (
                    <option key={p} value={p}>{providerLabel(p)}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>模型 ID</label>
                <input
                  className="form-input"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  placeholder="如：deepseek-chat、gpt-4"
                />
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>技能配置</label>
                <div className="skill-config">
                  <label className="use-all-toggle">
                    <input
                      type="checkbox"
                      checked={form.useAllSkills}
                      onChange={(e) => setForm({ ...form, useAllSkills: e.target.checked })}
                    />
                    使用全部已安装技能（{installedSkills.length}）
                  </label>
                  {!form.useAllSkills && (
                    <div className="skill-check-list">
                      {installedSkills.length === 0 && (
                        <span className="form-help">暂无已安装技能，可前往「技能市场」安装</span>
                      )}
                      {installedSkills.map((s) => (
                        <label key={s.id} className="skill-check">
                          <input
                            type="checkbox"
                            checked={form.skills.includes(s.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setForm({ ...form, skills: [...form.skills, s.id] });
                              } else {
                                setForm({ ...form, skills: form.skills.filter((x) => x !== s.id) });
                              }
                            }}
                          />
                          {s.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="form-group">
              <label>描述</label>
              <input
                className="form-input"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="简要描述 Agent 的能力和用途"
              />
            </div>

            <div className="form-group">
              <label>System Prompt（自定义系统提示词）</label>
              <textarea
                className="form-textarea"
                rows={4}
                value={form.system_prompt}
                onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
                placeholder="留空则自动生成默认提示词。自定义示例：你是一名资深 Python 后端工程师，擅长 FastAPI 和数据库设计..."
              />
              <div className="form-help">
                已输入 {form.system_prompt.length} 字符 · 上限 5000 · 留空自动生成
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 16px' }}>
              <div className="form-group">
                <label>最大迭代次数</label>
                <input
                  type="number"
                  className="form-input"
                  min={1}
                  max={50}
                  value={form.max_iterations}
                  onChange={(e) => setForm({ ...form, max_iterations: parseInt(e.target.value) || 15 })}
                />
                <div className="form-help">Agent 单次任务的思考轮次上限 (1-50)</div>
              </div>
            </div>

            {/* 功能开关 */}
            <div style={{ marginTop: 4 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                功能开关
              </label>
              <div style={{ display: 'flex', gap: 20, marginTop: 8 }}>
                <ToggleSwitch
                  label="Plan 计划模式"
                  help="执行前先生成多步计划"
                  checked={form.enable_planning}
                  onChange={(v) => setForm({ ...form, enable_planning: v })}
                />
                <ToggleSwitch
                  label="RAG 知识库检索"
                  help="回答时检索上传的文档"
                  checked={form.enable_rag}
                  onChange={(v) => setForm({ ...form, enable_rag: v })}
                />
                <ToggleSwitch
                  label="Reflection 反思模式"
                  help="回答后自我审查并改进"
                  checked={form.enable_reflection}
                  onChange={(v) => setForm({ ...form, enable_reflection: v })}
                />
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn" onClick={resetForm}>取消</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving || !form.name.trim()}>
                {saving ? '保存中...' : editTarget ? '更新 Agent' : '创建 Agent'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认弹窗 */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 380 }}>
            <h3>⚠️ 确认删除</h3>
            <p style={{ color: 'var(--text)', margin: '12px 0', lineHeight: 1.6 }}>
              确定要删除 Agent <strong style={{ color: 'var(--text-bright)' }}>"{deleteConfirm}"</strong> 吗？
              <br />
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>
                此操作将移除该 Agent 的所有配置，正在执行的任务不会中断。
              </span>
            </p>
            <div className="modal-actions" style={{ borderTop: 'none', paddingTop: 0 }}>
              <button className="btn" onClick={() => setDeleteConfirm(null)}>取消</button>
              <button className="btn btn-danger" onClick={() => handleDelete(deleteConfirm)}>确认删除</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .agent-manager { padding: 20px 24px; }
        .am-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; }
        .am-header h2 { font-size: 18px; color: var(--text-bright); display: flex; align-items: center; gap: 8px; }
        .am-subtitle { font-size: 12px; color: var(--muted); margin-top: 4px; display: block; }
        .am-toast { padding: 10px 16px; border-radius: var(--radius); margin-bottom: 16px; font-size: 13px; animation: slideUp 0.3s; }
        .am-toast.success { background: rgba(63,185,80,.12); color: var(--success); border: 1px solid rgba(63,185,80,.3); }
        .am-toast.error { background: rgba(248,81,73,.12); color: var(--error); border: 1px solid rgba(248,81,73,.3); }
        .am-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 16px; }

        .agent-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; transition: all .15s; }
        .agent-card:hover { border-color: var(--primary); box-shadow: 0 2px 12px rgba(88,166,255,.08); }
        .ac-header { padding: 14px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; }
        .ac-name { font-weight: 600; color: var(--text-bright); font-size: 15px; }
        .ac-body { padding: 14px 16px; }
        .ac-field { margin-bottom: 10px; font-size: 12px; }
        .ac-field-label { color: var(--muted); margin-bottom: 2px; }
        .ac-field-value { color: var(--text); line-height: 1.5; }
        .ac-skills { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
        .ac-features { display: flex; gap: 8px; margin-top: 6px; }
        .ac-feature { font-size: 11px; padding: 1px 8px; border-radius: 10px; background: rgba(88,166,255,.1); color: var(--primary); }
        .ac-feature.off { background: rgba(139,148,158,.1); color: var(--muted); }
        .ac-footer { padding: 10px 16px; border-top: 1px solid var(--border); display: flex; gap: 8px; justify-content: flex-end; }
        .ac-task { font-size: 11px; color: var(--primary); margin-left: auto; }
        .ac-task span { color: var(--muted); }

        .toggle-switch { display: flex; flex-direction: column; gap: 4px; }
        .ts-row { display: flex; align-items: center; gap: 10px; }
        .ts-label { font-size: 13px; color: var(--text); }
        .ts-help { font-size: 11px; color: var(--muted); }
        .ts-track { width: 40px; height: 22px; border-radius: 11px; cursor: pointer; transition: all .2s; border: none; position: relative; }
        .ts-track.off { background: var(--border); }
        .ts-track.on { background: var(--primary); }
        .ts-thumb { width: 18px; height: 18px; background: white; border-radius: 50%; position: absolute; top: 2px; transition: all .2s; }
        .ts-track.off .ts-thumb { left: 2px; }
        .ts-track.on .ts-thumb { left: 20px; }

        .empty-state { text-align: center; padding: 80px 20px; }
        .empty-icon svg { width: 48px; height: 48px; color: var(--muted); opacity: .4; margin-bottom: 16px; }
        .empty-title { font-size: 16px; color: var(--text-bright); margin-bottom: 6px; }
        .empty-desc { font-size: 13px; color: var(--muted); }

        .prompt-preview { font-family: 'Cascadia Code', Consolas, monospace; font-size: 12px; line-height: 1.6;
          background: var(--code-bg); border: 1px solid var(--border); border-radius: 6px; padding: 12px;
          max-height: 120px; overflow-y: auto; color: var(--text); white-space: pre-wrap; word-break: break-word; }
        .prompt-preview:empty::after { content: '（使用默认提示词）'; color: var(--muted); font-style: italic; }

        .skill-config { background:var(--code-bg); border:1px solid var(--border); border-radius:8px; padding:12px; }
        .use-all-toggle { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--text); cursor:pointer; margin-bottom:8px; }
        .skill-check-list { display:flex; flex-wrap:wrap; gap:8px; max-height:160px; overflow:auto; }
        .skill-check { display:flex; align-items:center; gap:6px; font-size:12px; background:var(--card); border:1px solid var(--border); border-radius:8px; padding:5px 10px; cursor:pointer; color:var(--text); }
        .skill-check input { accent-color:var(--primary); }
      `}</style>
    </div>
  );
}

// ── Agent 卡片 ──
function AgentCard({ agent, onEdit, onDelete }: { agent: AgentInfo; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="agent-card">
      <div className="ac-header">
        <span className={`status-dot ${agent.status}`} />
        <span className="ac-name">{agent.name}</span>
        <span className={`status-badge ${agent.status}`}>
          {agent.status === 'idle' ? '空闲' : agent.status === 'busy' ? '忙碌' : agent.status}
        </span>
        {agent.current_task_id && (
          <span className="ac-task" title={agent.current_task_id}>
            <span>任务:</span> {agent.current_task_id.slice(0, 8)}...
          </span>
        )}
      </div>

      <div className="ac-body">
        <div className="ac-field">
          <div className="ac-field-label">描述</div>
          <div className="ac-field-value">{agent.description || '暂无描述'}</div>
        </div>

        {agent.skills.length > 0 && (
          <div className="ac-field">
            <div className="ac-field-label">技能</div>
            <div className="ac-skills">
              {agent.skills.map((s) => (
                <span key={s} className="skill-tag">{s}</span>
              ))}
            </div>
          </div>
        )}

        <div className="ac-features">
          <span className={`ac-feature ${agent.enable_planning ? '' : 'off'}`}>
            📋 Plan {agent.enable_planning ? 'ON' : 'OFF'}
          </span>
          <span className={`ac-feature ${agent.enable_rag ? '' : 'off'}`}>
            📚 RAG {agent.enable_rag ? 'ON' : 'OFF'}
          </span>
          <span className={`ac-feature ${agent.enable_reflection ? '' : 'off'}`}>
            🔄 Reflect {agent.enable_reflection ? 'ON' : 'OFF'}
          </span>
        </div>

        <div className="ac-field" style={{ marginTop: 10, marginBottom: 0 }}>
          <div className="ac-field-label">最大迭代 · {agent.max_iterations} 轮</div>
        </div>
      </div>

      <div className="ac-footer">
        <button className="btn btn-sm" onClick={onEdit}>✏️ 编辑</button>
        <button className="btn btn-sm btn-danger" onClick={onDelete}>🗑 删除</button>
      </div>
    </div>
  );
}

// ── 开关 ──
function ToggleSwitch({ label, help, checked, onChange }: {
  label: string; help: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="toggle-switch">
      <div className="ts-row">
        <button className={`ts-track ${checked ? 'on' : 'off'}`} onClick={() => onChange(!checked)} type="button">
          <span className="ts-thumb" />
        </button>
        <span className="ts-label">{label}</span>
      </div>
      <span className="ts-help">{help}</span>
    </div>
  );
}

function providerLabel(p: string): string {
  const m: Record<string, string> = {
    openai: 'OpenAI',
    deepseek: 'DeepSeek',
    zhipu: '智谱 GLM',
    qwen: '通义千问',
    ollama: 'Ollama (本地)',
    custom: '自定义',
  };
  return m[p] || p;
}

function AgentIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a5 5 0 1 0 5 5 5 5 0 0 0-5-5Z" />
      <path d="M4 22a8 8 0 0 1 16 0" />
      <path d="M12 9v3" />
      <path d="M9 12h6" />
    </svg>
  );
}
