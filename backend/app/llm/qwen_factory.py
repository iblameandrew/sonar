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


def _safe_text(value: Any, limit: int = 500) -> str:
    """Force error/status strings to ASCII so Windows consoles and HTTP headers do not crash."""
    text = str(value).strip() if value is not None else ""
    if not text:
        return "Unknown error"
    text = text.encode("ascii", errors="replace").decode("ascii")
    if len(text) > limit:
        return f"{text[:limit]}..."
    return text


def _sanitize_api_key(key: str) -> str:
    """Strip whitespace/BOM and keep only ASCII — required for Authorization headers."""
    key = (key or "").strip().strip("\ufeff")
    return "".join(ch for ch in key if 32 <= ord(ch) < 127)


DASHSCOPE_BASE_INTL = (
    "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
)
DASHSCOPE_BASE_CN = "https://dashscope.aliyuncs.com/compatible-mode/v1"
OPENROUTER_BASE = "https://openrouter.ai/api/v1"
DEFAULT_OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "nex-agi/nex-n2-pro")
DEFAULT_MODEL = os.getenv("QWEN_MODEL", CATALOG_DEFAULT)
GENAI_BACKENDS = ("dashscope", "openrouter")


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
    """GenAI backend for society agents — DashScope (Qwen) or OpenRouter (OpenAI SDK)."""

    def __init__(self) -> None:
        self._instances: dict[str, BaseChatModel] = {}
        self._configs: dict[str, RoleConfig] = self._default_configs()
        self._usage_log: list[UsageRecord] = []
        self._lock = Lock()
        self._total_input = 0
        self._total_output = 0
        self._call_count = 0
        self._last_error: str = ""
        self._auth_disabled: bool = False
        self._key_validated: bool = False
        self._backend: str = self._resolve_backend(os.getenv("GENAI_BACKEND", "dashscope"))
        self._openrouter_model: str = DEFAULT_OPENROUTER_MODEL
        if self._backend == "openrouter":
            self._apply_openrouter_model(self._openrouter_model)

    def _resolve_backend(self, raw: str) -> str:
        key = (raw or "dashscope").strip().lower()
        if key in {"openrouter", "open-router", "or"}:
            return "openrouter"
        return "dashscope"

    def get_backend(self) -> str:
        return self._backend

    def set_backend(self, backend: str) -> None:
        self._backend = self._resolve_backend(backend)
        os.environ["GENAI_BACKEND"] = self._backend
        self._instances.clear()
        self._last_error = ""
        self._auth_disabled = False
        self._key_validated = False
        if self._backend == "openrouter":
            self._apply_openrouter_model(self._openrouter_model)

    def get_openrouter_model(self) -> str:
        return self._openrouter_model

    def set_openrouter_model(self, model_slug: str) -> None:
        slug = (model_slug or "").strip() or DEFAULT_OPENROUTER_MODEL
        self._openrouter_model = slug
        os.environ["OPENROUTER_MODEL"] = slug
        if self._backend == "openrouter":
            self._apply_openrouter_model(slug)
        self._instances.clear()

    def _apply_openrouter_model(self, model_slug: str) -> None:
        for cfg in self._configs.values():
            cfg.model = model_slug

    def _is_auth_error(self, msg: str) -> bool:
        lower = msg.lower()
        return any(
            k in lower
            for k in (
                "invalidapikey",
                "invalid api-key",
                "invalid api key",
                "invalid_api_key",
                "incorrect api key",
                "apikey-error",
                "status_code: 401",
                "error code: 401",
                " 401",
                "unauthorized",
                "authentication",
                "missing authentication",
            )
        )

    def _infer_backend(
        self,
        backend: str | None = None,
        model_slug: str | None = None,
        api_key: str | None = None,
    ) -> str:
        if backend:
            return self._resolve_backend(backend)
        if model_slug and model_slug.strip():
            return "openrouter"
        key = _sanitize_api_key(api_key or "")
        if key.startswith(("sk-or-", "sk-o")):
            return "openrouter"
        return self._backend

    def _record_llm_error(self, role: str, exc: Exception) -> None:
        msg = _safe_text(exc)
        self._last_error = msg
        lower = msg.lower()
        try:
            if self._is_auth_error(msg):
                self._auth_disabled = True
                self._instances.clear()
                logger.error(
                    "API key rejected [%s] - disabling LLM for this session: %s",
                    role,
                    msg,
                )
            elif any(k in lower for k in ("quota", "rate limit", "insufficient", "balance", "exceeded", "429")):
                logger.error("LLM quota/rate error [%s]: %s", role, msg)
            else:
                logger.warning("LLM call failed [%s]: %s", role, msg)
        except Exception:
            pass

    def _api_key(self) -> str | None:
        if self._backend == "openrouter":
            return os.getenv("OPENROUTER_API_KEY")
        return os.getenv("DASHSCOPE_API_KEY") or os.getenv("QWEN_API_KEY")

    def _base_url(self) -> str:
        if self._backend == "openrouter":
            return os.getenv("OPENROUTER_BASE_URL", OPENROUTER_BASE).rstrip("/")
        explicit = os.getenv("DASHSCOPE_BASE_URL", "").strip()
        if explicit:
            return explicit.rstrip("/")
        region = os.getenv("DASHSCOPE_REGION", "intl").strip().lower()
        if region in {"cn", "china", "domestic"}:
            return DASHSCOPE_BASE_CN
        return DASHSCOPE_BASE_INTL

    def _provider_label(self) -> str:
        if self._backend == "openrouter":
            return f"OpenRouter ({self._openrouter_model})"
        return "Qwen Cloud (DashScope)"

    def is_configured(self) -> bool:
        if not self._api_key() or self._auth_disabled or not self._key_validated:
            return False
        if self._backend == "openrouter" and not self._openrouter_model.strip():
            return False
        return True

    def configure(
        self,
        backend: str | None = None,
        model_slug: str | None = None,
        api_key: str | None = None,
    ) -> None:
        resolved = self._infer_backend(backend, model_slug, api_key)
        self.set_backend(resolved)
        if model_slug is not None:
            self.set_openrouter_model(model_slug)

    def connect_api_key(
        self,
        key: str,
        *,
        backend: str | None = None,
        model_slug: str | None = None,
    ) -> tuple[bool, str]:
        """Apply backend + model, store key, validate once (no retries)."""
        try:
            self.configure(backend=backend, model_slug=model_slug, api_key=key)
            self.set_api_key(key)
            return self.validate_api_key()
        except Exception as exc:
            msg = _safe_text(exc)
            self._last_error = msg
            self._key_validated = False
            return False, msg

    def set_api_key(self, key: str) -> None:
        key = _sanitize_api_key(key)
        if self._backend == "openrouter":
            os.environ["OPENROUTER_API_KEY"] = key
        else:
            os.environ["DASHSCOPE_API_KEY"] = key
            os.environ.pop("QWEN_API_KEY", None)
        self._instances.clear()
        self._last_error = ""
        self._auth_disabled = False
        self._key_validated = False

    def _validate_openrouter(self, api_key: str, probe_model: str) -> tuple[bool, str]:
        import httpx

        base = self._base_url().rstrip("/")
        referer = _safe_text(os.getenv("OPENROUTER_REFERER", "https://colony.local"), limit=120)
        title = _safe_text(os.getenv("OPENROUTER_APP_TITLE", "Colony"), limit=80)
        headers = {
            "Authorization": f"Bearer {api_key}",
            "HTTP-Referer": referer,
            "X-Title": title,
            "Content-Type": "application/json",
        }
        payload = {
            "model": probe_model,
            "messages": [{"role": "user", "content": "ping"}],
            "max_tokens": 4,
        }
        try:
            with httpx.Client(timeout=30.0) as client:
                response = client.post(
                    f"{base}/chat/completions",
                    headers=headers,
                    json=payload,
                )
            if response.status_code == 200:
                return True, f"API key accepted (OpenRouter - {probe_model} @ {base})"
            raw = response.content.decode("utf-8", errors="replace")
            body = _safe_text(raw, limit=300)
            if response.status_code in {401, 403}:
                self._auth_disabled = True
                self._instances.clear()
                self._last_error = body
                return False, "Invalid OpenRouter API key - get one at openrouter.ai/keys"
            self._last_error = f"OpenRouter HTTP {response.status_code}: {body}"
            return False, self._last_error
        except Exception as exc:
            self._record_llm_error("validate", exc)
            return False, _safe_text(exc)

    def validate_api_key(self) -> tuple[bool, str]:
        """Probe the active backend with a minimal completion (single attempt)."""
        try:
            api_key = _sanitize_api_key(self._api_key() or "")
            if not api_key:
                return False, "No API key set"
            probe_model = (
                self._openrouter_model
                if self._backend == "openrouter"
                else QWEN3_6_FLASH
            )
            if self._backend == "openrouter":
                valid, message = self._validate_openrouter(api_key, probe_model)
                message = _safe_text(message)
                if valid:
                    self._auth_disabled = False
                    self._key_validated = True
                    self._last_error = ""
                else:
                    self._key_validated = False
                return valid, message

            llm = self._build_llm(RoleConfig(model=probe_model, max_tokens=8, temperature=0.0))
            if not llm:
                return False, "Could not build LLM client"
            from langchain_core.messages import HumanMessage

            llm.invoke([HumanMessage(content="ping")])
            self._auth_disabled = False
            self._key_validated = True
            self._last_error = ""
            return True, f"API key accepted ({self._provider_label()} @ {self._base_url()})"
        except Exception as exc:
            self._key_validated = False
            self._record_llm_error("validate", exc)
            if self._auth_disabled:
                if self._backend == "openrouter":
                    return False, "Invalid OpenRouter API key - get one at openrouter.ai/keys"
                return (
                    False,
                    "Invalid DashScope API key - use a key from "
                    "modelstudio.console.alibabacloud.com (intl) or dashscope.aliyun.com (CN)",
                )
            return False, _safe_text(exc)

    def masked_api_key(self) -> str:
        key = _sanitize_api_key(self._api_key() or "")
        if not key or len(key) < 8:
            return ""
        return f"{key[:4]}...{key[-4:]}"

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
        api_key = _sanitize_api_key(self._api_key() or "")
        if not api_key:
            return None

        from langchain_openai import ChatOpenAI

        model = config.model
        if self._backend == "openrouter":
            model = self._openrouter_model

        kwargs: dict[str, Any] = {
            "model": model,
            "api_key": api_key,
            "base_url": self._base_url(),
            "temperature": config.temperature,
            "max_tokens": config.max_tokens,
            "max_retries": 0,
            "timeout": 120,
        }
        if self._backend == "openrouter":
            referer = _safe_text(os.getenv("OPENROUTER_REFERER", "https://colony.local"), limit=120)
            title = _safe_text(os.getenv("OPENROUTER_APP_TITLE", "Colony"), limit=80)
            kwargs["default_headers"] = {
                "Authorization": f"Bearer {api_key}",
                "HTTP-Referer": referer,
                "X-Title": title,
            }
        else:
            # Intl DashScope uses OpenAI-compatible chat completions.
            kwargs["extra_body"] = {"enable_thinking": False}

        return ChatOpenAI(**kwargs)

    def get_config(self, role: str) -> RoleConfig:
        return self._configs.get(role, self._configs["default"])

    def set_role_model(self, role: str, model: str, **kwargs: Any) -> None:
        if self._backend == "openrouter":
            self.set_openrouter_model(model)
            return
        cfg = self._configs.get(role, RoleConfig())
        cfg.model = model
        for k, v in kwargs.items():
            if hasattr(cfg, k):
                setattr(cfg, k, v)
        self._configs[role] = cfg
        self._instances.pop(role, None)

    def get_for_role(self, role: str) -> BaseChatModel | None:
        if self._auth_disabled or not self._api_key():
            return None
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

    def _ensure_json_hint(self, messages: list[BaseMessage]) -> list[BaseMessage]:
        """DashScope intl requires the word 'json' when using structured output."""
        if not messages:
            return messages
        if any("json" in (getattr(m, "content", "") or "").lower() for m in messages):
            return messages
        from langchain_core.messages import HumanMessage

        last = messages[-1]
        content = str(getattr(last, "content", "") or "")
        hinted = HumanMessage(content=f"{content}\n\nRespond in JSON.")
        return [*messages[:-1], hinted]

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
            messages = self._ensure_json_hint(messages)
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
            messages = self._ensure_json_hint(messages)
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
        has_key = bool(self._api_key())
        configured = self.is_configured()
        if self._backend == "openrouter":
            status_message = (
                f"All agents routed via OpenRouter - {self._openrouter_model} [OK]"
                if configured
                else "Set your OpenRouter API key and model slug in Settings"
            )
            if has_key and self._auth_disabled:
                status_message = (
                    "API key rejected by OpenRouter - running heuristic agents. "
                    "Get a key at openrouter.ai/keys"
                )
        else:
            status_message = (
                "All agents powered by Qwen Cloud [OK]"
                if configured
                else "Set your DashScope API key in the dashboard"
            )
            if has_key and self._auth_disabled:
                status_message = (
                    "API key rejected by DashScope - running heuristic agents. "
                    "Get a key at modelstudio.console.alibabacloud.com"
                )
        if self._last_error and (not configured or self._auth_disabled):
            status_message = f"GenAI error: {_safe_text(self._last_error)}"
        return {
            "provider": _safe_text(self._provider_label()),
            "backend": self._backend,
            "model_slug": _safe_text(self._openrouter_model),
            "configured": configured,
            "auth_disabled": self._auth_disabled,
            "key_valid": self._key_validated and not self._auth_disabled,
            "base_url": _safe_text(self._base_url()),
            "api_key_masked": _safe_text(self.masked_api_key()),
            "last_error": _safe_text(self._last_error),
            "status_message": _safe_text(status_message),
            "default_model": (
                self._openrouter_model
                if self._backend == "openrouter"
                else DEFAULT_MODEL
            ),
            "available_models": (
                [{"id": self._openrouter_model, "label": self._openrouter_model, "category": "openrouter", "best_for": "OpenRouter slug"}]
                if self._backend == "openrouter"
                else catalog_for_api()
            ),
            "role_labels": ROLE_LABELS,
            "roles": {
                role: {"model": cfg.model, "temperature": cfg.temperature}
                for role, cfg in self._configs.items()
                if role != "default"
            },
            "usage": self.get_usage_summary(),
        }


qwen_factory = QwenLLMFactory()