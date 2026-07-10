import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import { orchestrateStream } from '../api/client';
import type { OrchestrationProgress } from '../types';

// ============================================================
// 可视化工作流编排器
// 纯 CSS + Canvas 实现的 DAG 拖拽编排画布
// 因为轻量化不引入 reactflow，用自绘 Canvas 实现
// ============================================================

// --- 类型定义 ---
type StageNode = {
  id: string;
  label: string;
  x: number;
  y: number;
  role: string;       // 该阶段在流水线中的角色
  agentName: string;
};

type Edge = {
  from: string;
  to: string;
  label: string;
};

type WorkflowDef = {
  name: string;
  mode: 'single' | 'parallel' | 'pipeline' | 'collaborative' | 'debate' | 'peer_review' | 'round_table' | 'hierarchical';
  description: string;
  nodes: StageNode[];
  edges: Edge[];
};

// --- 内置模板 ---
const TEMPLATES: WorkflowDef[] = [
  {
    name: '代码审查流水线',
    mode: 'pipeline',
    description: '编码 → 审查 → 测试 → 部署',
    nodes: [
      { id: 'n1', label: '代码编写', x: 80, y: 200, role: '编码', agentName: '' },
      { id: 'n2', label: '代码审查', x: 300, y: 200, role: '审查', agentName: '' },
      { id: 'n3', label: '测试验证', x: 520, y: 200, role: '测试', agentName: '' },
      { id: 'n4', label: '生成报告', x: 740, y: 200, role: '输出', agentName: '' },
    ],
    edges: [
      { from: 'n1', to: 'n2', label: '代码' },
      { from: 'n2', to: 'n3', label: '审查通过' },
      { from: 'n3', to: 'n4', label: '测试结果' },
    ],
  },
  {
    name: '多角度研究',
    mode: 'parallel',
    description: '技术调研 + 市场分析 + 竞品对比 → 综合报告',
    nodes: [
      { id: 'n1', label: '技术调研', x: 80, y: 120, role: '技术分析', agentName: '' },
      { id: 'n2', label: '市场分析', x: 80, y: 280, role: '市场研究', agentName: '' },
      { id: 'n3', label: '竞品对比', x: 80, y: 440, role: '竞品分析', agentName: '' },
      { id: 'n4', label: '综合报告', x: 500, y: 280, role: '汇总', agentName: '' },
    ],
    edges: [
      { from: 'n1', to: 'n4', label: '技术维' },
      { from: 'n2', to: 'n4', label: '市场维' },
      { from: 'n3', to: 'n4', label: '竞品维' },
    ],
  },
  {
    name: '辩论决策',
    mode: 'debate',
    description: '正方观点 vs 反方观点 → 投票裁决',
    nodes: [
      { id: 'n1', label: '正方辩论', x: 80, y: 150, role: '正方', agentName: '' },
      { id: 'n2', label: '反方辩论', x: 80, y: 350, role: '反方', agentName: '' },
      { id: 'n3', label: '投票裁决', x: 500, y: 250, role: '主持人', agentName: '' },
    ],
    edges: [
      { from: 'n1', to: 'n3', label: '论点' },
      { from: 'n2', to: 'n3', label: '反驳' },
    ],
  },
  {
    name: '同行评审',
    mode: 'peer_review',
    description: '执行工作 → 多人评审 → 修改确认',
    nodes: [
      { id: 'n1', label: '执行任务', x: 80, y: 220, role: '执行者', agentName: '' },
      { id: 'n2', label: '评审A', x: 320, y: 120, role: '评审', agentName: '' },
      { id: 'n3', label: '评审B', x: 320, y: 320, role: '评审', agentName: '' },
      { id: 'n4', label: '修改确认', x: 560, y: 220, role: '确认', agentName: '' },
    ],
    edges: [
      { from: 'n1', to: 'n2', label: '成果' },
      { from: 'n1', to: 'n3', label: '成果' },
      { from: 'n2', to: 'n4', label: '反馈' },
      { from: 'n3', to: 'n4', label: '反馈' },
    ],
  },
];

const BOX_W = 140;
const BOX_H = 56;

// 计算贝塞尔曲线控制点
function bezierEdge(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.abs(x2 - x1) * 0.5;
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}

// 计算箭头
function arrowHead(x2: number, y2: number, x1: number, y1: number): [number, number, number, number, number, number] {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = 10;
  const ax1 = x2 - size * Math.cos(angle - Math.PI / 6);
  const ay1 = y2 - size * Math.sin(angle - Math.PI / 6);
  const ax2 = x2 - size * Math.cos(angle + Math.PI / 6);
  const ay2 = y2 - size * Math.sin(angle + Math.PI / 6);
  return [x2, y2, ax1, ay1, ax2, ay2];
}

// --- 节点色相 ---
const ROLE_COLORS: Record<string, string> = {
  '编码': '#4ec9b0', '审查': '#569cd6', '测试': '#dcdcaa', '输出': '#ce9178', '汇总': '#ce9178',
  '技术分析': '#4ec9b0', '市场研究': '#569cd6', '竞品分析': '#c586c0',
  '正方': '#4ec9b0', '反方': '#f14c4c', '主持人': '#dcdcaa',
  '执行者': '#4ec9b0', '评审': '#569cd6', '确认': '#ce9178',
};

// ============================================================
// 主组件
// ============================================================
export default function WorkflowEditor() {
  const agents = useAppStore((s) => s.agents);
  const [workflow, setWorkflow] = useState<WorkflowDef>(TEMPLATES[0]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [description, setDescription] = useState('');
  const [result, setResult] = useState('');
  const [running, setRunning] = useState(false);
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // --- 画布绘制 ---
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;

    // 背景网格
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#21262d';
    ctx.lineWidth = 0.5;
    const gridSize = 30;
    for (let x = 0; x < w; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // 绘制边
    workflow.edges.forEach((edge) => {
      const fromNode = workflow.nodes.find((n) => n.id === edge.from);
      const toNode = workflow.nodes.find((n) => n.id === edge.to);
      if (!fromNode || !toNode) return;

      const x1 = fromNode.x + BOX_W / 2;
      const y1 = fromNode.y + BOX_H / 2;
      const x2 = toNode.x + BOX_W / 2;
      const y2 = toNode.y + BOX_H / 2;

      // 贝塞尔曲线
      ctx.beginPath();
      ctx.strokeStyle = '#484f58';
      ctx.lineWidth = 2;
      const path = new Path2D(bezierEdge(x1, y1, x2, y2));
      ctx.stroke(path);

      // 箭头
      const [ax, ay, ax1, ay1, ax2, ay2] = arrowHead(x2, y2, x1, y1);
      ctx.beginPath();
      ctx.fillStyle = '#484f58';
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax1, ay1);
      ctx.lineTo(ax2, ay2);
      ctx.closePath();
      ctx.fill();

      // 边标签
      if (edge.label) {
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2 - 10;
        ctx.font = '11px "Consolas", monospace';
        ctx.fillStyle = '#8b949e';
        ctx.textAlign = 'center';
        ctx.fillText(edge.label, mx, my);
      }
    });

    // 绘制节点
    workflow.nodes.forEach((node) => {
      const isSelected = selectedNode === node.id;
      const isDragging = draggingNode === node.id;
      const baseColor = ROLE_COLORS[node.role] || '#569cd6';

      // 阴影
      ctx.shadowColor = isSelected ? baseColor : 'rgba(0,0,0,0.3)';
      ctx.shadowBlur = isSelected ? 12 : 4;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;

      // 主体
      const rx = 8;
      ctx.beginPath();
      ctx.moveTo(node.x + rx, node.y);
      ctx.lineTo(node.x + BOX_W - rx, node.y);
      ctx.arcTo(node.x + BOX_W, node.y, node.x + BOX_W, node.y + rx, rx);
      ctx.lineTo(node.x + BOX_W, node.y + BOX_H - rx);
      ctx.arcTo(node.x + BOX_W, node.y + BOX_H, node.x + BOX_W - rx, node.y + BOX_H, rx);
      ctx.lineTo(node.x + rx, node.y + BOX_H);
      ctx.arcTo(node.x, node.y + BOX_H, node.x, node.y + BOX_H - rx, rx);
      ctx.lineTo(node.x, node.y + rx);
      ctx.arcTo(node.x, node.y, node.x + rx, node.y, rx);
      ctx.closePath();

      ctx.fillStyle = isDragging ? '#1c2838' : '#161b22';
      ctx.fill();
      ctx.shadowColor = 'transparent';

      // 边框
      ctx.strokeStyle = isSelected ? baseColor : '#30363d';
      ctx.lineWidth = isSelected ? 2 : 1.5;
      ctx.stroke();

      // 顶部色条
      ctx.fillStyle = baseColor;
      ctx.beginPath();
      ctx.moveTo(node.x + rx, node.y);
      ctx.lineTo(node.x + BOX_W - rx, node.y);
      ctx.arcTo(node.x + BOX_W, node.y, node.x + BOX_W, node.y + rx, rx);
      ctx.lineTo(node.x + BOX_W, node.y + 4);
      ctx.lineTo(node.x, node.y + 4);
      ctx.lineTo(node.x, node.y + rx);
      ctx.arcTo(node.x, node.y, node.x + rx, node.y, rx);
      ctx.closePath();
      ctx.fill();

      // 角色标签
      ctx.font = '10px "Consolas", monospace';
      ctx.fillStyle = '#8b949e';
      ctx.textAlign = 'center';
      ctx.fillText(node.role, node.x + BOX_W / 2, node.y + 18);

      // Agent 名称或占位
      ctx.font = '11px "Consolas", monospace';
      ctx.fillStyle = node.agentName ? '#e6edf3' : '#484f58';
      ctx.fillText(
        node.agentName || '选择 Agent',
        node.x + BOX_W / 2,
        node.y + 38,
      );

      // 输入端口（左侧）
      ctx.beginPath();
      ctx.arc(node.x, node.y + BOX_H / 2, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#30363d';
      ctx.fill();
      ctx.strokeStyle = '#484f58';
      ctx.lineWidth = 1;
      ctx.stroke();

      // 输出端口（右侧）
      ctx.beginPath();
      ctx.arc(node.x + BOX_W, node.y + BOX_H / 2, 5, 0, Math.PI * 2);
      ctx.fillStyle = baseColor;
      ctx.fill();
      ctx.strokeStyle = baseColor;
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // 光标位置提示
    if (draggingNode) {
      ctx.font = '11px "Consolas", monospace';
      ctx.fillStyle = '#8b949e';
      ctx.textAlign = 'left';
      ctx.fillText(`位置: (${Math.round(mousePos.x)}, ${Math.round(mousePos.y)})`, 10, h - 10);
    }
  }, [workflow, selectedNode, draggingNode, mousePos]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [draw]);

  // --- 鼠标交互 ---
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let hit = false;
    for (const node of [...workflow.nodes].reverse()) {
      if (mx >= node.x && mx <= node.x + BOX_W && my >= node.y && my <= node.y + BOX_H) {
        setSelectedNode(node.id);
        setDraggingNode(node.id);
        hit = true;
        break;
      }
    }
    if (!hit) {
      setSelectedNode(null);
    }
  }, [workflow.nodes]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setMousePos({ x: mx, y: my });

    if (draggingNode) {
      setWorkflow((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) =>
          n.id === draggingNode
            ? { ...n, x: Math.max(0, mx - BOX_W / 2), y: Math.max(0, my - BOX_H / 2) }
            : n,
        ),
      }));
    }
  }, [draggingNode]);

  const handleCanvasMouseUp = useCallback(() => {
    setDraggingNode(null);
  }, []);

  // --- 操作为选中节点分配 Agent ---
  const assignAgent = useCallback((agentName: string) => {
    if (!selectedNode) return;
    setWorkflow((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) =>
        n.id === selectedNode ? { ...n, agentName } : n,
      ),
    }));
  }, [selectedNode]);

  // --- 模式变更 ---
  const changeMode = useCallback((mode: WorkflowDef['mode']) => {
    const tmpl = TEMPLATES.find((t) => t.mode === mode);
    if (tmpl) {
      setWorkflow({ ...tmpl, nodes: tmpl.nodes.map((n) => ({ ...n, agentName: '' })) });
    }
  }, []);

  // --- 运行工作流 ---
  const runWorkflow = useCallback(async () => {
    if (!description.trim()) return;
    setRunning(true);
    setResult('');
    setProgressLog([]);

    try {
      await orchestrateStream(
        description,
        workflow.mode,
        workflow.nodes.filter((n) => n.agentName).map((n) => n.agentName),
        (stage: string, data: OrchestrationProgress) => {
          const line = `[${stage}] ${JSON.stringify(data).slice(0, 150)}`;
          setProgressLog((prev) => [...prev.slice(-30), line]);
        },
      );
      setResult('工作流执行完成。请在任务管理器中查看详情。');
    } catch (err: any) {
      setResult(`执行失败: ${err.message}`);
    } finally {
      setRunning(false);
    }
  }, [description, workflow]);

  // --- 已选中的节点信息 ---
  const selectedNodeObj = workflow.nodes.find((n) => n.id === selectedNode);

  return (
    <div style={{ display: 'flex', gap: 16, height: 'calc(100vh - 80px)' }}>
      {/* 左侧面板 */}
      <div style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 12, flexShrink: 0 }}>
        {/* 模式选择 */}
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>执行模式</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {([
              ['pipeline', '流水线'],
              ['parallel', '并行'],
              ['collaborative', '协作'],
              ['debate', '辩论'],
              ['peer_review', '评审'],
              ['round_table', '圆桌'],
              ['hierarchical', '层级'],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                className={`btn btn-sm ${workflow.mode === mode ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => changeMode(mode)}
                style={{ fontSize: 12, padding: '4px 10px' }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 模板 */}
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>内置模板</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {TEMPLATES.map((t) => (
              <button
                key={t.name}
                className="btn btn-outline btn-sm"
                onClick={() => setWorkflow({ ...t, nodes: t.nodes.map((n) => ({ ...n, agentName: '' })) })}
                style={{ textAlign: 'left', fontSize: 12, justifyContent: 'flex-start' }}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>

        {/* 节点属性 */}
        {selectedNodeObj && (
          <div className="card" style={{ padding: 16 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>
              节点: {selectedNodeObj.label}
              <span style={{ color: ROLE_COLORS[selectedNodeObj.role] || '#569cd6', marginLeft: 8, fontSize: 11 }}>
                [{selectedNodeObj.role}]
              </span>
            </h3>
            <p style={{ fontSize: 12, color: '#8b949e', margin: '0 0 12px' }}>
              拖拽节点到合适位置 | 选择 Agent 分配到此阶段
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
              <button
                className={`btn btn-sm ${!selectedNodeObj.agentName ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => assignAgent('')}
                style={{ fontSize: 12, justifyContent: 'flex-start' }}
              >
                自动分配
              </button>
              {agents.map((a) => (
                <button
                  key={a.name}
                  className={`btn btn-sm ${selectedNodeObj.agentName === a.name ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => assignAgent(a.name)}
                  style={{ fontSize: 12, justifyContent: 'flex-start' }}
                >
                  {selectedNodeObj.agentName === a.name ? '✓ ' : ''}{a.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 中间画布 */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          background: '#0d1117',
          borderRadius: 8,
          border: '1px solid #21262d',
          overflow: 'hidden',
          position: 'relative',
          minHeight: 500,
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', cursor: draggingNode ? 'grabbing' : 'grab' }}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
        />

        {/* 水印提示 */}
        {!workflow.nodes.length && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%,-50%)', color: '#30363d',
            fontSize: 16, pointerEvents: 'none',
          }}>
            选择一个模板开始编排
          </div>
        )}
      </div>

      {/* 右侧执行面板 */}
      <div style={{ width: 300, display: 'flex', flexDirection: 'column', gap: 12, flexShrink: 0 }}>
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>执行工作流</h3>
          <p style={{ fontSize: 12, color: '#8b949e', margin: '0 0 12px' }}>
            模式: <strong>{workflow.mode}</strong> | 节点: {workflow.nodes.length} 个
            {workflow.nodes.some((n) => n.agentName) && (
              <span style={{ color: '#4ec9b0' }}>
                {' '}| 已分配: {workflow.nodes.filter((n) => n.agentName).length} 个
              </span>
            )}
          </p>
          <textarea
            className="input"
            placeholder="输入任务描述..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            style={{ width: '100%', marginBottom: 12, resize: 'vertical', fontSize: 13 }}
          />
          <button
            className="btn btn-primary"
            onClick={runWorkflow}
            disabled={running || !description.trim()}
            style={{ width: '100%' }}
          >
            {running ? '⏳ 运行中...' : '▶ 执行工作流'}
          </button>

          {result && (
            <div style={{
              marginTop: 12, padding: 8, background: '#0d1117',
              borderRadius: 6, fontSize: 12, color: '#e6edf3',
              maxHeight: 120, overflowY: 'auto',
            }}>
              {result}
            </div>
          )}
        </div>

        {/* 执行日志 */}
        {progressLog.length > 0 && (
          <div className="card" style={{ padding: 16, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>执行日志</h3>
            <div style={{
              flex: 1, overflowY: 'auto', fontSize: 11,
              fontFamily: '"Consolas", monospace', color: '#8b949e',
              background: '#0d1117', padding: 8, borderRadius: 6,
            }}>
              {progressLog.map((line, i) => (
                <div key={i} style={{ marginBottom: 2, wordBreak: 'break-all' }}>
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
