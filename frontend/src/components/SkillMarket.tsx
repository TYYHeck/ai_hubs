import { useState, useEffect, useCallback } from 'react';
import { skillsApi } from '../api/client';
import type { SkillInfo } from '../types';

const CATEGORY_NAMES: Record<string, string> = {
  coding: '编程开发',
  research: '调研分析',
  writing: '文档写作',
  data: '数据处理',
  design: '设计创意',
  devops: '运维部署',
  general: '通用助手',
};

const CATEGORY_COLORS: Record<string, string> = {
  coding: 'var(--primary)',
  research: 'var(--purple)',
  writing: 'var(--teal)',
  data: 'var(--orange)',
  design: 'var(--pink)',
  devops: 'var(--warn)',
  general: 'var(--muted)',
};

type SubTab = 'installed' | 'github' | 'create';

export default function SkillMarket() {
  const [subTab, setSubTab] = useState<SubTab>('installed');
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string; count: number }[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // GitHub search
  const [searchQ, setSearchQ] = useState('');
  const [searchCat, setSearchCat] = useState('');
  const [searching, setSearching] = useState(false);
  const [ghResults, setGhResults] = useState<SkillInfo[]>([]);

  // Create form
  const [createForm, setCreateForm] = useState({
    id: '',
    name: '',
    description: '',
    category: 'general',
    prompt_template: '',
    tags: '',
  });

  // ── 加载已安装技能 ──
  const loadInstalled = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await skillsApi.list(categoryFilter, false);
      setSkills(res.skills || []);
      setCategories(res.categories || []);
    } catch {
      setError('加载技能列表失败');
    } finally {
      setLoading(false);
    }
  }, [categoryFilter]);

  useEffect(() => {
    if (subTab === 'installed') loadInstalled();
  }, [subTab, loadInstalled]);

  // ── GitHub 搜索 ──
  const doSearch = async () => {
    setSearching(true);
    setError('');
    try {
      const res = await skillsApi.searchGitHub(searchQ, searchCat, 1);
      setGhResults(res.skills || []);
    } catch {
      setError('GitHub 搜索失败，请稍后重试');
    } finally {
      setSearching(false);
    }
  };

  // ── 操作 ──
  const handleInstall = async (skillId: string) => {
    try {
      const res = await skillsApi.install(skillId);
      if (res.ok) {
        setSkills((prev) => prev.map((s) => (s.id === skillId ? { ...s, installed: true } : s)));
        setGhResults((prev) => prev.map((s) => (s.id === skillId ? { ...s, installed: true } : s)));
      }
    } catch { setError('安装失败'); }
  };

  const handleUninstall = async (skillId: string) => {
    try {
      const res = await skillsApi.uninstall(skillId);
      if (res.ok) {
        setSkills((prev) => prev.map((s) => (s.id === skillId ? { ...s, installed: false } : s)));
      }
    } catch { setError('卸载失败'); }
  };

  const handleDelete = async (skillId: string) => {
    if (!confirm('确定删除该技能？')) return;
    try {
      await skillsApi.delete(skillId);
      setSkills((prev) => prev.filter((s) => s.id !== skillId));
    } catch { setError('删除失败'); }
  };

  const handleImportFromGH = async (skill: SkillInfo) => {
    try {
      const res = await skillsApi.importFromGitHub(skill as unknown as Record<string, unknown>);
      if (res.ok) {
        setSkills((prev) => {
          const exists = prev.find((s) => s.id === skill.id);
          if (exists) return prev.map((s) => (s.id === skill.id ? { ...s, installed: true } : s));
          return [...prev, res.skill];
        });
        setGhResults((prev) => prev.map((s) => (s.id === skill.id ? { ...s, installed: true } : s)));
      }
    } catch { setError('导入失败'); }
  };

  const handleCreate = async () => {
    const { id, name, description, category, prompt_template, tags } = createForm;
    if (!id.trim() || !name.trim()) {
      setError('技能 ID 和名称不能为空');
      return;
    }
    setError('');
    try {
      const res = await skillsApi.create({
        id: id.trim(),
        name: name.trim(),
        description,
        category,
        prompt_template,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      if (res.ok) {
        setSkills((prev) => [...prev, res.skill]);
        setSubTab('installed');
        setCreateForm({ id: '', name: '', description: '', category: 'general', prompt_template: '', tags: '' });
      }
    } catch { setError('创建失败'); }
  };

  // ── 渲染 ──

  const renderSkillCard = (skill: SkillInfo, isGH = false) => (
    <div key={skill.id} className={`skill-card${skill.installed ? '' : ' uninstalled'}`}>
      <div className="skill-card-header">
        <span className="skill-name">{skill.name}</span>
        <span
          className="skill-cat-badge"
          style={{ background: CATEGORY_COLORS[skill.category] || 'var(--muted)' }}
        >
          {CATEGORY_NAMES[skill.category] || skill.category}
        </span>
      </div>
      <p className="skill-desc">{skill.description || '暂无描述'}</p>
      {skill.tags.length > 0 && (
        <div className="skill-tags">
          {skill.tags.map((t) => (
            <span key={t} className="skill-tag">{t}</span>
          ))}
        </div>
      )}
      <div className="skill-meta">
        <span className="skill-source">{skill.source === 'builtin' ? '内置' : skill.source === 'github' ? 'GitHub' : '自定义'}</span>
        <span className="skill-version">v{skill.version}</span>
        {skill.author && <span className="skill-author">@{skill.author}</span>}
      </div>
      <div className="skill-actions">
        {isGH ? (
          skill.installed ? (
            <span className="skill-installed-label">✓ 已安装</span>
          ) : (
            <>
              <button className="btn btn-primary btn-sm" onClick={() => handleImportFromGH(skill)}>
                导入并安装
              </button>
            </>
          )
        ) : (
          <>
            {skill.source !== 'builtin' && !skill.installed && (
              <button className="btn btn-sm" onClick={() => handleInstall(skill.id)}>安装</button>
            )}
            {skill.installed && skill.source !== 'builtin' && (
              <button className="btn btn-sm" onClick={() => handleUninstall(skill.id)}>卸载</button>
            )}
            {skill.source === 'user' && (
              <button className="btn btn-sm btn-danger" style={{ marginLeft: 4 }} onClick={() => handleDelete(skill.id)}>
                删除
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="skill-market">
      <div className="skill-market-header">
        <h2>🎯 技能市场</h2>
        <p>浏览、安装和管理 AI 技能，扩展 Agent 的专业能力</p>
      </div>

      {/* Tabs */}
      <div className="skill-tabs">
        <button
          className={`skill-tab${subTab === 'installed' ? ' active' : ''}`}
          onClick={() => setSubTab('installed')}
        >
          已安装 ({skills.filter((s) => s.installed).length})
        </button>
        <button
          className={`skill-tab${subTab === 'github' ? ' active' : ''}`}
          onClick={() => setSubTab('github')}
        >
          GitHub 探索
        </button>
        <button
          className={`skill-tab${subTab === 'create' ? ' active' : ''}`}
          onClick={() => setSubTab('create')}
        >
          自定义创建
        </button>
      </div>

      {error && (
        <div className="skill-error" onClick={() => setError('')}>
          {error} <span style={{ cursor: 'pointer', marginLeft: 8 }}>✕</span>
        </div>
      )}

      {/* ── 已安装 ── */}
      {subTab === 'installed' && (
        <div className="skill-content">
          {/* 分类过滤 */}
          {categories.length > 0 && (
            <div className="skill-cat-filter">
              <button
                className={`skill-cat-btn${!categoryFilter ? ' active' : ''}`}
                onClick={() => setCategoryFilter('')}
              >
                全部
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  className={`skill-cat-btn${categoryFilter === cat.id ? ' active' : ''}`}
                  onClick={() => setCategoryFilter(cat.id)}
                  style={categoryFilter === cat.id ? { borderColor: CATEGORY_COLORS[cat.id] || 'var(--primary)', color: CATEGORY_COLORS[cat.id] || 'var(--primary)' } : {}}
                >
                  {cat.name} ({cat.count})
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <div className="skill-loading"><span className="spinner" /> 加载中...</div>
          ) : skills.length === 0 ? (
            <div className="skill-empty">暂无技能，去 GitHub 探索或创建自定义技能吧</div>
          ) : (
            <div className="skill-grid">
              {skills.map((s) => renderSkillCard(s))}
            </div>
          )}
        </div>
      )}

      {/* ── GitHub 探索 ── */}
      {subTab === 'github' && (
        <div className="skill-content">
          <div className="gh-search-bar">
            <input
              className="form-input"
              placeholder="搜索 GitHub 技能仓库..."
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doSearch()}
              style={{ flex: 1 }}
            />
            <select
              className="form-select"
              value={searchCat}
              onChange={(e) => setSearchCat(e.target.value)}
              style={{ width: 140 }}
            >
              <option value="">全部分类</option>
              {Object.entries(CATEGORY_NAMES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <button className="btn btn-primary" onClick={doSearch} disabled={searching}>
              {searching ? '搜索中...' : '搜索'}
            </button>
          </div>

          {searching && <div className="skill-loading"><span className="spinner" /> 正在 GitHub 搜索...</div>}

          {!searching && ghResults.length > 0 && (
            <div className="skill-grid">
              {ghResults.map((s) => renderSkillCard(s, true))}
            </div>
          )}

          {!searching && ghResults.length === 0 && searchQ && (
            <div className="skill-empty">未找到匹配的技能，尝试其他关键词</div>
          )}

          {!searching && ghResults.length === 0 && !searchQ && (
            <div className="skill-empty">输入关键词搜索 GitHub 上的 AI 技能仓库</div>
          )}
        </div>
      )}

      {/* ── 自定义创建 ── */}
      {subTab === 'create' && (
        <div className="skill-content">
          <div className="card" style={{ maxWidth: 600 }}>
            <div className="card-header">创建自定义技能</div>
            <div className="form-group">
              <label>技能 ID</label>
              <input
                className="form-input"
                placeholder="如: my_excel_helper"
                value={createForm.id}
                onChange={(e) => setCreateForm((f) => ({ ...f, id: e.target.value }))}
              />
              <div className="form-help">唯一标识，仅字母数字和下划线</div>
            </div>
            <div className="form-group">
              <label>技能名称</label>
              <input
                className="form-input"
                placeholder="如: Excel 助手"
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label>分类</label>
              <select
                className="form-select"
                value={createForm.category}
                onChange={(e) => setCreateForm((f) => ({ ...f, category: e.target.value }))}
              >
                {Object.entries(CATEGORY_NAMES).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>描述</label>
              <textarea
                className="form-textarea"
                placeholder="简要描述技能的功能..."
                value={createForm.description}
                onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
              />
            </div>
            <div className="form-group">
              <label>提示词模板</label>
              <textarea
                className="form-textarea"
                placeholder="注入 Agent 的系统提示词..."
                value={createForm.prompt_template}
                onChange={(e) => setCreateForm((f) => ({ ...f, prompt_template: e.target.value }))}
                rows={4}
              />
              <div className="form-help">定义该技能下 Agent 的思维方式和专业领域</div>
            </div>
            <div className="form-group">
              <label>标签</label>
              <input
                className="form-input"
                placeholder="逗号分隔，如: Excel, 数据分析, 表格"
                value={createForm.tags}
                onChange={(e) => setCreateForm((f) => ({ ...f, tags: e.target.value }))}
              />
            </div>
            <div className="modal-actions" style={{ marginTop: 16, paddingTop: 16 }}>
              <button className="btn" onClick={() => setSubTab('installed')}>取消</button>
              <button className="btn btn-primary" onClick={handleCreate}>创建技能</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
