import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import {
  Gauge, RefreshCw, Download, ArrowUpDown, Clock, DollarSign,
  CheckCircle2, Cpu, Layers, TrendingUp, Info, ListTodo,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { efficiencyApi, type EfficiencyReport, type EfficiencySummaryRow } from '../api/client'

// 模式中文名（与 TasksPage.modeNames 尽量一致）
const MODE_NAMES: Record<string, string> = {
  auto: 'AI 自动', single: '单 Agent', sequential: '串行执行', parallel: '并行执行',
  debate: '辩论模式', vote: '投票模式', hierarchical: '分层管理', swarm: '群体协作',
  custom: '自定义', workflow: '工作流',
}
const modeLabel = (m: string) => MODE_NAMES[m] || m

// 排行表可排序字段
type SortKey = 'count' | 'success_rate' | 'avg_latency_s' | 'avg_cost_usd' | 'avg_agents' | 'avg_rounds'
const COLUMNS: { key: SortKey; label: string; hint: string }[] = [
  { key: 'count', label: '样本', hint: '测试任务数' },
  { key: 'success_rate', label: '成功率', hint: 'success_rate（越高越好）' },
  { key: 'avg_latency_s', label: '平均延迟(s)', hint: 'avg_latency_s（越低越好）' },
  { key: 'avg_cost_usd', label: '平均成本($)', hint: 'avg_cost_usd（越低越好）' },
  { key: 'avg_agents', label: '平均 Agent 数', hint: 'avg_agents' },
  { key: 'avg_rounds', label: '平均轮次', hint: '协作模式实际轮次（越低越好）' },
]

export default function EfficiencyPage() {
  const navigate = useNavigate()
  const [summary, setSummary] = useState<EfficiencySummaryRow[]>([])
  const [reports, setReports] = useState<EfficiencyReport[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('success_rate')
  const [weighted, setWeighted] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [s, r] = await Promise.all([efficiencyApi.summary(), efficiencyApi.reports(300)])
      setSummary(s)
      setReports(r)
    } catch (e: any) {
      setError(e?.message || '加载失败')
    }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  // 总体 KPI
  const kpi = useMemo(() => {
    const n = reports.length
    if (n === 0) return { n: 0, success: 0, latency: 0, cost: 0 }
    const succ = reports.filter(r => r.success).length
    const lat = reports.reduce((a, r) => a + r.latency_s, 0) / n
    const cost = reports.reduce((a, r) => a + r.cost_usd, 0)
    return { n, success: succ / n, latency: lat, cost }
  }, [reports])

  // 加权综合分（成功率↑、延迟↓、成本↓、轮次↓ 各归一化后等权求和）
  const ranked = useMemo(() => {
    const rows = [...summary]
    if (!weighted) {
      rows.sort((a, b) => {
        const av = a[sortKey], bv = b[sortKey]
        if (av == null && bv == null) return 0
        if (av == null) return 1
        if (bv == null) return -1
        // 成功率/样本：高优；延迟/成本/轮次：低优
        const lowerBetter = sortKey === 'avg_latency_s' || sortKey === 'avg_cost_usd' || sortKey === 'avg_rounds'
        return lowerBetter ? av - bv : bv - av
      })
      return rows
    }
    // 加权：把每个指标归一化到 0..1，方向正确的取高分
    const metric = (k: SortKey) => rows.map(r => r[k]).filter((v): v is number => v != null)
    const norm = (v: number, arr: number[], lowerBetter: boolean) => {
      const min = Math.min(...arr), max = Math.max(...arr)
      if (max === min) return 1
      const t = (v - min) / (max - min)
      return lowerBetter ? 1 - t : t
    }
    const series: Record<SortKey, number[]> = {
      count: metric('count'), success_rate: metric('success_rate'),
      avg_latency_s: metric('avg_latency_s'), avg_cost_usd: metric('avg_cost_usd'),
      avg_agents: metric('avg_agents'), avg_rounds: metric('avg_rounds'),
    }
    return rows
      .map(r => {
        const sScore = norm(r.success_rate, series.success_rate, false)
        const lScore = norm(r.avg_latency_s, series.avg_latency_s, true)
        const cScore = norm(r.avg_cost_usd, series.avg_cost_usd, true)
        const rScore = r.avg_rounds != null ? norm(r.avg_rounds, series.avg_rounds, true) : 0.5
        const score = (sScore + lScore + cScore + rScore) / 4
        return { ...r, _score: score }
      })
      .sort((a, b) => (b as any)._score - (a as any)._score)
  }, [summary, sortKey, weighted])

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ summary, reports }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `efficiency-report-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  const exportCsv = () => {
    const head = ['task_id', 'mode', 'model', 'agents', 'latency_s', 'in_tokens', 'out_tokens', 'cost_usd', 'success', 'rounds', 'created_at']
    const lines = reports.map(r => [r.task_id, r.mode, r.model, r.agents, r.latency_s, r.in_tokens, r.out_tokens, r.cost_usd, r.success, r.rounds ?? '', r.created_at].join(','))
    const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `efficiency-reports-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent">
            <Gauge size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-text-primary">效率测试板</h1>
            <p className="text-xs text-text-dim">速度 / 准确度 / 消耗 + 可靠性 / 协调效率 的多维对比</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-text-muted hover:text-text-primary hover:border-accent/40 disabled:opacity-40 transition-colors">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 刷新
          </button>
          <button onClick={exportJson} disabled={reports.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-text-muted hover:text-text-primary hover:border-accent/40 disabled:opacity-40 transition-colors" title="导出 JSON">
            <Download size={14} /> JSON
          </button>
          <button onClick={exportCsv} disabled={reports.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-text-muted hover:text-text-primary hover:border-accent/40 disabled:opacity-40 transition-colors" title="导出 CSV">
            <Download size={14} /> CSV
          </button>
        </div>
      </div>

      {error && <div className="mb-4 text-sm text-red-500 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}

      {/* 未采集数据时的引导 */}
      {reports.length === 0 && !loading && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-border bg-bg-secondary px-4 py-3 text-sm text-text-muted">
          <Info size={18} className="mt-0.5 text-accent shrink-0" />
          <div>
            暂无效率数据。每次运行「任务」后，系统会自动采集该任务的
            <span className="text-text-primary"> 速度 / 消耗 / 成本 / 协调轮次 </span>
            并归入对应编排模式。去跑几个任务，再回到这里查看对比排行。
            <button onClick={() => navigate('/tasks')}
              className="ml-2 inline-flex items-center gap-1 text-accent hover:underline">
              <ListTodo size={13} /> 去创建任务
            </button>
          </div>
        </div>
      )}

      {/* KPI 卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard icon={<ListTodo size={16} />} label="测试任务数" value={String(kpi.n)} />
        <KpiCard icon={<CheckCircle2 size={16} />} label="整体成功率" value={`${(kpi.success * 100).toFixed(1)}%`} accent={kpi.success >= 0.9} />
        <KpiCard icon={<Clock size={16} />} label="平均延迟" value={`${kpi.latency.toFixed(1)}s`} />
        <KpiCard icon={<DollarSign size={16} />} label="累计成本" value={`$${kpi.cost.toFixed(3)}`} />
      </div>

      {/* 模式排行 / 对比表 */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-text-primary flex items-center gap-2">
            <TrendingUp size={16} className="text-accent" /> 模式排行 / 对比表
          </h2>
          <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer select-none">
            <input type="checkbox" checked={weighted} onChange={e => setWeighted(e.target.checked)}
              className="accent-[var(--accent)]" />
            加权综合排行（成功率↓延迟↓成本↓轮次↓）
          </label>
        </div>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-bg-secondary text-text-muted">
              <tr>
                <th className="text-left px-3 py-2 font-medium">#</th>
                <th className="text-left px-3 py-2 font-medium">编排模式</th>
                {COLUMNS.map(c => (
                  <th key={c.key} className="px-3 py-2 font-medium text-right">
                    <button
                      onClick={() => { setWeighted(false); setSortKey(c.key) }}
                      title={c.hint}
                      className={`inline-flex items-center gap-1 hover:text-text-primary ${!weighted && sortKey === c.key ? 'text-accent' : ''}`}>
                      {c.label} <ArrowUpDown size={12} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ranked.length === 0 && (
                <tr><td colSpan={COLUMNS.length + 2} className="px-3 py-6 text-center text-text-dim">暂无数据</td></tr>
              )}
              {ranked.map((r, i) => {
                const score = (r as any)._score as number | undefined
                return (
                  <tr key={r.mode} className="border-t border-border hover:bg-bg-secondary/50">
                    <td className="px-3 py-2 text-text-dim">{i + 1}</td>
                    <td className="px-3 py-2 text-text-primary font-medium">{modeLabel(r.mode)}</td>
                    <td className="px-3 py-2 text-right text-text-secondary">{r.count}</td>
                    <td className="px-3 py-2 text-right text-text-secondary">{(r.success_rate * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right text-text-secondary">{r.avg_latency_s.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right text-text-secondary">${r.avg_cost_usd.toFixed(4)}</td>
                    <td className="px-3 py-2 text-right text-text-secondary">
                      <span className="inline-flex items-center gap-1"><Cpu size={12} />{r.avg_agents}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-text-secondary">
                      {r.avg_rounds != null ? (
                        <span className="inline-flex items-center gap-1"><Layers size={12} />{r.avg_rounds}</span>
                      ) : <span className="text-text-dim">—</span>}
                    </td>
                    {weighted && score != null && (
                      <td className="px-3 py-2 text-right text-accent font-medium">{(score * 100).toFixed(0)}</td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {weighted && (
          <p className="mt-1 text-[11px] text-text-dim">加权分 = (成功率 + 低延迟 + 低成本 + 低轮次) 各归一等权平均，满分为 100。括号内指标越优得分越高。</p>
        )}
      </section>

      {/* 最近任务报告 */}
      <section>
        <h2 className="text-base font-semibold text-text-primary mb-3 flex items-center gap-2">
          <Clock size={16} className="text-accent" /> 最近任务报告
        </h2>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-bg-secondary text-text-muted">
              <tr>
                <th className="text-left px-3 py-2 font-medium">任务</th>
                <th className="text-left px-3 py-2 font-medium">模式</th>
                <th className="text-left px-3 py-2 font-medium">模型</th>
                <th className="text-right px-3 py-2 font-medium">Agent</th>
                <th className="text-right px-3 py-2 font-medium">延迟(s)</th>
                <th className="text-right px-3 py-2 font-medium">In/Out tok</th>
                <th className="text-right px-3 py-2 font-medium">成本($)</th>
                <th className="text-center px-3 py-2 font-medium">成功</th>
                <th className="text-right px-3 py-2 font-medium">轮次</th>
                <th className="text-left px-3 py-2 font-medium">时间</th>
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-6 text-center text-text-dim">暂无报告</td></tr>
              )}
              {reports.slice(0, 80).map(r => (
                <tr key={r.task_id} className="border-t border-border hover:bg-bg-secondary/50">
                  <td className="px-3 py-2 text-text-secondary font-mono text-xs truncate max-w-[120px]" title={r.task_id}>{r.task_id.slice(0, 8)}</td>
                  <td className="px-3 py-2 text-text-primary">{modeLabel(r.mode)}</td>
                  <td className="px-3 py-2 text-text-secondary text-xs truncate max-w-[120px]" title={r.model}>{r.model}</td>
                  <td className="px-3 py-2 text-right text-text-secondary">{r.agents}</td>
                  <td className="px-3 py-2 text-right text-text-secondary">{r.latency_s.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right text-text-secondary text-xs">{r.in_tokens}/{r.out_tokens}</td>
                  <td className="px-3 py-2 text-right text-text-secondary">${r.cost_usd.toFixed(4)}</td>
                  <td className="px-3 py-2 text-center">{r.success
                    ? <CheckCircle2 size={15} className="text-green-500 mx-auto" />
                    : <span className="text-red-500 text-xs">✗</span>}</td>
                  <td className="px-3 py-2 text-right text-text-secondary">{r.rounds ?? '—'}</td>
                  <td className="px-3 py-2 text-text-dim text-xs">{r.created_at?.replace('T', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {reports.length > 80 && <p className="mt-1 text-[11px] text-text-dim">仅显示最近 80 条，导出可获取全部 {reports.length} 条。</p>}
      </section>
    </div>
  )
}

function KpiCard({ icon, label, value, accent }: { icon: ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-bg-secondary px-4 py-3">
      <div className="flex items-center gap-2 text-text-dim text-xs mb-1">
        {icon} {label}
      </div>
      <div className={`text-lg font-semibold ${accent ? 'text-green-500' : 'text-text-primary'}`}>{value}</div>
    </div>
  )
}
