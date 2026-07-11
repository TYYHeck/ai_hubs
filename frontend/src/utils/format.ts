/**
 * 格式化大数字为可读字符串。
 *
 * 规则：
 *   < 10000        → 精确数字 + 千位分隔（如 "100"、"1,000"、"9,999"）
 *   10000 - 999949 → X.Xk（如 "10k"、"100.5k"、"999.9k"）
 *   >= 1000000     → X.XM（如 "1M"、"2.5M"）
 *
 * 小数部分为 0 时不显示（如 10000 → "10k"，而非 "10.0k"）。
 */
export function formatNumber(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n < 0) return `-${formatNumber(-n)}`

  if (n < 10_000) return n.toLocaleString('en-US')

  if (n < 1_000_000) {
    const v = n / 1_000
    // 保留 1 位小数，去掉尾随的 .0
    const s = v.toFixed(1)
    return s.endsWith('.0') ? `${Math.round(v)}k` : `${s}k`
  }

  const v = n / 1_000_000
  const s = v.toFixed(1)
  return s.endsWith('.0') ? `${Math.round(v)}M` : `${s}M`
}
