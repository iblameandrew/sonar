"""Qwen Cloud model catalogue — June 2026 (DashScope / Model Studio)."""

from __future__ import annotations

from dataclasses import dataclass

# Pinned releases for reproducible runs
QWEN3_7_MAX = "qwen3.7-max-2026-06-08"
QWEN3_7_PLUS = "qwen3.7-plus-2026-06-08"
QWEN3_6_PLUS = "qwen3.6-plus-2026-04-02"
QWEN3_6_FLASH = "qwen3.6-flash-2026-04-02"
QWEN3_5_FLASH = "qwen3.5-flash-2026-04-02"
QWEN3_VL_PLUS = "qwen3-vl-plus"
QWEN3_VL_MAX = "qwen3-vl-max"
QWEN_CODER = "qwen2.5-coder-32b-instruct"

# Legacy (backward compatibility)
QWEN_MAX = "qwen-max"
QWEN_PLUS = "qwen-plus"
QWEN_TURBO = "qwen-turbo"
QWEN_72B = "qwen2.5-72b-instruct"

DEFAULT_MODEL = QWEN3_7_MAX


@dataclass(frozen=True)
class ModelEntry:
    id: str
    label: str
    category: str
    best_for: str


MODEL_CATALOG: tuple[ModelEntry, ...] = (
    ModelEntry(QWEN3_7_MAX, "Qwen3.7 Max", "flagship", "Complex reasoning, agentic tasks, coding"),
    ModelEntry(QWEN3_7_PLUS, "Qwen3.7 Plus", "balanced", "General use, multimodal, agent workflows"),
    ModelEntry(QWEN3_6_PLUS, "Qwen3.6 Plus", "balanced", "Balanced throughput and quality"),
    ModelEntry(QWEN3_6_FLASH, "Qwen3.6 Flash", "fast", "High-throughput lighter agents"),
    ModelEntry(QWEN3_5_FLASH, "Qwen3.5 Flash", "fast", "Cost-effective simple tasks"),
    ModelEntry(QWEN3_VL_PLUS, "Qwen3 VL Plus", "vision", "Image + video understanding, OCR"),
    ModelEntry(QWEN3_VL_MAX, "Qwen3 VL Max", "vision", "Strongest multimodal reasoning"),
    ModelEntry(QWEN_CODER, "Qwen2.5 Coder 32B", "coder", "Code generation and architecture"),
    ModelEntry(QWEN_MAX, "Qwen Max (legacy)", "legacy", "Backward compatibility"),
    ModelEntry(QWEN_PLUS, "Qwen Plus (legacy)", "legacy", "Backward compatibility"),
    ModelEntry(QWEN_TURBO, "Qwen Turbo (legacy)", "legacy", "Backward compatibility"),
    ModelEntry(QWEN_72B, "Qwen2.5 72B (legacy)", "legacy", "Older general instruct"),
)


def catalog_for_api() -> list[dict[str, str]]:
    return [
        {"id": m.id, "label": m.label, "category": m.category, "best_for": m.best_for}
        for m in MODEL_CATALOG
    ]


def catalog_ids() -> list[str]:
    return [m.id for m in MODEL_CATALOG]