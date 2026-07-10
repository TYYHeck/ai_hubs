# -*- coding: utf-8 -*-
"""
Agent 间通信增强 —— 高级协作模式

新增模式:
  1. DEBATE  — 辩论模式：正反方辩论 + 投票裁决
  2. PEER_REVIEW — 同行评审：链式思考 + 互相审查
  3. HIERARCHICAL — 层级决策：专家提议 → 经理评审 → 总监决策
  4. ROUND_TABLE — 圆桌会议：多轮自由讨论 + 共识追踪

与 Orchestrator 集成:
  通过 Orchestrator.execute(mode=ExecutionMode.DEBATE) 使用
  或通过原有的 collaborative 模式自动升级（配置 rounds > 2 时）
"""

from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable, Optional
import threading
import logging

logger = logging.getLogger("ai_hubs.communication")


@dataclass
class DebateTurn:
    """辩论的一轮发言"""
    speaker: str
    side: str           # "pro" / "con" / "moderator"
    statement: str
    timestamp: datetime = field(default_factory=datetime.now)


@dataclass
class DebateResult:
    """辩论结果"""
    topic: str
    turns: list[DebateTurn] = field(default_factory=list)
    pro_score: float = 0.0
    con_score: float = 0.0
    winner: str = ""                    # "pro" / "con" / "tie"
    final_verdict: str = ""
    key_arguments: list[str] = field(default_factory=list)


@dataclass
class PeerReviewResult:
    """同行评审结果"""
    original_work: str = ""
    reviews: list[dict] = field(default_factory=list)     # [{reviewer, score, feedback, issues}]
    revised_work: str = ""
    final_score: float = 0.0
    approved: bool = False


@dataclass
class RoundTableResult:
    """圆桌会议结果"""
    topic: str = ""
    rounds: list[list[dict]] = field(default_factory=list)  # [[{speaker, text}], ...]
    consensus_points: list[str] = field(default_factory=list)
    disagreements: list[str] = field(default_factory=list)
    final_summary: str = ""


# ============================================================
# 1. 辩论模式
# ============================================================

class DebateManager:
    """
    辩论模式：
      1. 主持人定义辩题和分析框架
      2. 正方 Agent 陈述观点
      3. 反方 Agent 陈述观点
      4. 双方自由辩论（反驳 + 补充论据，多轮）
      5. 各 Agent 投票 + 主持人裁决
    """

    DEBATE_PROMPT = """你参与一场正式辩论，辩题如下：

【辩题】{topic}

【你的立场】{side}方
{role_instruction}

【辩论规则】
- 第 1 轮：双方各自陈述核心观点（不超过 3 个论点，每个论点附事实/推理支持）
- 第 2 轮：针对对方观点进行反驳，同时强化己方论点
- 第 3 轮：自由辩论，回应对方的质疑，补充新的论据
- 最后：请用「我方关键论点:」开头总结你的核心立场

请用中文，逻辑严密，用事实说话。"""

    VOTING_PROMPT = """你作为辩论的评审，辩题如下：

【辩题】{topic}

【辩论记录】
{transcript}

请完成以下工作：
1. 分别点评正方和反方的核心论据质量（逻辑性、事实支撑、说服力）
2. 给双方打分 (1-10 分):
   - 正方得分: X
   - 反方得分: Y
3. 宣布获胜方并说明理由
4. 给出最终建议

请以 JSON 格式输出：
```json
{{
    "pro_score": 8.5,
    "con_score": 7.0,
    "winner": "正方",
    "key_arguments": ["核心论据1", "核心论据2"],
    "verdict": "裁决理由..."
}}
```"""

    @classmethod
    def run(
        cls,
        topic: str,
        pro_agents: list,          # AgentProxy 列表
        con_agents: list,          # AgentProxy 列表
        moderator_agent,           # 主持人 AgentProxy
        task,
        on_progress: Callable | None = None,
        rounds: int = 2,
        run_agent_fn: Callable | None = None,  # 注入 Agent 执行函数
    ) -> DebateResult:
        """
        执行辩论流程。

        Args:
            topic: 辩题
            pro_agents: 正方 Agent 列表
            con_agents: 反方 Agent 列表
            moderator_agent: 主持人 Agent
            task: Task 对象
            on_progress: 进度回调
            rounds: 辩论轮次 (每轮双方各发言一次)
            run_agent_fn: (agent_proxy, task, prompt) -> str
        """
        result = DebateResult(topic=topic)

        def emit(stage, info):
            if on_progress:
                try:
                    on_progress(stage, info)
                except Exception:
                    pass

        # 选择发言人（每方取第一个，如需更多可扩展）
        pro_speaker = pro_agents[0] if pro_agents else None
        con_speaker = con_agents[0] if con_agents else None

        if not pro_speaker or not con_speaker:
            result.winner = "tie"
            result.final_verdict = "辩论双方不完整，无法进行。"
            return result

        # --- 第 1 轮：双方陈述观点 ---
        emit("debate_opening", {"round": 1, "phase": "正方陈述"})
        pro_opening_prompt = cls.DEBATE_PROMPT.format(
            topic=topic,
            side="正",
            role_instruction=("你是正方。你的任务是从正面论证辩题的合理性、必要性和优势。"
                              "请列出 2-3 个核心论点，每个配以事实或推理支撑。"),
        )
        pro_opening = run_agent_fn(pro_speaker, task, pro_opening_prompt) if run_agent_fn else ""
        result.turns.append(DebateTurn(speaker=pro_speaker.name, side="pro", statement=pro_opening))

        emit("debate_opening", {"round": 1, "phase": "反方陈述"})
        con_opening_prompt = cls.DEBATE_PROMPT.format(
            topic=topic,
            side="反",
            role_instruction=("你是反方。你的任务是质疑和反驳正方观点，指出论题的风险、缺陷和代价。"
                              "请列出 2-3 个核心反对论点，每个配以事实或推理支撑。"),
        )
        con_opening = run_agent_fn(con_speaker, task, con_opening_prompt) if run_agent_fn else ""
        result.turns.append(DebateTurn(speaker=con_speaker.name, side="con", statement=con_opening))

        # --- 第 2 轮 + 自由辩论 ---
        for r in range(2, rounds + 1):
            # 构建辩论记录摘要
            transcript_summary = cls._build_transcript(result.turns)

            emit("debate_rebuttal", {"round": r, "phase": "正方回应"})
            pro_rebuttal_prompt = (
                f"【辩题】{topic}\n\n"
                f"【你的身份】正方辩手\n\n"
                f"【辩论记录摘要】\n{transcript_summary}\n\n"
                f"这是第 {r} 轮辩论。请直接回应反方上一轮的质疑，"
                f"补充新的论据支持己方观点。如有需要，指出对方论证的漏洞。"
                f"用中文，简洁有力。"
            )
            pro_rebuttal = run_agent_fn(pro_speaker, task, pro_rebuttal_prompt) if run_agent_fn else ""
            result.turns.append(DebateTurn(speaker=pro_speaker.name, side="pro", statement=pro_rebuttal))

            emit("debate_rebuttal", {"round": r, "phase": "反方回应"})
            con_rebuttal_prompt = (
                f"【辩题】{topic}\n\n"
                f"【你的身份】反方辩手\n\n"
                f"【辩论记录摘要】\n{transcript_summary}\n\n"
                f"正方刚才说:\n{pro_rebuttal[:500]}\n\n"
                f"这是第 {r} 轮辩论。请针对正方最新观点进行有力反驳，"
                f"强化你的反对立场。用中文，简洁有力。"
            )
            con_rebuttal = run_agent_fn(con_speaker, task, con_rebuttal_prompt) if run_agent_fn else ""
            result.turns.append(DebateTurn(speaker=con_speaker.name, side="con", statement=con_rebuttal))

        # --- 投票裁决 ---
        emit("debate_voting", {"phase": "投票裁决"})
        transcript = cls._build_transcript(result.turns, full=True)
        voting_prompt = cls.VOTING_PROMPT.format(topic=topic, transcript=transcript)

        if moderator_agent:
            verdict_text = (run_agent_fn(moderator_agent, task, voting_prompt) if run_agent_fn else "")
        else:
            # 没有主持人，让正方 Agent 做公正裁决
            verdict_text = (run_agent_fn(pro_speaker, task,
                            f"作为公正的评审，请对以下辩论做出裁决:\n\n{voting_prompt}")
                            if run_agent_fn else "")

        # 解析裁决
        import json
        import re
        json_match = re.search(r'\{[\s\S]*\}', verdict_text) if verdict_text else None
        if json_match:
            try:
                verdict = json.loads(json_match.group())
                result.pro_score = float(verdict.get("pro_score", 5))
                result.con_score = float(verdict.get("con_score", 5))
                result.winner = verdict.get("winner", "平局")
                result.key_arguments = verdict.get("key_arguments", [])
                result.final_verdict = verdict.get("verdict", verdict_text)
            except (json.JSONDecodeError, ValueError):
                result.final_verdict = verdict_text or "裁决解析失败"
        else:
            result.final_verdict = verdict_text or "未能获取裁决结果"

        if result.pro_score > result.con_score:
            result.winner = "正方"
        elif result.con_score > result.pro_score:
            result.winner = "反方"
        else:
            result.winner = "平局"

        emit("debate_complete", {
            "winner": result.winner,
            "pro_score": result.pro_score,
            "con_score": result.con_score,
        })

        return result

    @staticmethod
    def _build_transcript(turns: list[DebateTurn], full: bool = False) -> str:
        """构建辩论记录文本"""
        lines = []
        for t in turns:
            side_label = "正方" if t.side == "pro" else "反方"
            content = t.statement if full else t.statement[:300]
            lines.append(f"【{side_label} - {t.speaker}】\n{content}\n")
        return "\n".join(lines)


# ============================================================
# 2. 同行评审模式
# ============================================================

class PeerReviewManager:
    """
    同行评审模式：
      1. 执行者 Agent 完成工作
      2. 多个评审者 Agent 独立评审（打分 + 提改进建议）
      3. 执行者根据评审意见修改
      4. 评审者再次确认
      5. 通过 / 驳回
    """

    REVIEW_PROMPT = """你正在进行同行评审。请审阅以下工作成果：

【原始任务】{task_description}

【工作成果】
{work_result}

请从以下维度评审（每项 1-10 分）：
1. 准确性：内容是否正确、无事实错误
2. 完整性：是否覆盖了任务的各个方面
3. 清晰度：表达是否清晰、结构是否合理
4. 实用性：是否可直接使用、有可操作性

请按 JSON 格式输出：
```json
{{
    "accuracy": 8,
    "completeness": 7,
    "clarity": 9,
    "practicality": 8,
    "total_score": 8.0,
    "strengths": ["优点1", "优点2"],
    "issues": ["问题1", "问题2"],
    "suggestions": ["改进建议1", "改进建议2"],
    "overall_feedback": "总体评价..."
}}
```"""

    REVISE_PROMPT = """你之前完成了以下工作，现在收到了同行评审意见。请根据反馈修改你的工作。

【原始任务】{task_description}

【你之前的成果】
{original_work}

【评审意见】
{review_feedback}

请修改你的成果，解决评审中提出的问题。用中文输出修改后的完整内容。"""

    @classmethod
    def run(
        cls,
        task_description: str,
        executor_agent,           # 执行者 AgentProxy
        reviewer_agents: list,    # 评审者 AgentProxy 列表
        task,
        on_progress: Callable | None = None,
        run_agent_fn: Callable | None = None,
        approval_threshold: float = 7.0,
    ) -> PeerReviewResult:
        """
        执行同行评审流程。
        """
        result = PeerReviewResult()

        def emit(stage, info):
            if on_progress:
                try:
                    on_progress(stage, info)
                except Exception:
                    pass

        # 第 1 步：执行者完成工作
        emit("peer_review_executing", {"agent": executor_agent.name})
        work = run_agent_fn(executor_agent, task, task_description) if run_agent_fn else ""
        result.original_work = work

        # 第 2 步：各评审者独立评审
        import json
        import re

        emit("peer_review_reviewing", {"reviewers": [r.name for r in reviewer_agents]})
        for reviewer in reviewer_agents:
            review_prompt = cls.REVIEW_PROMPT.format(
                task_description=task_description,
                work_result=work[:3000],
            )
            review_text = run_agent_fn(reviewer, task, review_prompt) if run_agent_fn else ""

            # 解析评审 JSON
            json_match = re.search(r'\{[\s\S]*\}', review_text)
            if json_match:
                try:
                    review_data = json.loads(json_match.group())
                except json.JSONDecodeError:
                    review_data = {"overall_feedback": review_text, "total_score": 0}
            else:
                review_data = {"overall_feedback": review_text, "total_score": 0}

            review_data["reviewer"] = reviewer.name
            result.reviews.append(review_data)

            emit("peer_review_done", {"reviewer": reviewer.name, "score": review_data.get("total_score", 0)})

        # 第 3 步：检查是否通过
        scores = [r.get("total_score", 0) for r in result.reviews]
        avg_score = sum(scores) / len(scores) if scores else 0
        result.final_score = round(avg_score, 1)

        if avg_score >= approval_threshold and all(
            r.get("issues", []) == [] or len(r.get("issues", [])) <= 1
            for r in result.reviews
        ):
            # 直接通过
            result.approved = True
            result.revised_work = work
            emit("peer_review_approved", {"score": avg_score})
            return result

        # 第 4 步：收集反馈，要求修改
        all_suggestions = []
        all_issues = []
        for r in result.reviews:
            all_suggestions.extend(r.get("suggestions", []))
            all_issues.extend(r.get("issues", []))

        feedback_text = (
            f"平均分: {avg_score:.1f}/10\n\n"
            f"### 发现的问题\n" +
            "\n".join(f"- {x}" for x in all_issues[:5]) +
            f"\n\n### 改进建议\n" +
            "\n".join(f"- {x}" for x in all_suggestions[:5])
        )

        emit("peer_review_revising", {"agent": executor_agent.name})
        revise_prompt = cls.REVISE_PROMPT.format(
            task_description=task_description,
            original_work=work,
            review_feedback=feedback_text,
        )
        revised_work = run_agent_fn(executor_agent, task, revise_prompt) if run_agent_fn else work
        result.revised_work = revised_work

        # 第 5 步：快速二次确认（让第一个评审者确认修改）
        if reviewer_agents and revised_work != work:
            emit("peer_review_confirming", {})
            confirm_prompt = (
                f"请快速确认以下修改是否解决了评审中提出的问题:\n\n"
                f"原始问题:\n{feedback_text[:500]}\n\n"
                f"修改后的成果:\n{revised_work[:2000]}\n\n"
                f"请回答: 通过 / 需要再改。如果需要再改，简要说一下还没解决的问题。"
            )
            confirm_text = run_agent_fn(reviewer_agents[0], task, confirm_prompt) if run_agent_fn else "通过"
            result.approved = "通过" in confirm_text and "需要再改" not in confirm_text
        else:
            result.approved = True

        emit("peer_review_complete", {"approved": result.approved, "score": avg_score})
        return result


# ============================================================
# 3. 圆桌会议模式
# ============================================================

class RoundTableManager:
    """
    圆桌会议模式：
      1. 主持人提出议题
      2. 每位成员发表初始观点
      3. 多轮自由讨论（每个成员可回应他人）
      4. 追踪共识点和分歧点
      5. 形成会议纪要
    """

    INITIAL_OPINION_PROMPT = """你正在参加团队圆桌会议。讨论主题：

【会议议题】{topic}

你的角色: {role}

请发表你的初始观点：
1. 对这个议题的核心见解
2. 潜在的机会和风险
3. 你的建议方向

用中文回答，清晰有序。"""

    DISCUSSION_PROMPT = """继续圆桌讨论。当前是第 {round} 轮。

【讨论议题】{topic}

【其他人的观点摘要】
{others_summary}

请回应他人的观点：
- 你认同哪些？为什么？
- 你不同意哪些？请说明理由
- 是否有需要补充的新角度？

用中文回答。"""

    SUMMARY_PROMPT = """圆桌会议即将结束。请综合所有讨论内容。

【会议议题】{topic}

【完整讨论记录】
{discussion_record}

请完成以下工作：
1. **共识点**: 列出团队达成一致的要点（3-5 条）
2. **分歧点**: 列出仍存在分歧的问题（如有）
3. **行动建议**: 给出具体、可执行的下一步行动方案

用中文回答，使用以下格式：

## 共识点
1. ...
2. ...

## 分歧点
1. ...
2. ...

## 行动建议
1. ...
2. ..."""

    @classmethod
    def run(
        cls,
        topic: str,
        members: list,              # AgentProxy 列表
        facilitator_agent,          # 主持人 AgentProxy
        task,
        on_progress: Callable | None = None,
        run_agent_fn: Callable | None = None,
        discussion_rounds: int = 2,
    ) -> RoundTableResult:
        """
        执行圆桌会议。
        """
        result = RoundTableResult(topic=topic)

        def emit(stage, info):
            if on_progress:
                try:
                    on_progress(stage, info)
                except Exception:
                    pass

        # 第 1 轮：初始观点
        emit("roundtable_opening", {"members": len(members)})
        round1_opinions = []
        for member in members:
            emit("roundtable_speaking", {"member": member.name, "round": 1})
            prompt = cls.INITIAL_OPINION_PROMPT.format(
                topic=topic,
                role=f"团队成员「{member.name}」，特长: {', '.join(getattr(member, 'skills', ['通用']))}",
            )
            opinion = run_agent_fn(member, task, prompt) if run_agent_fn else ""
            round1_opinions.append({"speaker": member.name, "text": opinion})

        result.rounds.append(round1_opinions)

        # 额外讨论轮次
        for r in range(2, discussion_rounds + 1):
            emit("roundtable_discussion", {"round": r})
            others_summary = cls._summarize_others(round1_opinions, "")

            round_opinions = []
            for member in members:
                emit("roundtable_speaking", {"member": member.name, "round": r})
                prompt = cls.DISCUSSION_PROMPT.format(
                    topic=topic,
                    round=r,
                    others_summary=others_summary[:2000],
                )
                opinion = run_agent_fn(member, task, prompt) if run_agent_fn else ""
                round_opinions.append({"speaker": member.name, "text": opinion})

                # 更新摘要，让后面的人能看到本轮更新
                all_opinions = round1_opinions + round_opinions
                others_summary = cls._summarize_others(all_opinions, member.name)

            result.rounds.append(round_opinions)

        # 综合总结
        emit("roundtable_summarizing", {})
        discussion_record = cls._build_full_record(result)

        if facilitator_agent:
            summary = run_agent_fn(facilitator_agent, task,
                                   cls.SUMMARY_PROMPT.format(topic=topic, discussion_record=discussion_record)
                                   ) if run_agent_fn else ""
        else:
            summary = run_agent_fn(members[0], task,
                                   cls.SUMMARY_PROMPT.format(topic=topic, discussion_record=discussion_record)
                                   ) if run_agent_fn else ""

        # 解析共识和分歧
        import re
        consensus_match = re.search(r'##\s*共识点\s*\n(.*?)(?=##|$)', summary, re.DOTALL) if summary else None
        disagreement_match = re.search(r'##\s*分歧点\s*\n(.*?)(?=##|$)', summary, re.DOTALL) if summary else None

        if consensus_match:
            result.consensus_points = [
                line.strip("- ").strip()
                for line in consensus_match.group(1).strip().split("\n")
                if line.strip() and (line.strip()[0].isdigit() or line.strip().startswith("-"))
            ]
        if disagreement_match:
            result.disagreements = [
                line.strip("- ").strip()
                for line in disagreement_match.group(1).strip().split("\n")
                if line.strip() and (line.strip()[0].isdigit() or line.strip().startswith("-"))
            ]

        result.final_summary = summary or ""
        emit("roundtable_complete", {
            "consensus_points": len(result.consensus_points),
            "disagreements": len(result.disagreements),
        })

        return result

    @staticmethod
    def _summarize_others(opinions: list[dict], exclude_name: str) -> str:
        """汇总其他人的观点"""
        lines = []
        for op in opinions:
            if op["speaker"] != exclude_name:
                lines.append(f"【{op['speaker']}】: {op['text'][:300]}")
        return "\n\n".join(lines) if lines else "(无其他观点)"

    @staticmethod
    def _build_full_record(result: RoundTableResult) -> str:
        """构建完整会议记录"""
        lines = []
        for i, round_data in enumerate(result.rounds, 1):
            lines.append(f"=== 第 {i} 轮 ===")
            for opinion in round_data:
                lines.append(f"\n【{opinion['speaker']}】:\n{opinion['text'][:500]}")
            lines.append("")
        return "\n".join(lines)


# ============================================================
# 4. 层级决策模式
# ============================================================

class HierarchicalManager:
    """
    层级决策模式：
      Level 1: 专家 Agent 提供方案
      Level 2: 经理 Agent 筛选/评审方案
      Level 3: 总监 Agent 最终决策
    """

    EXPERT_PROMPT = """作为专家，请为以下问题提供解决方案：

【问题】{problem}

要求：
1. 提出 2-3 个可行方案
2. 每个方案说明：要点 / 优势 / 劣势 / 预计成本
3. 给出你的推荐排序

用中文回答。"""

    MANAGER_PROMPT = """作为经理，请评审以下专家方案：

【原始问题】{problem}

【专家方案】
{expert_proposals}

要求：
1. 评估每个方案的可行性和风险
2. 排除不合理的方案
3. 对可行方案进行优劣势对比
4. 给出你的推荐（附理由）

用中文回答。"""

    DIRECTOR_PROMPT = """作为总监，请做出最终决策：

【原始问题】{problem}

【经理评审报告】
{manager_review}

要求：
1. 审核经理的推荐是否合理
2. 考虑战略层面因素（长期影响、资源约束等）
3. 做出最终决策
4. 给出执行路线图（时间线 + 关键里程碑）

用中文回答。"""

    @classmethod
    def run(
        cls,
        problem: str,
        expert_agents: list,
        manager_agent,
        director_agent,
        task,
        on_progress: Callable | None = None,
        run_agent_fn: Callable | None = None,
    ) -> dict:
        """
        执行层级决策。
        """
        def emit(stage, info):
            if on_progress:
                try:
                    on_progress(stage, info)
                except Exception:
                    pass

        # Level 1: 专家提供方案
        emit("hierarchical_expert", {"experts": len(expert_agents)})
        all_proposals = []
        for expert in expert_agents:
            proposal = run_agent_fn(expert, task,
                                    cls.EXPERT_PROMPT.format(problem=problem)) if run_agent_fn else ""
            all_proposals.append({"expert": expert.name, "proposal": proposal})

        expert_text = "\n\n---\n\n".join(
            f"### 专家 {p['expert']}\n{p['proposal']}" for p in all_proposals
        )

        # Level 2: 经理评审
        emit("hierarchical_manager", {"manager": manager_agent.name})
        manager_review = run_agent_fn(manager_agent, task,
                                      cls.MANAGER_PROMPT.format(problem=problem, expert_proposals=expert_text)
                                      ) if run_agent_fn else ""

        # Level 3: 总监决策
        emit("hierarchical_director", {"director": director_agent.name})
        final_decision = run_agent_fn(director_agent, task,
                                      cls.DIRECTOR_PROMPT.format(problem=problem, manager_review=manager_review)
                                      ) if run_agent_fn else ""

        emit("hierarchical_complete", {})

        return {
            "problem": problem,
            "expert_proposals": all_proposals,
            "manager_review": manager_review,
            "final_decision": final_decision,
        }
