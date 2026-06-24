from __future__ import annotations

from langchain_core.language_models import BaseChatModel

from app.llm.qwen_factory import qwen_factory


def get_llm(role: str = "default") -> BaseChatModel | None:
    """All agents route through Qwen Cloud via the centralized factory."""
    return qwen_factory.get_for_role(role)