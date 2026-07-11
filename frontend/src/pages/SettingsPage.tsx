// AI Hubs — 设置页（LLM 配置）

import { useEffect, useState } from 'react'
import { llmApi } from '../api/chat'
import { Loader2, Check, AlertCircle } from 'lucide-react'

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

  useEffect(() => {
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
      <h1 className="text-xl font-semibold text-neutral-100 mb-1">设置</h1>
      <p className="text-sm text-neutral-500 mb-6">配置 LLM 模型和应用偏好</p>

      {/* LLM 配置 */}
      <div className="card p-5 mb-4">
        <h2 className="text-sm font-medium text-neutral-200 mb-2">个人 LLM 配置</h2>
        <p className="text-xs text-neutral-500 mb-4 leading-relaxed">
          在此填写你自己的 API Key 后，对话将使用<strong className="text-neutral-300">你自己的额度</strong>（不受平台 token 限制）。
          若留空，将使用平台提供的免费额度（受 token 配额限制，用尽后请填写自己的 Key）。
        </p>

        <div className="space-y-4">
          {/* 提供商 */}
          <div>
            <label className="block text-xs text-neutral-500 mb-1.5">提供商</label>
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
            <label className="block text-xs text-neutral-500 mb-1.5">模型</label>
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
            <label className="block text-xs text-neutral-500 mb-1.5">API Key</label>
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
            <label className="block text-xs text-neutral-500 mb-1.5">API 地址 (Base URL)</label>
            <input
              className="input"
              value={config.base_url}
              onChange={(e) => setConfig({ ...config, base_url: e.target.value })}
              placeholder="https://api.example.com/v1"
            />
          </div>

          {/* Temperature */}
          <div>
            <label className="block text-xs text-neutral-500 mb-1.5">
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
            <label className="block text-xs text-neutral-500 mb-1.5">最大 Token 数</label>
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

      {/* 界面偏好（占位） */}
      <div className="card p-5">
        <h2 className="text-sm font-medium text-neutral-200 mb-4">界面偏好</h2>
        <p className="text-xs text-neutral-600">主题切换、字体大小等功能将在后续版本实现</p>
      </div>
    </div>
  )
}
