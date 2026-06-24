from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from threading import Lock
from typing import Any, TypeVar

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import BaseMessage
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel

from app.roles import (
    ATTENTION_AGENT,
    BASELINE_AGENT,
    CODING_ROLES,
    CRITIC_EVALUATOR,
    FEED_FORWARD_AGENT,
    GRADIENT_DESCENT_AGENT,
    HIERARCHICAL_MEMORY_AGENT,
    INPUT_PROJECTION_AGENT,
    INTEGRATOR,
    INTERVENTION_AGENT,
    LOSS_AGENT,
    LOW_RANK_AGENT,
    MULTI_HEAD_AGENT,
    OPTIMIZER,
    ORCHESTRATOR,
    REASONING_ROLES,
    RESIDUAL_FLOW_AGENT,
    ROLE_LABELS,
    UX_WEAVER,
    VOXEL_ARCHITECT,
    WEIGHT_AGENT,
)
from app.llm.models import (
    DEFAULT_MODEL as CATALOG_DEFAULT,
    QWEN3_6_FLASH,
    catalog_for_api,
)

T = TypeVar("T", bound=BaseModel)

logger = logging.getLogger(__name__)

DASHSCOPE_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_MODEL = os.getenv("QWEN_MODEL", CATALOG_DEFAULT)


@dataclass
class RoleConfig:
    model: str = DEFAULT_MODEL
    temperature: float = 0.7
    top_p: float = 0.9
    max_tokens: int = 2048
    system_prompt: str = ""


@dataclass
class UsageRecord:
    role: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    latency_ms: int = 0
    timestamp: float = field(default_factory=time.time)


class QwenLLMFactory:
    """Centralized Qwen Cloud (DashScope) provider for all society agents."""

    def __init__(self) -> None:
        self._instances: dict[str, BaseChatModel] = {}
        self._configs: dict[str, RoleConfig] = self._default_configs()
        self._usage_log: list[UsageRecord] = []
        self._lock = Lock()
        self._total_input = 0
        self._total_output = 0
        self._call_count = 0
        self._last_error: str = ""

    def _record_llm_error(self, role: str, exc: Exception) -> None:
        msg = str(exc).strip() or exc.__class__.__name__
        self._last_error = msg
        lower = msg.lower()
        if any(k in lower for k in ("quota", "rate limit", "insufficient", "balance", "exceeded", "429")):
            logger.error("Qwen quota/rate error [%s]: %s", role, msg)
        else:
            logger.warning("Qwen call failed [%s]: %s", role, msg)

    def _api_key(self) -> str | None:
        return os.getenv("DASHSCOPE_API_KEY") or os.getenv("QWEN_API_KEY")

    def is_configured(self) -> bool:
        return bool(self._api_key())

    def set_api_key(self, key: str) -> None:
        os.environ["DASHSCOPE_API_KEY"] = key.strip()
        os.environ.pop("QWEN_API_KEY", None)
        self._instances.clear()
        self._last_error = ""

    def masked_api_key(self) -> str:
        key = self._api_key()
        if not key or len(key) < 8:
            return ""
        return f"{key[:4]}…{key[-4:]}"

    def _default_configs(self) -> dict[str, RoleConfig]:
        return {
            LOSS_AGENT: RoleConfig(
                model=QWEN3_6_FLASH, temperature=0.3, max_tokens=1024,
                system_prompt="You are the Loss Agent — cost function / regret measurement.",
            ),
            ATTENTION_AGENT: RoleConfig(
                model=QWEN3_6_FLASH, temperature=0.7, max_tokens=512,
                system_prompt="You are the Attention Agent — core attention / relational relevance.",
            ),
            GRADIENT_DESCENT_AGENT: RoleConfig(
                model=QWEN3_6_FLASH, temperature=0.5, max_tokens=1024,
                system_prompt="You are the Gradient Descent Agent — parameter update after misalignment.",
            ),
            RESIDUAL_FLOW_AGENT: RoleConfig(
                model=QWEN3_6_FLASH, temperature=0.4, max_tokens=512,
                system_prompt="You are the Residual Flow Agent — backward propagation of lessons.",
            ),
            FEED_FORWARD_AGENT: RoleConfig(
                model=QWEN3_6_FLASH, temperature=0.6, max_tokens=1024,
                system_prompt="You are the Feed-Forward Agent — activation and artifact distribution.",
            ),
            WEIGHT_AGENT: RoleConfig(
                model=QWEN3_6_FLASH, temperature=0.2, max_tokens=512,
                system_prompt="You are the Weight Agent — persistent learned parameters and memory.",
            ),
            INPUT_PROJECTION_AGENT: RoleConfig(
                model=QWEN3_6_FLASH, temperature=0.5, max_tokens=1024,
                system_prompt="You are the Input Projection Agent — task routing and decomposition.",
            ),
            MULTI_HEAD_AGENT: RoleConfig(
                model=QWEN3_6_FLASH, temperature=0.7, max_tokens=1024,
                system_prompt="You are the Multi-Head Agent — multi-head contention negotiation.",
            ),
            INTERVENTION_AGENT: RoleConfig(
                model=QWEN3_6_FLASH, temperature=0.4, max_tokens=1024,
                system_prompt="You are the Intervention Agent — high-loss conflict resolution.",
            ),
            VOXEL_ARCHITECT: RoleConfig(
                model=QWEN3_6_FLASH, temperature=0.5, max_tokens=2048,
                system_prompt="You are the Voxel Architect Agent — Three.js pixel-art visualization.",
            ),
            ORCHESTRATOR: RoleConfig(
                model=QWEN3_6_FLASH, temperature=0.5, max_tokens=2048,
                system_prompt="You are the Orchestrator Agent — LangGraph and SSE pipelines.",
            ),
            OPTIMIZER: RoleConfig(
                model=QWEN3_6_FLASH, temperature=0.3, max_tokens=1024,
                system_prompt="You are the Optimizer Agent — benchmarking and efficiency.",
            ),
            INTEGRATOR: RoleConfig(
                model=QWEN3_6_FLASH, temperature=0.5, max_tokens=2048,
                system_prompt="You are the Integrator Agent — FastAPI + frontend integration.",
            ),
            UX_WEAVER: RoleConfig(
                model=QWEN3_6_FLASH, temperature=0.6, max_tokens=1024,
                system_prompt="You are the UX Weaver Agent — dashboard and judge-friendly UI.",
            ),
            CRITIC_EVALUATOR: RoleConfig(
                model=QWEN3_6_FLASH, temperature=0.2, max_tokens=1024,
                system_prompt="You are the Critic Evaluator Agent — society vs baseline metrics.",
            ),
            LOW_RANK_AGENT: RoleConfig(model=QWEN3_6_FLASH, temperature=0.6, max_tokens=512),
            HIERARCHICAL_MEMORY_AGENT: RoleConfig(model=QWEN3_6_FLASH, temperature=0.5, max_tokens=1024),
            BASELINE_AGENT: RoleConfig(
                model=QWEN3_6_FLASH, temperature=0.7, max_tokens=2048,
                system_prompt="You are the Baseline Agent — single-agent comparison mode.",
            ),
            "default": RoleConfig(model=DEFAULT_MODEL, temperature=0.7, max_tokens=2048),
        }

    def _build_llm(self, config: RoleConfig) -> BaseChatModel | None:
        api_key = self._api_key()
        if not api_key:
            return None

        try:
            from langchain_community.chat_models.tongyi import ChatTongyi
            return ChatTongyi(
                model=config.model,
                dashscope_api_key=api_key,
                temperature=config.temperature,
                top_p=config.top_p,
                max_tokens=config.max_tokens,
            )
        except Exception:
            from langchain_openai import ChatOpenAI
            return ChatOpenAI(
                model=config.model,
                api_key=api_key,
                base_url=DASHSCOPE_BASE,
                temperature=config.temperature,
                max_tokens=config.max_tokens,
            )

    def get_config(self, role: str) -> RoleConfig:
        return self._configs.get(role, self._configs["default"])

    def set_role_model(self, role: str, model: str, **kwargs: Any) -> None:
        cfg = self._configs.get(role, RoleConfig())
        cfg.model = model
        for k, v in kwargs.items():
            if hasattr(cfg, k):
                setattr(cfg, k, v)
        self._configs[role] = cfg
        self._instances.pop(role, None)

    def get_for_role(self, role: str) -> BaseChatModel | None:
        if role in self._instances:
            return self._instances[role]
        config = self._configs.get(role, self._configs["default"])
        llm = self._build_llm(config)
        if llm:
            self._instances[role] = llm
        return llm

    def get_for_agent_role(self, specialist_role: str) -> BaseChatModel | None:
        return self.get_for_role(
            specialist_role if specialist_role in self._configs else "default"
        )

    def _estimate_tokens(self, messages: list[BaseMessage], output: str = "") -> tuple[int, int]:
        inp = sum(len(getattr(m, "content", "") or "") for m in messages) // 4
        out = len(output) // 4
        return max(inp, 1), max(out, 1)

    def invoke_structured(
        self,
        role: str,
        output_model: type[T],
        prompt: ChatPromptTemplate,
        variables: dict[str, Any],
    ) -> T | None:
        llm = self.get_for_role(role)
        if not llm:
            return None
        config = self.get_config(role)
        start = time.time()
        try:
            messages = prompt.format_messages(**variables)
            if config.system_prompt and messages:
                from langchain_core.messages import SystemMessage
                messages = [SystemMessage(content=config.system_prompt)] + list(messages)
            chain = llm.with_structured_output(output_model)
            result: T = chain.invoke(messages)
            out_str = result.model_dump_json()
            inp_tok, out_tok = self._estimate_tokens(messages, out_str)
            self._record_usage(role, config.model, inp_tok, out_tok, start)
            return result
        except Exception as exc:
            self._record_llm_error(role, exc)
            return None

    async def ainvoke_structured(
        self,
        role: str,
        output_model: type[T],
        prompt: ChatPromptTemplate,
        variables: dict[str, Any],
    ) -> T | None:
        llm = self.get_for_role(role)
        if not llm:
            return None
        config = self.get_config(role)
        start = time.time()
        try:
            messages = prompt.format_messages(**variables)
            if config.system_prompt and messages:
                from langchain_core.messages import SystemMessage
                messages = [SystemMessage(content=config.system_prompt)] + list(messages)
            chain = llm.with_structured_output(output_model)
            result: T = await chain.ainvoke(messages)
            out_str = result.model_dump_json()
            inp_tok, out_tok = self._estimate_tokens(messages, out_str)
            self._record_usage(role, config.model, inp_tok, out_tok, start)
            return result
        except Exception as exc:
            self._record_llm_error(role, exc)
            return None

    def invoke_text(
        self,
        role: str,
        prompt: ChatPromptTemplate,
        variables: dict[str, Any],
    ) -> str | None:
        llm = self.get_for_role(role)
        if not llm:
            return None
        config = self.get_config(role)
        start = time.time()
        try:
            messages = prompt.format_messages(**variables)
            if config.system_prompt:
                from langchain_core.messages import SystemMessage
                messages = [SystemMessage(content=config.system_prompt)] + list(messages)
            response = llm.invoke(messages)
            content = str(response.content)
            inp_tok, out_tok = self._estimate_tokens(messages, content)
            self._record_usage(role, config.model, inp_tok, out_tok, start)
            return content
        except Exception as exc:
            self._record_llm_error(role, exc)
            return None

    def _record_usage(
        self, role: str, model: str, inp: int, out: int, start: float
    ) -> UsageRecord:
        rec = UsageRecord(
            role=role,
            model=model,
            input_tokens=inp,
            output_tokens=out,
            total_tokens=inp + out,
            latency_ms=int((time.time() - start) * 1000),
        )
        with self._lock:
            self._usage_log.append(rec)
            if len(self._usage_log) > 500:
                self._usage_log = self._usage_log[-500:]
            self._total_input += inp
            self._total_output += out
            self._call_count += 1
        return rec

    def get_usage_summary(self) -> dict[str, Any]:
        with self._lock:
            by_role: dict[str, dict] = {}
            for rec in self._usage_log:
                if rec.role not in by_role:
                    by_role[rec.role] = {"calls": 0, "tokens": 0, "model": rec.model}
                by_role[rec.role]["calls"] += 1
                by_role[rec.role]["tokens"] += rec.total_tokens
            return {
                "total_calls": self._call_count,
                "total_input_tokens": self._total_input,
                "total_output_tokens": self._total_output,
                "total_tokens": self._total_input + self._total_output,
                "by_role": by_role,
                "recent": [
                    {
                        "role": r.role,
                        "model": r.model,
                        "tokens": r.total_tokens,
                        "latency_ms": r.latency_ms,
                    }
                    for r in self._usage_log[-10:]
                ],
            }

    def get_status(self) -> dict[str, Any]:
        configured = self.is_configured()
        status_message = (
            "All agents powered by Qwen Cloud ✓"
            if configured
            else "Set your DashScope API key in the dashboard"
        )
        if self._last_error:
            status_message = f"Qwen error: {self._last_error}"
        return {
            "provider": "Qwen Cloud (DashScope)",
            "configured": configured,
            "api_key_masked": self.masked_api_key(),
            "last_error": self._last_error,
            "status_message": status_message,
            "default_model": DEFAULT_MODEL,
            "available_models": catalog_for_api(),
            "role_labels": ROLE_LABELS,
            "roles": {
                role: {"model": cfg.model, "temperature": cfg.temperature}
                for role, cfg in self._configs.items()
                if role != "default"
            },
            "usage": self.get_usage_summary(),
        }


qwen_factory = QwenLLMFactory()