// AI Hubs — 设置页（LLM 配置 + 界面偏好）

import { useEffect, useState, useCallback } from 'react'
import { llmApi } from '../api/chat'
import { useThemeStore, type ThemeMode, type FontSize } from '../stores/themeStore'
import { onAIMutation } from '../stores/chatStore'
import { Loader2, Check, AlertCircle, Sun, Moon, Monitor, Type } from 'lucide-react'

interface ProviderInfo {
  name: string
  base_url: string
  models: string[]
}

export default function SettingsPage() {
  const [providers, setProviders] = useState<Record<string, ProviderInfo>>({})
  const [config, setConfig] = useState({
    provider: 'deepseek',
    model: '',
    api_key: '',
    base_url: '',
    temperature: 0.7,
    max_tokens: 4096,
  })
  const [originalKey, setOriginalKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const loadConfig = useCallback(() => {
    Promise.all([llmApi.getProviders(), llmApi.getConfig()]).then(([pRes, cRes]) => {
      setProviders(pRes.providers || {})
      if (cRes.config) {
        setConfig({
          provider: cRes.config.provider || 'deepseek',
          model: cRes.config.model || '',
          api_key: cRes.config.api_key || '',
          base_url: cRes.config.base_url || '',
          temperature: cRes.config.temperature ?? 0.7,
          max_tokens: cRes.config.max_tokens ?? 4096,
        })
        setOriginalKey(cRes.config.api_key || '')
      }
    })
  }, [])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // 监听 AI 触发的资源变更 → 重新拉取 LLM 配置
  useEffect(() => {
    return onAIMutation((detail) => {
      if (detail.resource === 'llm-config') loadConfig()
    })
  }, [loadConfig])

  const handleProviderChange = (provider: string) => {
    const preset = providers[provider]
    setConfig({
      ...config,
      provider,
      base_url: preset?.base_url || '',
      model: preset?.models?.[0] || '',
    })
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      // 如果 API Key 是脱敏的（含 *），则使用原始 key
      const apiKey = config.api_key.includes('*') ? originalKey : config.api_key
      await llmApi.updateConfig({
        provider: config.provider,
        model: config.model,
        api_key: apiKey,
        base_url: config.base_url,
        temperature: config.temperature,
        max_tokens: config.max_tokens,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const currentProvider = providers[config.provider]

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold text-text-primary mb-1">设置</h1>
      <p className="text-sm text-text-muted mb-6">配置 LLM 模型和应用偏好</p>

      {/* LLM 配置 */}
      <div className="card p-5 mb-4">
        <h2 className="text-sm font-medium text-text-primary mb-2">个人 LLM 配置</h2>
        <p className="text-xs text-text-muted mb-4 leading-relaxed">
          在此填写你自己的 API Key 后，对话将使用<strong className="text-text-secondary">你自己的额度</strong>（不受平台 token 限制）。
          若留空，将使用平台提供的免费额度（受 token 配额限制，用尽后请填写自己的 Key）。
        </p>

        <div className="space-y-4">
          {/* 提供商 */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5">提供商</label>
            <select
              value={config.provider}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="input"
            >
              {Object.entries(providers).map(([key, p]) => (
                <option key={key} value={key}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* 模型 */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5">模型</label>
            {currentProvider?.models?.length ? (
              <select
                value={config.model}
                onChange={(e) => setConfig({ ...config, model: e.target.value })}
                className="input"
              >
                {currentProvider.models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
                {!currentProvider.models.includes(config.model) && config.model && (
                  <option value={config.model}>{config.model}</option>
                )}
              </select>
            ) : (
              <input
                className="input"
                value={config.model}
                onChange={(e) => setConfig({ ...config, model: e.target.value })}
                placeholder="输入模型名称"
              />
            )}
          </div>

          {/* API Key */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5">API Key</label>
            <input
              type="password"
              className="input"
              value={config.api_key}
              onChange={(e) => setConfig({ ...config, api_key: e.target.value })}
              placeholder="sk-..."
            />
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5">API 地址 (Base URL)</label>
            <input
              className="input"
              value={config.base_url}
              onChange={(e) => setConfig({ ...config, base_url: e.target.value })}
              placeholder="https://api.example.com/v1"
            />
          </div>

          {/* Temperature */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5">
              温度 (Temperature): {config.temperature.toFixed(1)}
            </label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={config.temperature}
              onChange={(e) => setConfig({ ...config, temperature: parseFloat(e.target.value) })}
              className="w-full accent-accent"
            />
          </div>

          {/* Max Tokens */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5">最大 Token 数</label>
            <input
              type="number"
              className="input"
              value={config.max_tokens}
              onChange={(e) => setConfig({ ...config, max_tokens: parseInt(e.target.value) || 4096 })}
              min="1"
              max="32768"
            />
          </div>

          {/* 错误/成功提示 */}
          {error && (
            <div className="px-3 py-2 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center gap-2">
              <AlertCircle size={14} /> {error}
            </div>
          )}
          {saved && (
            <div className="px-3 py-2 rounded-md bg-green-500/10 border border-green-500/30 text-green-400 text-sm flex items-center gap-2">
              <Check size={14} /> 配置已保存
            </div>
          )}

          {/* 保存按钮 */}
          <button onClick={handleSave} disabled={saving} className="btn-primary w-full">
            {saving ? <Loader2 size={16} className="animate-spin mx-auto" /> : '保存配置'}
          </button>
        </div>
      </div>

      {/* 界面偏好 */}
      <div className="card p-5">
        <h2 className="text-sm font-medium text-text-primary mb-4">界面偏好</h2>

        {/* 主题模式 */}
        <ThemeSelector />

        {/* 分隔 */}
        <div className="my-5 border-t border-border" />

        {/* 字号 */}
        <FontSizeSelector />
      </div>
    </div>
  )
}

// ── 主题模式选择器 ──

const themeOptions: { mode: ThemeMode; label: string; icon: typeof Sun; description: string }[] = [
  { mode: 'dark', label: '暗色', icon: Moon, description: '深色背景，护眼舒适' },
  { mode: 'light', label: '亮色', icon: Sun, description: '浅色背景，清晰明亮' },
  { mode: 'system', label: '跟随系统', icon: Monitor, description: '自动匹配系统外观设置' },
]

function ThemeSelector() {
  const mode = useThemeStore((s) => s.mode)
  const setMode = useThemeStore((s) => s.setMode)

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-text-muted mb-3">
        <Sun size={13} />
        <span>主题模式</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {themeOptions.map((opt) => (
          <button
            key={opt.mode}
            onClick={() => setMode(opt.mode)}
            className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg border text-xs transition-all ${
              mode === opt.mode
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border text-text-muted hover:border-text-dim hover:text-text-secondary'
            }`}
          >
            <opt.icon size={18} />
            <span className="font-medium">{opt.label}</span>
            <span className="text-[10px] text-text-dim leading-tight text-center">
              {opt.description}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── 字号选择器 ──

const fontSizeOptions: { size: FontSize; label: string; sample: string }[] = [
  { size: 'sm', label: '小', sample: '紧凑视图' },
  { size: 'md', label: '中', sample: '默认大小' },
  { size: 'lg', label: '大', sample: '舒适阅读' },
  { size: 'xl', label: '特大', sample: '大字模式' },
]

function FontSizeSelector() {
  const fontSize = useThemeStore((s) => s.fontSize)
  const setFontSize = useThemeStore((s) => s.setFontSize)

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-text-muted mb-3">
        <Type size={13} />
        <span>字号大小</span>
        <span className="ml-auto text-text-dim">当前: {fontSizeOptions.find(o => o.size === fontSize)?.label}</span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {fontSizeOptions.map((opt) => (
          <button
            key={opt.size}
            onClick={() => setFontSize(opt.size)}
            className={`flex flex-col items-center gap-1 px-3 py-3 rounded-lg border text-xs transition-all ${
              fontSize === opt.size
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border text-text-muted hover:border-text-dim hover:text-text-secondary'
            }`}
          >
            <span className={`font-medium ${
              opt.size === 'sm' ? 'text-[11px]' :
              opt.size === 'md' ? 'text-sm' :
              opt.size === 'lg' ? 'text-base' :
              'text-lg'
            }`}>
              Aa
            </span>
            <span>{opt.label}</span>
            <span className="text-[10px] text-text-dim">{opt.sample}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
