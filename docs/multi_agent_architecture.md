# AI Hubs 多 Agent 系统 —— 架构评审与设计文档

> 维护说明：本文件记录多 Agent 系统的 SOTA 对照分析与逐议题讨论结论。
> 每完成一个议题的讨论，在此追加"结论"段落，避免长对话导致上下文丢失。

---

## 0. 架构现状总览

```
┌──────────────────────────────────────────────────┐
│  Orchestrator (8种执行模式)                        │
│  SINGLE / PARALLEL / PIPELINE / COLLABORATIVE     │
│  DEBATE / PEER_REVIEW / ROUND_TABLE / HIERARCHICAL │
├──────────────────────────────────────────────────┤
│  TaskManager (发布-订阅 任务队列)                   │
│  AgentProxy → Agent (ReAct + LangGraph)           │
├──────────────────────────────────────────────────┤
│  记忆: ShortTerm + LongTerm + VCS (git式)         │
│  RAG: ChromaDB 向量库                             │
│  工具: ToolRegistry + @tool 装饰器                 │
│  通信: DebateManager / PeerReview / RoundTable    │
└──────────────────────────────────────────────────┘
```

核心文件（**v4 真实路径，2026-07-13 重核**）：
- `backend/app/core/orchestrator.py` — 编排核心：`run_single`/`run_sequential`/`run_parallel`/`run_debate`/`run_vote`/`run_hierarchical`/`run_swarm`/`run_custom`/`run_auto`
- `backend/app/core/agent.py` + `backend/app/models/agent.py` — 单 Agent 执行与配置（skills/config_mode 等）
- `backend/app/core/memory.py` — `MemoryManager`（VCS 式版本化 + 压缩保真 + 关键词检索，DB 持久化、按 user_id+agent_name 隔离）
- `backend/app/core/tools.py` — `TOOL_DEFINITIONS` 标准工具集 + `should_enable_tools`/`should_enable_code_tools`（代码类工具按 Agent `skills` 隔离）
- `backend/app/core/llm.py` — LLM 调用（stream_chat，仅取 `delta.content`，不读 usage）
- `backend/app/api/v1/*` — 业务路由（统一挂 `/api/v1` 前缀）
- `frontend/src/api/client.ts` — 前端请求封装（自动补 `/api/v1` 前缀）
- `frontend/src/pages/*` — 前端页面组件

> ⚠️ 以下 §2–§10、§12、§15 的**正文仍保留初稿的 v3 `src/` 描述**，均为已遗弃死代码，**结论以文末 §17「v4 重核结论速查」为准**。

> ⚠️ **代码基线更正（2026-07-13 实测线上服务器 8.138.24.27）**：本文档 §2–§16 初稿引用的是
> `src/core/communication.py`、`src/memory/enhanced_memory.py`、`src/ui/routers/*` 等路径，
> 但**线上部署的是另一套 v4 代码**：`app/main.py` + `app/api/v1/`（挂在 `/api/v1`）+ `app/core/`
> （如 `app/core/memory/memory_manager`，SQLAlchemy/DB 持久化、按 `current_user.id` 隔离）。
> `src/` 树目前是**未部署的分叉/旧版（v3 架构，根 `main.py` 已废弃）**。因此 §9（协调）、§11（压缩 no-op）、
> §14（JSON 落盘/CWD/session 默认）等初稿结论**描述的是死代码，不对应线上真实实现**。
> **用户已确认（2026-07-13）：以最新 `app/`（v4）为唯一权威基线，`src/`（v3）应遗弃。**
> → 已基于 `app/` 重核的章节：§8.7（workflows 空壳属实）、§11（压缩真执行）、§14（DB 持久化+按 user 隔离）、§16（后端产出文件收集已有）。后续未重核章节均以 `app/` 为准。

> 📋 **执行纪律与 v3 清理声明（2026-07-13 增补，适用于本文件所有后续改动）**：
> 1. **移除 v3 遗弃内容**：本文档所有结论、代码示例、路径引用一律以 `backend/app/`（v4）为准；
>    逐步删除文档中各章节残留的 `src/`（v3）路径与死代码描述；代码仓库中的 `src/` 树标记为待清理
>    （先确认无运行时引用再归档/删除，不贸然删）。
> 2. **执行时审核清楚**：每次下结论或改代码前，**必须先 `read_file` 真实 `app/` 实现并核对 file:line 证据**，
>    禁止基于记忆或未核对的旧路径下结论；改动后跑 `py_compile`/lint，必要时本地验证，再上服务器。
> 3. **重核范围**：#1–#9、#12、#15 初稿基于 v3 死代码，须逐一对照 `backend/app/` 重核（同 §11/§14 做法）。

---

## 1. SOTA 对照发现的问题清单（待逐议题讨论）

| # | 严重度 | 问题 | 状态 |
|---|--------|------|------|
| 1 | 🟡 | Agent 间缺少共享状态/黑板，靠文本拼接传递 | ✅ 重核成立（措辞待修：记忆已版本化、global 模式被动共享），见 §2 |
| 2 | 🟡 | Agent 记忆相互隔离 | ✅ 重核部分成立（默认 user_id+agent_name 隔离且落库；global 模式共享 `__global__`），见 §6 |
| 3 | 🟢 | 工具共享：v3 称全局单例过度共享 → v4 无单例，代码类工具按 Agent `skills` 隔离 | ✅ 重核已推翻重写，见 §7 |
| 4 | 🟡 | 模式检测是关键词匹配，LLM 分配器默认关闭 | ✅ 重核已推翻（无 ModeDetector；模式来自 `task.mode`；auto 仅 3 选 1；LLM 分配器可用），见 §8 |
| 5 | 🟢 | 并行模式用 threading 而非 asyncio | ✅ 重核已推翻（v4 纯 `asyncio.gather` 并发），见 §4 |
| 6 | 🟡 | Agent 间缺少结构化契约（纯文本传递，错误级联） | ✅ 重核成立（run_custom 纯文本接力），见 §3 |
| 7 | 🟡 | 流水线缺少阶段间质量门控 | ✅ 重核成立（run_custom 线性串接、全文无门控），见 §5 |
| 8 | 🟡 | Agent 间实时协调是轮询式，非动态 | ✅ 重核已推翻（无 communication.py/Manager；同步 async 函数 + SSE 事件流），见 §9 |
| 9 | 🟡 | 缺少系统级评估/护栏/成本归属 | ✅ 重核部分成立（无单价/无 MetricsCollector/无归因成立；已落库、有 user 级配额护栏；任务路径不计配额），见 §10 |
| 10 | 🟢 | 记忆压缩保真+脱敏：已实现（`_fidelity_ratio` 保真度校验 + `_desensitize` 脱敏，backend/app/core/memory.py） | ✅ 已讨论+已实现，见 §11 |
| 11 | 🔴 | 自定义工作流后端未真正执行（execute 仅置 status），且未接入 Auto 路由/手动选择 | ✅ 已讨论，见 §8.7 |
| 12 | 🟡 | UI 逐板块评审 | ✅ 重核：API 前缀隐患已治理（client.ts 封装）；真实缺口：split 布局 /workspace 不可达、ChatPage 斜杠命令缺项、死组件 CombinedPage，见 §12 |
| 13 | 🔴 | 数据集（CRUD/导入导出/记录管理）是否真能跑通 + UI 是否有问题 + 路由前缀对齐 | 🆕 新增，见 §13 |
| 14 | 🟢 | 记忆回滚/删除 + 数据库持久化：基于 `app/` 重核**已可用**（DB 持久化、按 user_id 隔离、rollback 真回退、compress 真执行）；剩余项：agent 默认 default 混写、缺单条删除端点、记忆 UI 需去掉"图谱可视化"（v4 用关键词索引非图库） | ✅ 已重核，见 §14 |
| 15 | 🔴 | 缺效率测试板：需测速度/准确度/消耗(+可靠性/协调效率/可扩展性/回归) | ✅ 重核确认缺失（仅有计数仪表盘+配额条，无 benchmark/性能/成本效率），见 §15 |
| 16 | 🟡 | AI/任务输出的安全性、易懂性、执行透明度（是否显示调用API/生成修改的文件） | 🆕 新增，见 §16 |

---

## 2. 议题 1 结论：共享状态（Blackboard）+ 访问控制

### 2.1 问题
当前 Orchestrator 协作是"串糖葫芦"：A 输出文本 → 塞进 B 的 prompt → B 输出塞进 C。
Agent 各自持有独立 `memory`（agent.py:201），彼此只有单向无结构文本通道。
导致：信息丢失（副产物不可见）、上下文污染、无法单步回溯。

### 2.2 用户核心观点（关键）
> 共享对话历史没问题，但 AI 是否读写应取决于「是否参与」和「是否公共编写」。

即二维访问控制模型：
- **读权限** ← 取决于「是否参与」（participation）
- **写权限** ← 取决于「是否公共编写」（public_write intent）

这等价于基于能力的访问控制（Capability-based Access）。

### 2.3 结论设计：A+B 混合，暂不做 C

- **(A) 模式拓扑为骨架**：每种 `ExecutionMode` 声明角色槽位及每槽位的读范围/写权限。
- **(B) Agent 能力声明做分配**：AgentProxy 声明 `roles`，Orchestrator 映射到槽位。
- **(C) 动态协商（草稿→发布）**：暂不做，待 A+B 稳定后加轻量 `agent.publish()`。

### 2.4 落地形态（草案）

```python
@dataclass
class RoleTopology:
    reads: str                 # "public" | "public+prev" | "all_private"
    can_write_public: bool

MODE_TOPOLOGIES = {
    ExecutionMode.PIPELINE:     {"stage": RoleTopology("public+prev", True)},
    ExecutionMode.PARALLEL:     {"worker": RoleTopology("public", False),
                                 "synthesizer": RoleTopology("all_private", True)},
    ExecutionMode.HIERARCHICAL: {"expert": RoleTopology("public", False),
                                 "manager": RoleTopology("all_private", True),
                                 "director": RoleTopology("all_private", True)},
}

@dataclass
class AgentProxy:
    ...
    roles: list[str] = field(default_factory=list)  # ["expert","moderator","executor",...]
```

### 2.5 各模式读写策略表

| 模式 | 是否参与(读) | 是否公共编写(写) |
|------|------|------|
| PIPELINE | 每 Agent 读上一阶段产物 | 写公共区（接力） |
| PARALLEL | 只读原始任务 | 各自写 private，合成时读全部 |
| HIERARCHICAL | 专家写 private，经理/总监可读 | 总监写"最终决策"到 public |
| DEBATE | 全员读对方发言 | 发言写 public（辩论录） |

### 2.6 待办（实现时）
- [ ] 新建 `src/core/blackboard.py`：Blackboard(public, private) + read/write + 拓扑校验
- [ ] AgentProxy 增加 `roles` 字段 + 前端可配置
- [ ] Orchestrator 各 `_execute_*` 改为读写 Blackboard 而非文本拼接
- [ ] `_smart_assign` 增加按 `roles` 匹配槽位

---

## 3. 议题 2 结论：Agent 间结构化契约

### 3.1 问题
Agent 间传递的数据全是**非结构化文本**（orchestrator.py:766 的 PIPELINE 拼接、:1007 的 DEBATE 字符串报告）。
导致：错误级联（上游格式漂移下游无感知）、无法程序化消费（评分/决策焊死在 Markdown）、不可验证（无 schema 校验）。

### 3.2 结论：采用 (B) 关键节点结构化
只对"需要被程序消费或接力"的产出做强 schema 校验，纯文本自由创作保持原样。
- 强制结构化：评分、决策、方案列表、分析结果等"机器要读"的产出
- 保持自由：写文章、头脑风暴草稿等创作类产出

### 3.3 落地形态（草案）
```python
class PipelineStageContract(BaseModel):
    stage_name: str
    expected_output: Type[BaseModel]      # SolutionSet / AnalysisReport ...
    required_fields: list[str]

# Orchestrator 在 Agent 写回黑板时校验：
result_obj = contract.expected_output.model_validate(agent_raw_output)
blackboard.write(agent, stage_name, result_obj, public=True)
# 校验失败 → 触发重试或降级（而非静默传递错误）
```

### 3.4 待办（实现时）
- [ ] 定义各模式的"关键节点" schema（如 DebateVerdict / PipelineArtifact / ReviewReport）
- [ ] Orchestrator 写回黑板前做 `model_validate`，失败重试一次
- [ ] 前端可直接渲染结构化字段（pro_score 数字、approved 布尔）

---

## 4. 议题 3 结论：并行/协作执行全面 asyncio 化

### 4.1 问题
`_execute_parallel`（orchestrator.py:673）用 `threading.Thread` 并发跑 Agent。
纠正此前表述：LLM 调用是 IO 密集型，`socket.recv` 会释放 GIL，多线程"等待期"确实能重叠，
所以"不能并发"不准确。但仍有 4 个实质隐患：

1. **与 Blackboard（议题1）冲突（最致命）**：多线程对 Blackboard 的 public/private 读写需加锁，
   读写权限逻辑一复杂，锁竞争/死锁风险陡增。asyncio 单线程协同，天然无此并发 bug。
2. **与现有异步栈割裂**：DB 层 `aiomysql`（`task_manager.py:184` 的 `_run_async`）、
   RAG/LangGraph 的 `astream_events` 都是 async，Orchestrator 却在线程里跑同步 `agent.run()`，
   跨线程投回 event loop 脆弱。
3. **无法真正取消**：`join(timeout=600)` 仅"等待"，超时不杀线程；Agent 卡住就泄漏 daemon 线程。
   asyncio 可用 `asyncio.wait_for(coro, timeout=600)` 真取消。
4. **不利于并发推流 UI**：线程模型需自己 juggle 回调；asyncio `gather` + 每 Agent 的
   `astream_events` 天然并发推送 token。

### 4.2 结论：全面异步化（用户确认）
- **范围**：不只改 `_execute_parallel`，**顺带把单 Agent / 流水线 / 其他协作模式的执行入口也异步化**。
  - `Agent` 新增异步入口 `arun()`（LangGraph 已有 `ainvoke`，近乎零成本）；
  - `_run_agent_with_logging` 出 async 版，保留 event 捕获；
  - `TaskManager.execute_orchestrated` 由同步方法改为 async（连带调用链上游需 async 化）。
- **同步阻塞工具（本地 python 执行等）**：先用 `loop.run_in_executor` 包一层标注 TODO，
  避免卡住事件循环；不在本期彻底重构，待后续议题处理（见 §4.7 待办）。

### 4.3 目标形态（草案）
```python
# Agent 新增
async def arun(self, prompt: str, *args, **kwargs):
    # LangGraph ainvoke / astream_events
    ...

# Orchestrator 并行
async def _execute_parallel_async(self, task, agents, result, on_progress):
    tasks = [self._run_agent_async(proxy, task, task.description) for proxy in agents]
    partial_results = await asyncio.gather(*tasks, return_exceptions=True)
    ...

# 同步阻塞工具：标注 TODO，先 run_in_executor 兜底
def _run_sync_tool(tool, *a, **kw):
    loop = asyncio.get_event_loop()
    # TODO(议题3): 评估把同步工具迁移为原生 async，去掉 executor 兜底
    return loop.run_in_executor(None, lambda: tool(*a, **kw))
```

### 4.4 带来的连带收益
- 与 Blackboard（§2）、aiomysql 同一事件循环，共享状态安全；
- `asyncio.wait_for` 真取消卡住 Agent；
- 并行模式天然并发推流 token 到 UI。

### 4.5 待办（实现时）
- [ ] `Agent.arun()` 异步入口（含 `astream_events` 推流）
- [ ] `_run_agent_with_logging` → async 版，保留 event 捕获
- [ ] `_execute_parallel` / `_execute_pipeline` / 其他 `_execute_*` → async 版
- [ ] `TaskManager.execute_orchestrated` 改 async，上游调用链（API 层）同步改 async
- [ ] 同步阻塞工具用 `run_in_executor` 包裹，标注 `TODO(议题3)` 待原生 async 化
- [ ] 单测：并行模式用 `asyncio.gather` 验证并发等待 + `wait_for` 取消路径
- [ ] 回归：确认 Blackboard 在 async 单线程下无需锁、读写正确

### 4.6 风险
- 调用链 async 化是**较大改动面**（API → TaskManager → Orchestrator → Agent），
  需一次改全，避免半同步半异步混杂。建议独立分支提交。
- 部分 LangChain 1.x 同步工具若不支持 async，会落入 `run_in_executor`，需逐一排查。

---

## 5. 议题 7 结论：流水线阶段间质量门控

### 5.1 问题
当前 `_execute_pipeline`（orchestrator.py:754-800）线性串接，第 783 行
`current_input = output or ""` 把上游输出直接拼给下游 prompt。只有**抛异常**才 break（:789），但：
- 格式漂移（A 该给 3 方案却给散文）→ 下游无感知继承
- 内容质量差 / 幻觉 / 偏离任务 → 完全放行
- 软错误级联：越往后越错，且无任何报错

议题 2 解决了"契约层"（数据结构），本议题解决"在契约之后、阶段之间加一道 **Gate** 拦截软错误"。

### 5.2 结论：复用 Blackboard + 契约，加两层 Gate（推荐）
建立在 §2（Blackboard）与 §3（结构化契约）之上，不在 pipeline 硬编码新机制：

- **Gate-1 结构化校验门（零额外成本，默认开）**：
  阶段若声明 `expected_output` schema（议题3 §3.3），写回 Blackboard 前 `model_validate`；
  失败 → 该阶段 Agent **重试一次**，prompt 附"输出不符合结构要求：<错误>"；
  仍失败 → 降级为文本写回并打 `warn` 标签（不阻塞全链路，避免雪崩）。

- **Gate-2 LLM 质量评审门（默认关，任务级开关 `strict_mode` 开启）**：
  用轻量评审器（复用 PEER_REVIEW 评审逻辑，见 communication.py）对本阶段产出打分
  （相关性 / 完整性 / 是否偏离原始任务）；低于阈值 → 重试并附评审反馈；
  连续不达标 → 打 `warn` 继续，全链路不中断。

### 5.3 关键决策（推荐）
| 决策点 | 推荐 |
|------|------|
| Gate-1 默认 | **开**（零成本，纯 schema 校验） |
| Gate-2 默认 | **关**，任务级 `strict_mode` 开关开启（省成本） |
| 评审器来源 | 复用现有 PEER_REVIEW 评审逻辑，不新建 |
| 失败策略 | 重试一次 → 再失败打 warn 继续（不雪崩、不静默） |
| 重试反馈 | 把 schema 错误 / 评审分数 回灌给该阶段 Agent |

### 5.4 目标形态（草案）
```python
for i, agent in enumerate(agents):
    output = await self._run_agent_async(agent, task, prompt)
    # Gate-1（依赖 §3 契约 schema 先落地）
    if contract := stage_contracts.get(i):
        try:
            obj = contract.expected_output.model_validate(output)
        except ValidationError as e:
            output = await self._retry_stage(agent, task, prompt, f"结构不符: {e}")
            obj = ... or _warn
        blackboard.write(agent, f"stage_{i}", obj, public=True)
    # Gate-2（strict_mode 开启时）
    if task.strict_mode:
        score = await self._gate_review(task, output)
        if score < THRESHOLD:
            output = await self._retry_stage(agent, task, prompt, f"质量分{score}偏低: ...")
    current_input = output
```

### 5.5 待办（实现时）
- [ ] pipeline 每阶段后接 Gate-1（**依赖 §3 契约 schema 先落地**）
- [ ] Gate-2 评审器复用 PEER_REVIEW，加 `strict_mode` 任务级开关
- [ ] 重试带反馈机制（`_retry_stage`，每阶段最多重试 1 次）
- [ ] Blackboard 写回打 `warn` / `ok` 状态标签，前端可见
- [ ] 单测：构造"格式不符"阶段，验证重试一次 + 降级打 warn

### 5.6 风险
- Gate-2 增加 LLM 调用成本（故默认关，仅严格模式开）
- 重试拉长端到端时延，须设每阶段最大重试次数（建议 1）

---

## 6. 议题 2 结论：Agent 记忆隔离与长期记忆作用域

### 6.1 现状（关键发现：现状其实是"两极分化"）
- **短期记忆**：per-Agent 完全独立。`Agent.memory: MemoryManager = field(default_factory=MemoryManager)`（agent.py:201），
  每个 Agent 实例各自 `new` 一个 `MemoryManager` → `ShortTermMemory` 彼此看不到。
- **长期记忆**：`LongTermMemory`（memory_manager.py:168）用 ChromaDB，默认
  `db_path="./data/memory.db"`、`collection="agent_memory"`（:181-182）。
  **所有 Agent 默认指向同一个路径 + 同一个 collection → 实际是"全局混洗"，并非隔离。**
  - `add` 时 metadata 仅写 `role` / `type`（:316-321），**无 `user_id` / `agent_id` / `session_id`**；
  - `query` 检索时**无任何 filter**（:215-231），`where={}` 级别的纯语义召回。
- 结论：问题清单写"记忆相互隔离"不准确。真实情况是
  **短期记忆过度隔离 + 长期记忆过度共享且无隔离**，后者是**安全/正确性 bug**。

### 6.2 两个独立问题
- **A（真 bug，优先级最高）**：长期记忆无租户/角色维度。所有用户、所有 Agent 的记忆
  全部丢进同一个 `agent_memory` collection，检索时不按任何人过滤 →
  跨用户记忆泄露（多租户数据串味）+ 跨 Agent 记忆污染。
- **B（设计层）**：短期记忆 per-Agent 隔离，协作时看不到彼此对话上下文。
  这与 §2 用户"共享对话历史没问题"的诉求一致——需要会话级共享。

### 6.3 推荐结论
1. **A 优先修复（安全/正确，不依赖其他议题）**：
   `LongTermMemory` 强制 `user_id` + `agent_id` + `session_id` + `scope` 四维。
   - `add`：metadata 强制写入四维；
   - `query`：必须带 filter（至少 `user_id`，协作场景加 `agent_id`/`session_id`）。
2. **B 改为 per-session 共享短期记忆**：同一编排会话（session）内所有 Agent 共享一份
   `ShortTermMemory`（滑动窗口），让每个 Agent 都能看到会话里发生了什么；
   Agent 的私有草稿仍独立（呼应 Blackboard 的 private 区）。
3. **治理统一**：记忆作用域（private / session / global）**复用 §2 的 RoleTopology 读写拓扑**，
   不另立权限体系。记忆本质是 Blackboard 的持久化延伸。

### 6.4 记忆作用域模型
| 作用域 scope | 可见范围 | 对应 §2 拓扑 |
|------|------|------|
| `private` | 仅本 Agent | private |
| `session` | 同 session 协作 Agent | public(协作) |
| `global` | 所有 Agent / 用户（公共知识） | 公共区 |

### 6.5 目标形态（草案）
```python
class LongTermMemory:
    def add(self, content, *, user_id, agent_id=None,
            session_id=None, scope="private", metadata=None):
        meta = {"user_id": user_id, "agent_id": agent_id,
                "session_id": session_id, "scope": scope, **(metadata or {})}
        self.collection.add(ids=[mid], documents=[content], metadatas=[meta])

    def query(self, query, *, user_id, agent_id=None,
              session_id=None, scope="private", n_results=5):
        # 强制构造 where 过滤，杜绝跨租户召回
        where = {"user_id": user_id}
        if scope == "session":
            where["session_id"] = session_id
        elif scope == "private":
            where["agent_id"] = agent_id
        results = self.collection.query(query_texts=[query],
                                         n_results=n_results, where=where)
        ...
```

### 6.6 待办（实现时）
- [ ] `LongTermMemory.add` 强制 `user_id/agent_id/session_id/scope` 维度
- [ ] `LongTermMemory.query` 强制 filter（防跨租户泄露）——**安全修复，独立可落地**
- [ ] `Agent` 透传 `user_id`（来自会话上下文）给记忆系统
- [ ] 短期记忆：编排会话内共享 `ShortTermMemory` 实例（per-session），替代 per-Agent
- [ ] 记忆作用域接入 §2 `RoleTopology`（private / session / global）

### 6.7 风险
- 改动记忆 schema 需**迁移旧 ChromaDB 数据**：旧记忆无 `user_id` 维度，按新 filter 召回会全部失效；
  需提供一次性迁移脚本（给旧记忆补默认 `user_id` 或清空重建）。
- per-session 共享短期记忆要注意：**SINGLE 模式仍是独立**，不应共享。

---

## 7. 议题 3 结论：工具集共享与作用域治理

### 7.1 现状（修正原报告误判）
原问题清单 #3 写"工具集未共享（每 Agent 独立 ToolRegistry）"，**不准确**。
读代码确认：`get_registry()`（base.py:296）是模块级**全局单例**，`_registry` 只 new 一次；
`Agent.tools: ToolRegistry = field(default_factory=get_registry)`（agent.py:201）每次都返回同一单例。
**真实现状：所有 Agent 共享同一个全局 ToolRegistry（全量可见）；行为约束靠 skills + prompt，危险工具走确认（见 §7.3）。**

现状能力：
- `ToolRegistry.register/unregister`（base.py:221/236）→ 运行时可增删工具；
- `Tool.dangerous` 标志（base.py:74）→ 仅控制"是否需用户确认"，**不控制"哪些 Agent 能用"**；
- `_build_langchain_tools` 用 `self.tools.list_all()`（agent.py:358）→ 每个 Agent 看到**全部**工具。

### 7.2 用户反馈与方案修正
用户明确（2026-07-13）：所有 Agent **可视全部工具集**（保留全局单例共享，不做可见性裁剪）；
约束 Agent 行为靠**其拥有的技能(skills) + prompt 指令**，而非隐藏工具；危险工具调用走**确认**兜底。
故**放弃**原方案的 `resolve_for` / `tags` / `required_capability` 可见性过滤——
硬隐藏工具易致"Agent 需要时找不到工具"的失败，不如"全量可见 + 危险确认 + prompt 约束"实用。

### 7.3 推荐结论（采纳用户方案）
1. **全量可见**：保留全局 `ToolRegistry` 单例，所有 Agent 看到全部工具；不改 `list_all` 暴露方式。
2. **危险确认兜底**：`dangerous=True` 工具调用前**必须用户确认**，强化现有确认流，确保不可绕过
   （前端确认入口 + 后端执行前二次校验）。
3. **行为约束来自 skills + prompt**：Agent 的工具调用边界由其 `skills`（技能集/分类）和 prompt 中
   的指令约束。Orchestrator 构造 Agent prompt 时明确"你负责 X，应优先用 Y 类工具，勿用 Z"。
   这呼应现有 `_smart_assign` 按技能匹配 Agent —— skills 决定"该干什么"，prompt 决定"怎么干"。
4. **动态发现（可选扩展点）**：`register/unregister` 已支持运行时增删，`ToolProvider` 接口 / MCP
   接入作为可选 TODO，不强制。

### 7.4 目标形态（草案）
```python
# 保留全局单例，全量可见；仅强化危险确认
class Tool:
    ...
    dangerous: bool = False   # 调用前需用户确认（现有机制，强化不可绕过）

# Orchestrator 在 Agent prompt 内约束（基于 Agent.skills）：
prompt += (
    f"\n你的技能范围: {agent.skills}\n"
    f"请仅在职责与技能范围内调用工具；"
    f"涉及危险操作将向你确认后再执行。"
)
```

### 7.5 待办（实现时）
- [ ] 强化危险工具确认流（前端确认入口 + 后端执行前二次校验，确保不可绕过）
- [ ] Orchestrator 在 Agent prompt 中明确技能/工具边界（基于 `Agent.skills`）
- [ ] 可选：`ToolProvider` 动态注册扩展点（MCP 接入 TODO）
- [ ] **放弃** `resolve_for` / `tags` / `required_capability` 可见性裁剪方案（按用户反馈）

### 7.6 风险与权衡
- 全量可见可能让 LLM 误用危险工具 → 靠"确认兜底"双保险（用户可接受）。
- prompt 约束不如硬过滤强 → 依赖 LLM 遵循 + 危险确认；若未来需更强隔离，可再加 `resolve_for`，
  但本期不做。

---

## 8. 议题 4 结论：模式检测（关键词 vs LLM 路由）

### 8.1 现状
- `ModeDetector.detect`（orchestrator.py:153-197）：关键词计分。中文歧义明显——
  "先"触发 PIPELINE、"分析"在复杂词里，导致"先分析一下"易被误判为流水线。
- `LLMWorkflowAllocator`（:220+）：**已有** LLM 路由，返回 JSON 分配方案；
  但 `use_llm_allocation=False` 默认**关闭**，且 `ALLOCATION_PROMPT`（:234）仅支持
  `single|parallel|pipeline|collaborative` **4 种 mode**，漏了
  DEBATE / PEER_REVIEW / ROUND_TABLE / HIERARCHICAL。

### 8.2 问题
1. 关键词对中文歧义差 → 误路由（"先看看"被当流水线）。
2. LLM 分配器默认关，且 mode 枚举不全（4/8）→ 即便开启也路由不到辩论/层次等模式（**功能遗漏**）。
3. 路由结果不可覆盖（用户可能想手动选模式）。

### 8.3 推荐结论（混合路由）
1. **关键词作"快路径"**：超短（<20字）/ 简单问答（SIMPLE_PATTERNS 且 <60字）→ 直接 SINGLE，
   零 LLM 延迟；其余任务默认走 LLM 分配器。
2. **默认启用 LLM 分配**：`use_llm_allocation` 默认 **True**（当前 False）；可选指定轻量路由模型降成本。
3. **补全 mode 枚举**：`ALLOCATION_PROMPT` 支持全部 8 种 `ExecutionMode`，返回 mode 正确映射。
4. **可解释 + 可覆盖**：返回 `reason`（已有）；前端允许手动覆盖自动检测的模式（用户选择优先）。

### 8.4 目标形态（草案）
```python
def route(task, agents_info, llm):
    # 快路径：关键词零延迟
    if len(task) < 20 or _is_simple(task):
        return ModeDetector.detect(task)          # → SINGLE
    # 主路径：LLM 路由（默认开启）
    if use_llm_allocation and llm:
        try:
            return LLMWorkflowAllocator.allocate(task, agents_info, llm)
        except (TimeoutError, json.JSONDecodeError):
            pass
    return ModeDetector.detect(task)               # 回退
```

### 8.5 待办（实现时）
- [ ] `use_llm_allocation` 默认改为 True（或配置项）
- [ ] `ALLOCATION_PROMPT` 的 mode 枚举补全为 8 种 + 映射校验
- [ ] 关键词仅作快路径（<20字/简单问答 → SINGLE），其余走 LLM
- [ ] LLM 路由支持指定轻量模型（降成本，避免每次用对话主力模型）
- [ ] 前端允许手动覆盖自动检测的模式

### 8.6 风险
- LLM 路由增加一次调用延迟/成本 → 用快路径覆盖简单任务 + 轻量模型缓解
- LLM 返回非法 mode/JSON → 严格校验 + 回退关键词（已有 fallback 机制）

### 8.7 自定义工作流作为一等公民执行计划（用户补充）
**用户要求（2026-07-13）**：① Auto 模式要把"用户自定义工作流"纳入考虑（匹配到就用它）；
② 同时允许任务手动选择某个自定义工作流执行。

#### 8.7.1 现状（含重要缺口，基于 `app/` 重核 2026-07-13）
- 自定义工作流**确实含工作逻辑**：数据模型 `WorkflowNode[]`（类型 `start|agent|tool|condition|parallel|sequential|end`）
  + `edges` 连线，能表达串行 / 并行 / 条件分支（`frontend/src/pages/WorkflowPage.tsx:5-24`）。
- 后端 **`api_execute_workflow`（backend/app/api/v1/workflows.py:41-47）确为空壳**：只把 `status`
  置为 `running` 就返回，**未调任何执行逻辑**（已确认属实，非误判）。
- **可复用资产**：`backend/app/core/orchestrator.py` 已有 `run_custom`（:539-576），能按 `pipeline_steps: list[str]`
  （格式 `"agent_name:prompt"`）真执行多步流水线。但 `workflows.execute` 未调用它，且 `run_custom` 吃的是
  字符串步骤而非 `WorkflowNode[]` 图——缺一层「`WorkflowNode[]`/`edges` 拓扑遍历 → 适配成 `run_custom/run_single` 调用」的 **Graph Runner**。
- 内置 8 模式（`MODE_RUNNERS`，orchestrator.py:839-849）与自定义工作流是**两套割裂体系**：Auto 路由
  （`run_auto`，:715-836）只产出 8 种 `mode`，完全不知道用户自定义工作流的存在。

#### 8.7.2 推荐结论
1. **自定义工作流 = 一等公民执行计划**：与内置 8 模式同级，是可被 Orchestrator 直接运行的
   `execution plan`（图）。其节点执行复用 §2 Blackboard（节点间传值）+ §3 结构化契约（节点产出 schema）。
2. **Auto 模式考虑自定义工作流**：路由时除产出内置 mode，还做一层
   "自定义工作流匹配"——按任务语义（name/description/标签 或用户标记的 `default_workflow`）匹配最合适的
   用户工作流；命中则直接以该工作流图为执行计划，跳过内置 mode；未命中回退 §8.3 的 8 模式路由。
3. **允许手动选择**：任务创建 / 编排入口新增"选择工作流"项，列出用户自定义工作流；选中即按图执行，
   绕过 Auto 检测（用户选择优先，呼应 §8.3.4）。
4. **必须补后端 Graph Runner**（前提）：实现按 nodes/edges 拓扑遍历执行的引擎，支持 `parallel`
   并发（`asyncio.gather`，复用 §4）、`condition` 按上下文分支；否则自定义工作流仍是摆设。

#### 8.7.3 目标形态（草案）
```python
# Auto 路由：内置模式 + 自定义工作流候选
def route(task, agents_info, llm, user_workflows):
    # 1) 自定义工作流语义匹配（用户维度，优先）
    if (wf := match_user_workflow(task, user_workflows)):
        return Plan(kind="custom_workflow", workflow=wf)
    # 2) 快路径 / LLM 8 模式（见 §8.4）
    ...

# 任务入口：手动选择工作流
class OrchestrateReq:
    mode: str                       # auto|single|...|custom
    workflow_id: str | None = None  # 手动选中的自定义工作流
```

#### 8.7.4 待办（实现时）
- [ ] **后端 Graph Runner**：真按 `nodes/edges` 遍历执行（parallel→gather、condition→分支、agent/tool 节点调用）
- [ ] 自定义工作流匹配器 `match_user_workflow`（语义/标签/`default_workflow`）
- [ ] Auto 路由接入自定义工作流候选（命中即用，未命中回退 8 模式）
- [ ] 任务/编排前端新增"选择工作流"入口，列出用户自定义工作流
- [ ] 自定义工作流的节点执行复用 §2 Blackboard 传值 + §3 结构化契约
- [ ] 单测：构造"并行+条件"工作流，验证 Graph Runner 拓扑正确执行

#### 8.7.5 风险
- 后端执行是空壳（:41-47），Graph Runner 是**前置硬依赖**，不补则一切无从谈起；建议独立先行。
- 自定义工作流与内置 8 模式并存，需统一 `execution plan` 抽象，避免 Orchestrator 两套分支。

---

## 9. 议题 8 结论：Agent 间实时协调——从轮询式到动态协调

### 9.1 现状（轮询式、静态轮次）
四个协作 Manager 都在 `src/core/communication.py`：
`DebateManager`（:71）/ `PeerReviewManager`（:275）/ `RoundTableManager`（:441）/ `HierarchicalManager`（:627）。
共同特征：
- **轮次写死**：`rounds` / `discussion_rounds` 由调用方传常量（默认 2），前端/Orchestrator 定死；
  跑满 N 轮即停，无论是否达成共识。
- **轮询式中转**：每轮 Orchestrator 收集各方文本 → 摘要 → 注入下一轮 prompt（:189 `_build_transcript`、
  :544 `_summarize_others`）。Agent 间无直连、无共享状态，全靠 Orchestrator 漏斗式中转。
- **发言顺序固定**：Debate 固定 pro→con→judge；RoundTable 固定 round-robin 全员每轮发言（:530、:547）。
  无"谁该说、谁有新信息"的动态决策。
- **主持人只做最后总结/裁决，不参与"是否继续"**：Debate 投票在最后（:215）；RoundTable 的 facilitator
  仅跑 `SUMMARY_PROMPT`（:478）不 gate 轮次。即"静态轮次 + 末尾一次性裁决"。

### 9.2 问题
1. **静态轮次 = 浪费或不足**：简单议题也跑满 2 轮；复杂议题 2 轮不够却不会加轮。
2. **无收敛检测**：无法在"共识已达成 / 已答清问题"时提前结束（与 #9 成本强相关）。
3. **无动态发言调度**：固定轮询，沉默者被点名、持反对者被强制每轮发言，不会"按信息增量选人"。
4. **协调全靠 Orchestrator 中转摘要**，Agent 间无直连/共享状态 —— 与 §2 Blackboard 未打通。
5. **四套 Manager 重复轮次骨架**，加动态策略要改 4 处，难以统一演进。

### 9.3 推荐结论：统一 Coordinator + 动态策略
1. **抽象 `Coordinator`**（替代 4 个 Manager 重复的轮次骨架）：持有共享上下文（复用 §2 Blackboard），
   按"策略"驱动轮次；4 种模式退化为 Coordinator 的预置策略/角色配置。
2. **策略一 固定轮次**：兼容现状，作回退（默认 `max_rounds` 仍生效）。
3. **策略二（推荐默认开启）动态终止**：每轮后由 `chair`（轻量 LLM 或规则）判断
   `consensus_reached | question_answered | diminishing_returns` → 提前结束；与 #9 成本直接挂钩。
4. **策略三 动态发言调度**：`chair` 从候选 Agent 中选"下一个最该发言者"（信息增量最大），
   呼应 AutoGen `select_next_speaker` / LangGraph Supervisor `handoff`，替代固定轮询。
5. **chair 本身是特殊 Agent 角色**（或复用 §2 的 moderator 槽位），读 Blackboard 判断收敛/选人。
6. **与 §4 异步结合**：允许"并行发言轮"（多个 Agent 同时 `asyncio.gather`），动态调度决定下轮并行 or 串行。

### 9.4 目标形态（草案）
```python
class Coordinator:
    def __init__(self, strategy, chair, blackboard): ...
    async def run(self, topic, agents, task, run_agent_fn):
        while True:
            speakers = self.strategy.select_speakers(agents, self.blackboard)  # 动态 or 轮询
            outputs = await asyncio.gather(*[run_agent_fn(a, task, ctx) for a in speakers])
            self.blackboard.commit(outputs)
            dec = await self.chair.should_continue(self.blackboard)  # 动态终止
            if dec.stop or self.round >= self.max_rounds:
                return self.blackboard.finalize()
```

### 9.5 待办（实现时）
- [ ] 抽象 `Coordinator` 统一 4 个 Manager 的轮次骨架（策略可插拔，4 模式退化为预置策略）
- [ ] 动态终止：chair/规则判断收敛 → 提前结束（默认开启，省成本，呼应 #9）
- [ ] 动态发言调度：chair 选下一发言者（替代固定轮询）
- [ ] chair 读 §2 Blackboard 判断收敛/选人（共享上下文）
- [ ] 收敛检测先用轻量规则（轮间 embedding 相似度 / "继续?" 分类），再上 LLM chair
- [ ] 与 §4 异步结合：并行发言轮用 `asyncio.gather`

### 9.6 风险
- 动态终止可能过早结束（误判共识）→ 设 `min_rounds` 下限 + 保守阈值
- 动态调度增加一次 chair 调用成本 → chair 用轻量模型/规则
- 统一重构 4 个 Manager 是较大改动面，建议独立分支，先保留 fixed 策略等价兼容

---

## 10. 议题 9 结论：系统级评估 / 护栏 / 成本归属

### 10.1 现状（三支柱均薄弱）
- **成本**：`src/core/metrics.py` 有 `MetricsCollector`/`TurnMetrics`（token、LLM 调用、工具调用、延迟），
  但 `agent.py:240` 的 `metrics` 是**会话内、内存态**，未落库、无 $ 单价、无按
  `user/agent/task/mode` 归因、无预算。`agent.py:110` 的 `token_usage` 仅单调用回显。
  → **成本归属近乎空白**。
- **护栏**：仅 `src/middleware/rate_limiter.py`（IP 级请求限频）+ 工具沙箱
  （`extended_tools.py` 只读 SQL/命令黑名单、`builtin_tools.py` Python AST 白名单）+ 危险工具确认（§7）。
  **无内容审核、无 Agent 间提示注入防护、无预算护栏**。
- **评估**：仅 `PeerReviewManager`（communication.py:275）对**单次产出**做评审，无系统级基准 / 回归 /
  跨模式量化对比。`datasets` 模块存在但无 eval harness 接入。

### 10.2 问题
1. 多 Agent 编排 token 消耗远大于单 Agent，**无成本归因就无法做预算/计费/优化**。
2. 无护栏：Agent 产出含敏感/违规内容无拦截；多 Agent 串接时一个 Agent 的注入可污染 Blackboard（§2/§9）。
3. 无系统级评估：无法量化"哪种模式/哪些 Agent 更优"，Peer Review 仅质量门、非回归/对比。

### 10.3 推荐结论（三层架构）
将 #9 拆为三独立子系统，互不阻塞、可分批落地：

**A. 成本归属（优先级最高，独立可落地）**
- 复用 `metrics.py` 采集器，但**落库 + 归因**：新增 `UsageRecord`（user_id, agent_id, task_id,
  mode, model, in_tokens, out_tokens, cost_usd, created_at）。
- **单价表** `PRICING`（按 model 配置 $/1K token），把 token 换算成 cost；无单价时按估算 token 计。
- **聚合接口**：按 user / task / agent / mode 汇总成本与 token。
- **预算护栏**：可选每用户月度 token/¥ 预算，超阈值 `warn`（默认）或 `hard_stop`（可配），
  与 B 护栏层共用拦截点。
- Orchestrator 每轮把 `TurnMetrics` 写库（复用 §4 异步、落库走 aiomysql 同循环）。

**B. 护栏（分层，可插拔）**
- L0 基础设施：现有 IP 限频（保留）。
- L1 工具安全：现有沙箱 + 危险确认（§7，保留并扩展）。
- L2 内容护栏（**可选/可配**）：输入/输出审核钩子，可接厂商 moderation API 或本地轻量分类器；
  默认关（避免延迟），严格模式开。
- L3 多 Agent 注入防护（**与 §2/§9 强相关**）：Agent 写入 Blackboard（§2）前，对输出做
  注入模式扫描（如"忽略以上指令""你是新助手"等），命中则标记/清洗后再提交——防止一个 Agent
  劫持后续 Agent（动态协调 §9 下风险更高）。
- L4 预算护栏：来自 A 的 budget 拦截点。

**C. 系统级评估（升级 PeerReview 为可复用评分器）**
- 把 `PeerReviewManager` 的评审逻辑抽出为通用 `QualityScorer`（呼应 §5 Gate-2 评审器，避免重复实现）。
- **eval harness**：对一组 `datasets` 跑任务，按模式/Agent 输出打分，支持**跨模式对比 / 回归追踪**
  （同一任务不同版本 Agent 的分数变化）。
- 核心指标：任务完成度、忠实度（无幻觉，呼应 §6 记忆 / 议题 #10 无损性）、工具调用正确性。

### 10.4 目标形态（草案）
```python
@dataclass
class UsageRecord:
    user_id: int; agent_id: int|None; task_id: str; mode: str; model: str
    in_tokens: int; out_tokens: int; cost_usd: float; created_at: datetime

class CostLedger:
    def record(self, rec: UsageRecord): ...              # 落库（aiomysql）
    def summarize(self, by: str = "user") -> list[dict]: ...

class Guardrail:
    async def scan_input(self, text) -> Verdict: ...     # L2 可选
    async def scan_blackboard_write(self, agent, text) -> Verdict: ...  # L3 注入防护
```

### 10.5 待办（实现时）
- [ ] `UsageRecord` 落库 + 按 user/agent/task/mode 归因（A，独立可落地）
- [ ] 单价表 `PRICING` + cost_usd 计算；无单价走估算 token
- [ ] 成本聚合接口（按 user/task/agent/mode）
- [ ] 预算护栏（warn/hard_stop 可选）
- [ ] L2 内容护栏钩子（可选/可配，默认关）
- [ ] L3 Blackboard 写入前注入扫描（与 §2/§9 共用）
- [ ] 抽出 `QualityScorer`，eval harness + datasets 对比/回归

### 10.6 风险
- 成本计算依赖准确 token 数：优先用 provider 返回的 usage，fallback `estimate_tokens`（metrics.py 已有）。
- 预算 hard_stop 会打断长任务 → 默认 warn，hard_stop 需显式开启。
- 内容护栏/注入扫描增加延迟 → 均设开关，默认关或仅在严格模式开。
- PeerReview→QualityScorer 抽离要注意 §5 Gate-2 已计划复用，避免两套评审实现。

---

## 11. 议题 10 结论：记忆压缩的无损性问题（基于 `app/` 重核 2026-07-13）

> 初稿基于 `src/memory/enhanced_memory.py`（v3 死代码），结论已作废；以下基于 `backend/app/core/memory.py`。

### 11.1 现状（真实 v4 实现）
`backend/app/core/memory.py` 的 `MemoryManager`：
- **压缩真执行（非 no-op）**：`_maybe_compress`（:191-262）在「未压缩条目 > 40」时触发（且 `add_turn`
  每轮自动调，:168-169）；`compress_now`（:282-285，手动 `/compress`）令 `threshold=1` 立即压缩。
- **机制**：调 `_summarize`（:264-280，LLM 摘要）→ 写一条 `role=system`、内容「【长期记忆摘要】…」、
  `compressed=True` 的**新条目**；同时把被压缩的旧条目标记 `compressed=True`。
- **关键事实：原始未被删除**——旧条目只是打 `compressed` 标记，内容仍留在 `MemoryEntry` 表
  （`recall(include_compressed=True)` 仍可取回）。即"原始永保留"天然成立，比初稿设想的设计更好。
- `_summarize` 失败返回 `None` → 跳过压缩、主流程不受影响（**非降级截断**，优于死代码）。

### 11.2 问题（仍真实存在）
1. **无保真度验证**：摘要由 LLM 直接生成，**无任何事实/实体保留率校验**（`retention_ratio` 缺失）。
   漏掉约束/偏好/决策（§6 记忆命根子）不可检测——"高无损"仍是注释口号。
2. **压缩后旧事实默认不可见**：`build_context`（:327-399）把 compressed 摘要进「长期记忆」，
   未压缩旧条目被挤出近期窗口；除非显式 `recall(include_compressed=True)`，否则旧事实不进上下文。
3. **跨 Agent 隔离靠 `agent_name`**：API 默认 `agent="default"`（memory.py:27 等），同用户若都用
   默认名会混；但 `run_single`（:185）实际用真实 `agent.name` 或 `__global__`，任务链路不混，
   仅「手动调 API 不传 agent」会落到 default——**中等风险**。
4. **摘要可能含 PII**：对话里的密钥/邮箱/手机号会进摘要（§16 脱敏待做）。

### 11.3 推荐结论（真·无损 = 原始已天然保留 + 摘要可验证）
1. **原始保留已达标**：DB 中 `compressed` 标记方案天然保留原始，无需改动存储结构。
2. **加保真度校验**：压缩前后用规则抽取关键事实/实体，算 `retention_ratio`；
   低于阈值（如 < 0.9）则**放弃用摘要**（保留原始未压缩条目），并在 `/stats` 暴露 `fidelity`。
3. **压缩摘要脱敏**：摘要写入前剥离密钥/邮箱/手机号/路径（呼应 §16）。
4. **默认 agent 隔离**：API 默认 `agent` 改为按调用方上下文或强制传入，避免落到 `default` 混写。
5. **与 §14 联动**：rollback 回退的是 commit 链（DB），压缩摘要随版本管理，天然一致。

### 11.4 目标形态（草案）
```python
async def compress_now(self, user_id, agent_name) -> dict:
    raw = await self._fetch_uncompressed(user_id, agent_name, limit=20)
    summary = await self._summarize(raw)
    if summary is None:
        return {"used": False, "reason": "llm_unavailable"}
    facts_before = extract_facts(raw); facts_after = extract_facts(summary)
    ratio = len(facts_after & facts_before) / max(1, len(facts_before))
    if ratio < 0.9:                       # 不达标 → 保原始
        return {"used": False, "fidelity": ratio}
    await self._write_summary(summary, compressed=True)   # 原始保持未删
    return {"used": True, "fidelity": ratio}
```

### 11.5 待办（实现时）
- [x] 加保真度校验 `_fidelity_ratio`（关键词+实体+数字事实集，PII 不计入），低于 `COMPRESS_FIDELITY_THRESHOLD`(0.7) 放弃压缩、保留原始（`backend/app/core/memory.py` `_maybe_compress`）
- [x] `/stats` 暴露 `last_compress_fidelity`（`get_stats` 返回，单例按 `(user,agent)` 记录最近一次）
- [x] 压缩摘要脱敏 `_desensitize`（剥离邮箱/手机/身份证/API Key/链接/路径/密码，写入前调用，§16 联动）
- [ ] API 默认 `agent` 避免落到 `default` 混写（§14.2.1，单独议题）
- [x] 压缩真执行 + 原始天然保留（已具备，基于 `app/` 重核确认）

### 11.6 风险
- 保真度校验本身要成本 → 用规则抽取即可，不必每次上 LLM。
- 压缩后旧事实默认不可见 → 评估是否让 `build_context` 对高重要度 compressed 条目做召回（呼应 §6）。

---

## 12. 议题 12 议程：UI 逐板块评审（流程型）

> 用户要求（2026-07-13）：UI 要**一部分一部分来讨论**——按钮样式、位置、间距、状态反馈等，
> 确保每块都经评审且无明显问题。本节是**流程章程 + 待评审板块清单**，不一次性给结论，
> 后续每个板块单独成小节（§12.1、§12.2…）逐个击破。

### 12.1 统一评审检查表（每块都要过）
| 维度 | 关注点 |
|------|--------|
| 按钮样式 | 主/次/危险按钮一致性、圆角、hover/disabled 态、加载态(spinner) |
| 位置/布局 | 主操作是否右对齐/顶部固定、与信息层级匹配、不遮挡 |
| 间距/对齐 | 栅格对齐、留白节奏统一 |
| 状态反馈 | 成功/失败 toast、空状态、错误态、加载骨架 |
| 响应式 | 窄屏是否崩、抽屉/弹窗是否溢出 |
| 暗色/主题 | 与现有主题变量一致，无硬编码色 |
| 可达性 | 键盘可达、aria、对比度 |
| 路由/前缀 | 调用的 API 路径是否与后端匹配（见 §13.4/§14.4，路由前缀是高频坑） |

### 12.2 待评审板块清单（逐个讨论，建议顺序）
1. 登录 / 注册（邮箱验证码）
2. 对话 Chat（SSE 流式、重发、上下文）
3. 任务 / 编排 Tasks（模式选择、Auto、§8.7 工作流选择入口）
4. Agent 管理（CRUD、能力声明）
5. 技能市场 Skills（GitHub 市场、安装）
6. 数据集 Datasets（§13，CRUD/导入导出/记录）
7. 记忆 Memory（§14，commits/rollback/recall/compress、DB 持久化；v4 无图谱，UI 计划需调整）
8. 工作流 Workflow（节点编辑、§8.7）
9. 内置 IDE（远程/本地双模式）
10. 后台管理 Admin + 系统/配置/模型
11. 文件管理 Files
12. 效率测试 Efficiency（§15，速度/准确度/消耗 + 其余维度）

> 跨板块透镜：**§16 输出安全/易懂/执行透明度** 不单独成 UI 板，而是作为上述每个板块的
> 通用评审维度（尤其 Chat/任务/IDE），在 §12.x 中一并检查。

### 12.3 工作约定
- 每轮聚焦 1 个板块：先截/列现状 → 对照检查表找问题 → 给出修改方案 → 落前端代码。
- 发现跨板块共性问题（如按钮组件不统一）抽成 §12.0 公共规范。
- 每个板块结论沉淀为 §12.x，附"是否通过"。

---

## 13. 议题 13 议程：数据集真实可用性 + UI 验证

### 13.1 现状（后端 API 较完整，但需实测）
`src/ui/routers/datasets.py` 已具备：列表/详情/创建/导入(json·csv·text)/导入文件/
记录分页/追加记录/更新/删除/导出(json·csv)。底层 `src/datasets` 的 `get_dataset_manager()`。

### 13.2 待核实风险（均为"真能跑通吗"）
1. **路由前缀对齐（最高危）**：路由前缀是 `/api/datasets`（datasets.py:9），**无 `/v1`**。
   前端 `request()` 规则：路径不以 `/api/` 开头且 ≠ `/health` 时自动补 `/api/v1`。
   → 若前端写 `client.get('/datasets/list')` 会发到 `/api/v1/datasets/list` → **404**；
   必须前端写成 `/api/datasets/list` 才命中。需逐页核对 DatasetsPage 实际请求路径（§13.4）。
2. **导入解析真实性**：`import_data` 的 `auto/json/csv/text` 是否真解析正确（尤其 csv 中文、嵌套 json）。
3. **删除级联**：`delete_dataset` 是否连记录文件一起清，还是留孤儿。
4. **前端入口完整性**：DatasetsPage 是否有"创建/导入/导出/记录管理/删除"按钮且调对路径；
   导入文件用 `UploadFile`，前端是否用 `FormData` 而非 JSON。

### 13.3 建议验证步骤（实测，非空谈）
- [ ] 起后端，curl `/api/datasets/list`、`/api/datasets/create` 确认 200。
- [ ] 导出一个 csv，再 import 回来，核对记录数一致（无损往返）。
- [ ] 前端 DatasetsPage 实测：创建→导入→看记录→导出→删除，逐步截图。
- [ ] grep 前端所有 `/datasets` 调用，确认没有写成会被补成 `/api/v1/datasets` 的形式。

### 13.4 待办
- [x] **（已实测·线上可用，2026-07-13）数据集 API 正常**：`/api/v1/datasets/*` 线上返回 401
  （路由存在、仅缺登录态），前端 `datasets.ts` 调 `/datasets` 经 `client.ts:48-49` 补成
  `/api/v1/datasets` **完全匹配**。注意：本文档此前引用的 `src/ui/routers/datasets.py` 是
  **未部署的旧版**；部署代码在 `app/api/v1/datasets.py`（前缀 `/datasets`）。**无前缀 bug。**
- [ ] 实测导入导出往返无损
- [ ] DatasetsPage 全功能 UI 走查（对照 §12.1 检查表）
- [ ] 删除级联清理验证

---

## 14. 议题 14 议程：记忆回滚/删除 + 数据库持久化验证

### 14.1 现状
- **记忆层用文件系统 JSON**（非 MySQL）：`enhanced_memory.py:25-26` 的
  `VCS_DIR="./data/memory/vcs"`、`GRAPH_DIR="./data/memory/graph"` 是**相对路径**，依赖进程 CWD
  （服务器 CWD 为 `/root/ai_hubs/backend`）。
- **能力**：`MemoryVCS` 的 `commit/checkout/log/diff/delete_commit`（:128-256）；
  `MemoryGraph` 的 `add_node/delete_node/visualize`（:383-571）；
  `EnhancedMemoryManager.checkout`（:822-842）回退时 `base.short.clear()` 再重建。
- 后端路由 `memory.py` 前缀 `/api/memory`（同样的前缀对齐隐患，见 §13.4）。

### 14.2 待核实风险（"真能用吗"）
1. **相对落盘路径（高危）**：`./data/memory/...` 依赖 CWD。若以 systemd 启动且 `WorkingDirectory`
   变化，或本地 `python -m` 在不同目录跑，记忆会写到意外位置/丢失。→ 应改为基于项目根的绝对路径。
2. **session 隔离**：`session_id` 默认 `"default"`，多用户/多会话会**混写同一份 VCS/图谱**。
   需按 `user_id` 或真实 `session_id` 隔离（与 §6 记忆作用域呼应）。
3. **checkout 重建兼容性**：`checkout` 依赖 `self.base.short.clear()/add()`，若 `base` 的实现
   不含这两个方法会崩；且重建后是否同步图谱未定义。
4. **删除级联**：`delete_commit` 删文件+改 index，但图谱节点不联动；`delete_node` 不影响 VCS。
5. **compress 是 no-op（见 §11.2）**：`/compress` 返回摘要但不改变记忆，UI 点了"无变化"。
6. **数据库层**：tasks/agents/datasets 走 MySQL（ai_hubs 库）；记忆走 JSON 文件——两套持久化，
   备份/迁移策略不一致，需明确。

### 14.3 建议验证步骤（实测）
- [ ] 后端起在服务器 CWD 下，调 `/api/memory/vcs/commit` 然后 `checkout`，确认短期记忆回退成功。
- [ ] 测 `delete_commit` / graph `delete_node`，确认文件与 index 真删除、不残留。
- [ ] 确认多用户不会踩同一个 `default` session（构造两个会话验证隔离）。
- [ ] 前端 Memory 页实测：commit/log/checkout/diff/图谱可视化 按钮是否调对 `/api/memory/*`。
- [ ] 核查 `./data/memory` 是否真落在预期目录，建议改为绝对路径（配置驱动）。

### 14.4 待办
- [ ] 记忆落盘路径改为绝对路径（BASE_DIR/config），消除 CWD 依赖
- [ ] session 按 user/session 隔离（呼应 §6）
- [ ] checkout 重建与图谱同步；删除级联一致性
- [ ] 修复 §11 的 compress no-op，否则 UI "压缩"无效
- [x] **（已实测·线上可用，2026-07-13）记忆 API 正常且实现优于初稿描述**：线上
  `/api/v1/memory/{stats,commits,rollback,recall,context,compress,rag/retrieve}` 全部存在（401）；
  前端 `MemoryPage.tsx:78-136` 调的正是 `/memory/{stats,commits,rollback,compress,...}`，**前后端匹配**。
  真实实现（`app/api/v1/memory.py` + `app/core/memory/memory_manager`）是 **DB 持久化 + 按 `current_user.id`
  隔离 + 真回退（`/rollback`，git reset 式保留历史）+ 真压缩（`compress_now` 返回 commit）**——
  **不**存在初稿说的"JSON 依赖 CWD / session 默认 default / compress 是 no-op"。初稿结论基于未部署的
  `src/memory/enhanced_memory.py`（死代码），**需以 `app/` 重核（见文首基线警告）**。
- [ ] 明确 MySQL vs JSON 两套持久化的备份/迁移策略（线上记忆已走 MySQL，旧 `src/` JSON 方案为死代码）

---

## 15. 议题 15 议程：效率测试板（速度 / 准确度 / 消耗 + 其余维度）

### 15.1 现状
- 当前**没有系统化效率测试**：`metrics.py` 只在会话内采集 token/延迟/工具调用（§10 A），
  未落库、未聚合、无跨模式对比；`PeerReviewManager` 仅对单次产出评审（§10 C）；
  `datasets` 模块存在但无 eval harness 接入（§13）。
- 即：能跑任务，但**无法量化"哪种模式/Agent/模型更快、更准、更省"**，也无法回归追踪。

### 15.2 用户指定三维 + 补充维度
用户明确要测 **速度 / 准确度 / 消耗**。从 §9（成本）、§10（评估）、§11（忠实度）、§4（异步）、
§9（动态协调）延伸，建议补以下维度，构成完整效率画像：

| 维度 | 指标 | 关联章节 |
|------|------|----------|
| **速度 Speed** | 首 token 延迟、端到端总延迟、吞吐(tokens/s)、按模式/任务拆分；并发加速比（asyncio，§4） | §4 |
| **准确度 Accuracy** | 任务完成度、忠实度/无幻觉（§11 `fidelity`）、对 golden set 命中率、`QualityScorer` 多维评分（§5/§10） | §5 §10 §11 |
| **消耗 Consumption** | in/out token、API 调用次数、工具调用次数、$ 成本（PRICING，§10 A）、**每正确回答的单位成本** | §10 |
| **可靠性 Reliability**（补） | 成功率 / 错误率 / 重试率 / 超时率；同一用例多次运行的方差 | §10 |
| **协调效率 Coordination**（补） | 实际轮次 vs `max_rounds`（§9 动态终止省下的轮次）、提前终止率 | §9 |
| **资源/压缩 Resource**（补） | 峰值内存、上下文长度、压缩比（§11） | §11 |
| **可扩展性 Scalability**（补） | N-agent 下时延/成本增长曲线（线性？爆炸？） | §4 §8 |
| **回归 Regression**（补） | 跨版本/提交对比同一用例的分数变化（§10 C） | §10 |

### 15.3 推荐结论（效率测试板 = UI 入口 + 测试 harness）
1. **复用而非重造**：底层直接复用 §10 的 `CostLedger`（消耗）/
   `QualityScorer`（准确度）/ eval harness（回归），避免三套实现。
2. **测试用例来源**：复用 §13 的 `datasets` 作为 golden/基准集（标注「是否为评测集」）。
3. **运行方式**：选「模式×Agent×模型」组合 × 选数据集 → 批量跑 → 自动采集 metrics（落库，§10 A）。
4. **展示（效率测试板 UI，§12.12）**：
   - 对比表/排行榜：速度/准确度/消耗多维排序，可勾选维度加权；
   - 趋势图：同用例跨时间/版本的变化；
   - 可导出报告（json/csv，复用 §13 导出）。
5. **与动态协调联动**：跑 §9 的协调任务时记录「实际轮次」，验证动态终止是否真省轮次/省成本。

### 15.4 目标形态（草案）
```python
@dataclass
class BenchReport:
    case_id: str; mode: str; model: str
    latency_s: float; ttft_s: float; throughput: float
    accuracy: float; fidelity: float          # §11
    in_tokens: int; out_tokens: int; cost_usd: float; api_calls: int
    success: bool; rounds_used: int|None      # §9
    # ... Scalability / Regression 由聚合层计算

class EfficiencyBoard:
    def run(self, combos, dataset_ids) -> list[BenchReport]: ...
    def leaderboard(self, by: str = "accuracy") -> list[dict]: ...
```

### 15.5 待办
- [ ] 效率测试板 UI（§12.12）：组合选择 + 运行 + 对比表/排行榜 + 报告导出
- [ ] 测试用例接入 `datasets`（标注评测集）
- [ ] 复用 `CostLedger` 落库消耗、`QualityScorer` 评准确度（§10）
- [ ] 采集 Speed 全指标（ttft/总延迟/吞吐/并发加速比）
- [ ] 采集 Reliability（成功率/方差）、Coordination（实际轮次）、Resource（压缩比）
- [ ] 跨版本 Regression 对比视图（§10 C）

### 15.6 风险
- 准确度需 golden 标注，冷启动可先用 `QualityScorer` 自动分 + 人工抽检。
- 跑全组合成本高 → 测试板支持「抽样/限量」与「仅跑变更组合」。
- 速度指标受网络/并发干扰 → 同环境多次取中位数，报告标注方差（Reliability）。

---

## 16. 议题 16 议程：AI/任务输出的安全性、易懂性、执行透明度

### 16.1 用户诉求（2026-07-13）
输出要检查三件事：
1. **安全性**：AI 输出 / 任务产物不含敏感、违规、注入残留内容；压缩摘要不泄露隐私（呼应 §10 L2/L3、§11）。
2. **易懂性**：面向用户的语言、结构清晰、不过度技术黑话；压缩摘要可读（§11）；多 Agent 协作结果不堆砌原始文本。
3. **执行透明度**：是否实时展示"AI 当前在做什么"——**已调用 xxx API、已读/写/修改哪些文件**（"显示当前执行生成和修改的文件"）。避免黑箱。

### 16.2 现状（部分已核，基于 `app/` 重核 2026-07-13）
- **安全性**：仅 IP 限频 + 工具沙箱（§10 B）；**输出无内容审核、无注入残留清洗**；压缩摘要可能把
  对话里的密钥/PII 带进长期记忆（§11.2.4），脱敏待做。
- **易懂性**：多 Agent 协作结果是各 Agent 原始输出拼接（`run_sequential`/`run_parallel` 用 `---` 分隔，
  orchestrator.py:344/378），**未做"给用户看的总结"**；压缩摘要已写入记忆但 Chat 不直接展示原文摘要。
- **执行透明度（已核·较强）**：
  - 聊天：`chat.py` SSE 下发 `tool_start/tool_result/ui_action`，前端渲染 `role==='tool'` → "已调用 xxx API" 已有。
  - **任务产出文件后端已收集**：`orchestrator.py` 的 `_snapshot_workspace`（:69-78）执行前拍快照、
    `_collect_output_files`（:81-118）+ `_OUTPUT_EXTENSIONS`（:52-55）执行后比对，把**新增/修改文件**
    （path/name/size/is_new/ext）写入 `task.metadata_["output_files"]`（:945-949）→ "显示生成/修改的文件"**后端机制已有**，
    待前端 TasksPage/TaskDrawer 在任务详情展示并可点开下载。
  - 缺口：①文件改动**仅在任务结束时收集**，运行中实时"正在写 xxx 文件"未下发（tool 事件只带工具名，
    未结构化带文件路径）；②危险操作确认态未在轨迹标注（§7）。

### 16.3 推荐结论
1. **安全性**：接入 §10 的 L2 内容护栏（可选/默认关）+ L3 Blackboard 写入前注入扫描；压缩/摘要前加
   **敏感信息脱敏**（呼应 §11，剥离密钥/邮箱/手机号/路径后再压缩）。
2. **易懂性**：分离"用户态输出"与"原始轨迹"——给用户的是结构化、可读的总结
   （复用 §5 Gate-2 / §10 QualityScorer 做可读性校验）；原始多 Agent 文本进 Blackboard/日志，不直接抛给用户。
3. **执行透明度（重点）**：
   - 后端在 SSE 流中下发结构化事件：`tool_call{name,args}`、`file_write{path}`、`file_read{path}`、
     `step{desc}`、`final`。
   - 前端 Chat/任务页渲染"**执行轨迹**"面板（时间线/步骤条），展示调用了哪些 API、生成/修改了哪些文件，
     **可展开详情、可点开文件**。
   - 危险操作（§7）在轨迹里标注"已请求确认 / 已批准"。
4. 与 §12 联动：透明度面板作为 Chat/任务/IDE 板块的**通用组件**（§12 跨板块透镜）。

### 16.4 待核
- [x] **（已核）聊天透明度基本具备**：chat SSE 下发 `tool_start/tool_result/ui_action`，前端渲染 tool 消息。
- [ ] 文件级透明度：tool 事件是否带出"生成/修改的文件路径"，WorkspacePage/IDE 是否展示、可点开
- [ ] 任务编排（TaskDrawer/TasksPage）是否展示文件改动轨迹（当前仅 `sequential_step` 等）
- [ ] 压缩摘要是否脱敏、是否对用户可见（§11）

### 16.5 待办
- [ ] 输出内容安全护栏（L2/L3，§10）
- [ ] 压缩/摘要脱敏（§11）
- [ ] 用户态输出 vs 原始轨迹分离 + 可读性校验
- [ ] SSE 下发 tool/file 事件 + 前端轨迹面板（通用组件）
- [ ] 危险操作在轨迹中标注确认状态（§7）

### 16.6 风险
- 透明度事件过多会刷屏 → 默认折叠、可展开；危险/文件改动高亮。
- 脱敏可能误伤正常内容 → 用保守规则（密钥/邮箱/手机号/路径），可配置。

---

## 附录：SOTA 参考框架
- LangGraph：`StateGraph`（跨节点 TypedDict 状态）+ `SupervisorAgent`/`Swarm`（结构化 handoff）
- AutoGen：`GroupChatManager`（共享 ChatHistory）+ 动态子 Agent
- CrewAI：`Crew` + `Task.output_pydantic`（结构化输出契约）
- Semantic Kernel：`ChatHistory` 共享
- 协议层：MCP（工具发现/调用）、A2A（Agent 间能力发现）
- 记忆层：Mem0 / Letta(MemGPT) 事件→事实→摘要三层；LangChain SummarizationMixin

---

## 17. 附录：v4 重核结论速查（对照真实 `backend/app/`，2026-07-13）

> 本节是 #1–#9、#12、#15 的**权威结论**。正文 §2–§10、§12、§15 仍保留初稿的 v3 `src/` 描述（已遗弃死代码），
> 仅作历史参考，**一切以本节 + §11/§14/§16 的真实代码核查为准**。证据均来自只读核查的 file:line。

### 17.1 议题 #1 共享状态 / Blackboard — ✅ 成立（措辞待修）
- **v4 现实**：Agent 间无 Blackboard/共享结构化状态；上下文靠 orchestrator 在 Python 层把上一步**纯文本**拼进下一步 prompt（`orchestrator.py:332-344` sequential、`359-378` parallel、`539-576` run_custom、`514-537` run_swarm）。
- 唯一"共享结构"是记忆，但按 `(user_id, agent_name)` 分区（`memory.py:110-131`）；`config_mode="global"` 的 Agent 共用 `"__global__"` 键（`orchestrator.py:185`），属被动共享历史，非协作黑板。
- **修正**：正文"完全无共享"改为"缺共享黑板/结构化通道（成立），但记忆已版本化且 global 模式被动共享同一键"。

### 17.2 议题 #2 记忆隔离 — ✅ 部分成立
- **v4 现实**：默认按 `(user_id, agent_name)` 隔离且**落库**（DB），非 v3 内存态（`memory.py:145-187, 358-392, 396-468`）；`__global__` 模式使多个 global Agent **共享**同一记忆命名空间（`orchestrator.py:185`）。
- **修正**：正文"per-Agent 完全独立"改为"默认隔离且落库；global 模式共享 `__global__`（混写风险点）"。

### 17.3 议题 #3 工具共享 — ❌ 已被推翻（重写）
- **v3 称**：`get_registry()` 全局单例、所有 Agent 看到全部工具（过度共享）。
- **v4 现实**：**无 `get_registry()` 单例、无 per-Agent `tools` 属性**（Agent 模型只有 `skills`，`models/agent.py`）。工具是模块级常量 `TOOL_DEFINITIONS`（`tools.py:35-204`）；代码执行类工具按 Agent `skills` 隔离（`should_enable_code_tools`，`tools.py:501-509`，chat 路径 `chat.py:414-421`）；仅任务路径统一注入全部工具（`orchestrator.py:279-286`）。
- **修正**：改为"工具为共享标准常量集，代码类工具可用性由 Agent `skills` 控制，不再是全员无差别可见"。

### 17.4 议题 #4 模式检测 — ❌ 已被推翻（重写）
- **v3 称**：`ModeDetector` 关键词计分、LLM 分配器默认关闭。
- **v4 现实**：**无 `ModeDetector` 类**（`search_file` 0 命中）。模式来自 `task.mode` 字段（`orchestrator.py:870` + `MODE_RUNNERS` 映射 `:839-849`）；仅 `auto` 模式做自动选择，且是"AI 任务分析 + 关键词/阈值启发式"，**只覆盖 single/sequential/parallel 三种**（`run_auto :715-836`，启发式 `:777-788`）；LLM 分配器（`assignment="ai"`）**默认可用**。

### 17.5 议题 #5 并行 asyncio — ❌ 已被推翻（重写）
- **v3 称**：`_execute_parallel` 用 `threading.Thread`。
- **v4 现实**：纯 `asyncio.gather` 异步并发（`orchestrator.py:366`，`run_parallel :347-378`；hierarchical 内 `:490`）。无任何 `threading`。

### 17.6 议题 #6 结构化契约 — ✅ 成立
- **v4 现实**：`run_custom`（v4 对应"流水线"，`:539`）阶段间是纯文本 `context` 字符串接力（`context = out` → `prompt = f"{context}\n\n{suffix}"`，`:551-573`），无结构化 dict/契约。阶段格式为自由文本 `"agent:key:suffix"`（`:555-558`）。**正文引用的 `run_pipeline`/`_execute_pipeline`(orchestrator.py:754) 是 v3 死代码行号，应改指 `run_custom`**。

### 17.7 议题 #7 流水线质量门控 — ✅ 成立
- **v4 现实**：`run_custom` 线性串接、阶段间**无任何** review/quality/gate 逻辑（全文件搜 `review|quality|gate|评审|门控` = 0 命中）。正文结论成立；行号同样应改指 `run_custom`。

### 17.8 议题 #8 实时协调 — ❌ 已被推翻（重写）
- **v3 称**：`communication.py` 四个 Manager、轮询式非动态。
- **v4 现实**：**无 `communication.py`、无四个 Manager 类**。协作是 orchestrator 内**同步 async 函数**调用（`run_debate :381-422`、`run_vote :425-450`、`run_hierarchical :453-498`、`run_swarm :501-536`），靠把上下文拼进 prompt；"实时/事件"是 SSE 事件流（`_emit_event :121-150` → `asyncio.Queue`），用于推前端进度，非 Agent 间协调。`peer_review`/`round_table` 在 v4 **无对应实现**。

### 17.9 议题 #9 评估/护栏/成本 — ✅ 部分成立
- **v4 现实**：**无 `metrics.py`/`MetricsCollector`**（0 命中）。token 用量是**字符估算** `_estimate_tokens`（`memory.py:41-45`，非真实 usage；`llm.py:181-183` 只取 `delta.content`），且**仅聊天路径**有 user 级配额护栏（`chat.py:260-268`，`models/user.py:19,38-51`）；**任务路径不计入配额**（`tasks.py` execute_task 无配额逻辑）。无 $ 单价、无 agent/task/mode 成本归因（`models/conversation.py:53` 仅 conversation 级）。资源级护栏有（沙箱 500MB `ide.py:35`、上传限制 `knowledge.py:292`），无 AI 内容级护栏。
- **修正**：正文"全内存态未落库"改为"已落库但用字符估算 token、无真实成本；仅 user 级配额护栏且任务路径不计入"。

### 17.10 议题 #12 UI 评审 — ✅ 重核（含真实缺口）
- **API 前缀隐患已治理**：所有请求经 `client.ts:47-50` 自动补 `/api/v1`，后端 `main.py:92` 统一前缀；v3 的裸写 `/skills` 缺前缀 404 在 v4 **已根除**（如 `MemoryPage.tsx` 直接写 `/memory/stats` 走封装正确）。
- **真实 UI 缺口（待修）**：
  1. 死组件 `CombinedPage.tsx` 从未被 import/注册（遗留死代码）。
  2. **split 布局下 `/workspace` 入口不可达**：`Sidebar.tsx:51` 用 `splitItems` 替换了 `/workspace`（`Sidebar.tsx:32-34`），但该路由与 `WorkspacePage` 已实现（`router.tsx:48`）——可达性缺口。
  3. ChatPage 斜杠命令 `navMap`（`ChatPage.tsx:150-154`）与自动补全词池（`:280-286`）缺 `/knowledge`、`/workflow`、`/workspace` 映射，与侧边栏不对称。
  4. 按钮主/次样式有统一约定（`AgentsPage.tsx:213,275,382` 等），抽样未发现明显漂移，需逐页确认。

### 17.11 议题 #15 效率测试板 — ❌ 确认缺失（真实缺口）
- **现状**：仅有计数型仪表盘（`dashboard.py:21` 返回 agents/running_tasks/memory_entries/datasets；`admin.py:36-90` 返回各 total）+ user 级 token 配额条（`Sidebar.tsx:140-152`）。**无任何**速度/延迟/准确度/cost 效率/可靠性/回归的 benchmark 代码或面板（搜 `*benchmark*` = 0；`main.py:137` 放行 `/metrics` 但无实现）。
- **结论**：#15 议题准确，属待建项。

### 17.12 用户拍板落地清单（实时更新，2026-07-13 起 · 原则：往高质量做，被推翻/有缺口的议题真实现而非仅改文档）

| 议题 | 重核结论 | 用户决策（往高质量做） | 落地状态 |
|---|---|---|---|
| #1 | 缺主动 Blackboard（成立，记忆已版本化） | 真实现 Blackboard 结构化共享状态 | ✅ 已实现（`app/core/blackboard.py`：public/private 分区 + 能力访问控制 + MODE_TOPOLOGIES；`run_custom` 写结构化产出到黑板供下游取用） |
| #2 | global/default 记忆混写风险（部分成立） | 修 global/default 记忆混写：global 键按 user_id 分区、默认 agent 名拒绝 default/强制唯一 | ✅ 已实现（保留名校验防混写；global 键经核已按 user 隔离，加注释明确） |
| #3 | 任务路径缺 skill gate（被推翻重写） | 全可见+skill 限调用+prompt 约束；任务路径补 skill gate（与 chat 一致） | ✅ 已实现（get_enabled_tools 按 skills 过滤代码类工具；run_single 按 skills 注入/撤回代码能力提示） |
| #4 | auto 仅覆盖 3/8 模式（被推翻） | 增强 auto：LLM 分配器覆盖全部 8 种模式 | ✅ 已实现（`run_auto`：`_heuristic_mode` 关键词启发式 + `_allocate_mode_by_ai` LLM 分配器，覆盖 single/sequential/parallel/debate/vote/hierarchical/swarm/peer_review/round_table；<20字快路径走 single） |
| #5 | 已是 asyncio（被推翻） | 加 asyncio.Semaphore 并发限流 + 单 Agent 失败隔离容错 | ✅ 已实现（MAX_PARALLEL_AGENTS=5；run_parallel + hierarchical workers 限流+容错） |
| #6 | 纯文本接力缺结构化契约（成立） | 实现结构化契约（阶段 I/O 走 dict/JSON schema，下游按字段取用，失败可校验/重试） | ✅ 已实现（`app/core/contracts.py`：extract_structured/validate_contract/format_for_next；`run_custom` 每阶段可 `@schema=Name`，解析失败重试 1 次，降级文本接力） |
| #7 | 流水线无阶段间门控（成立） | 实现阶段间质量门控（每阶段后自动评审达标才进下一阶段，不达标重试/回退/告警），与 #6 联动 | ✅ 已实现（Gate-1 结构化校验 + Gate-2 `QualityScorer`；`strict_mode` 任务级开关：低于阈值重试 1 次；事件流可见 custom_gate_retry/warn） |
| #8 | 无 communication.py，同步 async+SSE（被推翻） | 补 peer_review/round_table 协作模式（缺失）+ 增强动态协调（中间评审/仲裁步骤，与 #7 门控呼应） | ✅ 已实现（`app/core/collab.py`：run_peer_review / run_round_table，复用 Blackboard + `_converged` 动态终止；已注册进 MODE_RUNNERS 与 `/tasks/modes`） |
| #9 | 字符估算 token、任务路径不计配额（部分成立） | 4 项全做：①真实成本追踪(llm.py 读真实 usage+按 user/agent/task/mode 归因落库) ②任务路径纳入配额护栏 ③AI 内容级护栏 ④系统级评估 | ✅ ①②③已实现（llm.py 读真实 usage + chat/task 路径真实扣减；任务路径配额护栏与 chat 一致；`app/core/guardrails.py` L2 内容标记 + L3 注入清洗，默认 warn-by-default）；④系统级评估由议题 #15 效率测试板承载（采集层已落地） |
| #10 | 压缩保真+脱敏（已实现） | ✅ 已落地（app/core/memory.py） | ✅ 完成 |
| #11 | workflows 后端空壳（已确认） | 工作流真正执行（接入 run_custom 链路，复用 #6 结构化契约+#7 门控）+ 接入 Auto 路由与手动选择入口 | ✅ 已实现（`app/core/workflow_runner.py` 拓扑遍历 WorkflowNode[]/edges，复用 Blackboard；`workflows.py` 真正建 Task 并 `execute_task`；`run_workflow` 注册进 MODE_RUNNERS 与 `/tasks/modes`） |
| #12 | UI 三缺口（/workspace 不可达、斜杠命令缺项、死组件） | 修 3 缺口+逐页 UI 一致性评审（**UI 部分另开一次任务做**，本轮仅记录决策） | 📌 待实现（UI 专项） |
| #13 | 数据集路由对齐 | 数据集+知识库(RAG)端到端核通核查：能导入、RAG 搜索真生效、上传真存入、两者实现真实且无混乱（代码不串味） | ✅ 已核查（`knowledge.py` 走 `src.rag.knowledge_base` ChromaDB 真实上传/搜索/向量清理；`datasets.py` 真实 CRUD+record 级联；两者无串味） |
| #14 | 记忆回滚已可用（剩余：default 混写、缺单条删除、UI 去图谱） | 补单条记忆删除端点(API+服务层)+修 UI"图谱可视化"误导(改关键词索引)；default 混写已并入 #2 | ✅ 已实现（`memory.py` 新增 `delete_entry` 单条删除；`api/v1/memory.py` 新增 `DELETE /memory/entries/{entry_id}`）；UI 去图谱误导并入 #12 UI 专项 |
| #15 | 效率测试板缺失 | 建效率测试板：benchmark harness(速度/准确度/消耗+可靠性/协调效率/可扩展性/回归)+前端面板；与 #9 成本追踪共用采集层 | ✅ 后端已实现（`app/core/metrics_collector.py` 真实记录延迟/消耗/成本/成功/轮次 + `api/v1/efficiency.py` 提供 `/efficiency/reports`、`/efficiency/summary` 聚合）；前端面板待建 |
| #16 | 安全/透明度（后端已收集产出文件） | 增强透明度UI(友好层、不暴露内层实现)+输出易懂性+精确文件展示(仅本次修改/输出文件,**不**dump整个workspace)；工作区约束：远程模式输入落到服务器对应 `DATA_DIR/ide_workspace/{user_id}` **非根目录**、AI临时执行文件用后清理避免臃肿 | 📌 部分实现（后端安全/透明度已落地：guardrails.py L2/L3 护栏、`_collect_output_files` 精确产出收集、sandbox 工作区隔离+临时文件清理；透明度 UI 友好层/精确文件展示并入 #12 UI 专项） |

> 落地状态图例：✅ 完成 / 📌 待实现（已拍板）/ ⏳ 讨论中（未拍板）。

### 17.13 技术待办（文档与代码收尾，独立于上表决策）
- [ ] 正文 §2–§10、§12、§15 全面改写，去掉 v3 `src/` 引用、改指 `run_custom`/`orchestrator.py` 真实行号（执行纪律声明要求）
- [ ] #8 协调：文档重写（同步 async 函数 + SSE，无 communication.py）
- [ ] #12：修 split 布局 /workspace 入口；补齐 ChatPage 斜杠命令映射；删除/复用 CombinedPage
- [ ] #15：建效率测试板（benchmark harness + 前端面板）
