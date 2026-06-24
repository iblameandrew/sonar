from __future__ import annotations

from pydantic import BaseModel, Field


class RunMetrics(BaseModel):
    mode: str
    quality_score: float = 0.0
    iterations: int = 0
    conflicts_detected: int = 0
    conflicts_resolved: int = 0
    negotiations: int = 0
    subtasks_completed: int = 0
    features_complete: float = 0.0
    tokens_estimate: int = 0
    time_ms: int = 0
    transparency_events: int = 0


class ComparisonMetrics(BaseModel):
    society: RunMetrics = Field(default_factory=lambda: RunMetrics(mode="society"))
    baseline: RunMetrics = Field(default_factory=lambda: RunMetrics(mode="baseline"))
    society_wins_quality: bool = False
    society_wins_efficiency: bool = False
    summary: str = ""

    def compute_summary(self) -> str:
        sq = self.society.quality_score
        bq = self.baseline.quality_score
        self.society_wins_quality = sq >= bq
        self.society_wins_efficiency = (
            self.society.iterations <= self.baseline.iterations
            and self.society.conflicts_resolved >= self.baseline.conflicts_resolved
        )
        self.summary = (
            f"Society quality {sq:.2f} vs baseline {bq:.2f}; "
            f"iterations {self.society.iterations} vs {self.baseline.iterations}; "
            f"conflicts resolved {self.society.conflicts_resolved} vs {self.baseline.conflicts_resolved}"
        )
        return self.summary