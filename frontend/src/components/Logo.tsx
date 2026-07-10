// AI Hubs Logo — 简约现代风格
export default function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      {/* 外环 — 中枢 HUB */}
      <circle
        cx="24" cy="24" r="20"
        stroke="var(--primary)"
        strokeWidth="2.5"
        fill="none"
        opacity="0.8"
      />
      <circle
        cx="24" cy="24" r="14"
        stroke="var(--primary)"
        strokeWidth="1.5"
        fill="none"
        opacity="0.4"
      />
      {/* 中心节点 */}
      <circle cx="24" cy="24" r="5" fill="var(--primary)" opacity="0.9" />
      {/* 辐射线条 — 连接各 Agent */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
        const rad = (angle * Math.PI) / 180;
        const x1 = 24 + 8 * Math.cos(rad);
        const y1 = 24 + 8 * Math.sin(rad);
        const x2 = 24 + 17 * Math.cos(rad);
        const y2 = 24 + 17 * Math.sin(rad);
        return (
          <line
            key={angle}
            x1={x1} y1={y1} x2={x2} y2={y2}
            stroke="var(--primary)"
            strokeWidth="1.2"
            opacity="0.35"
          />
        );
      })}
      {/* 外环节点 */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
        const rad = (angle * Math.PI) / 180;
        const cx = 24 + 17 * Math.cos(rad);
        const cy = 24 + 17 * Math.sin(rad);
        return (
          <circle key={angle} cx={cx} cy={cy} r="2.5" fill="var(--primary)" opacity="0.6" />
        );
      })}
    </svg>
  );
}

// 文字 Logo — 用于 Footer 或标题
export function LogoText({ size = 'medium' }: { size?: 'small' | 'medium' | 'large' }) {
  const sizes = { small: 14, medium: 18, large: 28 };
  const fontSize = sizes[size] || 18;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, userSelect: 'none' }}>
      <Logo size={fontSize + 16} />
      <div>
        <div style={{
          fontSize,
          fontWeight: 700,
          color: 'var(--text-bright)',
          letterSpacing: '-0.5px',
          lineHeight: 1.2,
        }}>
          AI <span style={{ color: 'var(--primary)' }}>Hubs</span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>
          智能 Agent 平台
        </div>
      </div>
    </div>
  );
}
