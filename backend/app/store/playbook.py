from __future__ import annotations

import json
from pathlib import Path

from app.models.agent import DependencyEntry, SocialPlaybook

DATA_DIR = Path(__file__).resolve().parents[2] / "data"


class PlaybookStore:
    def __init__(self, log_path: Path | None = None) -> None:
        self.playbook = SocialPlaybook()
        self.log_path = log_path or DATA_DIR / "playbook.jsonl"
        self.log_path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, entry: DependencyEntry) -> None:
        self.playbook.add(entry)
        with self.log_path.open("a", encoding="utf-8") as f:
            f.write(entry.model_dump_json() + "\n")

    def load_from_log(self) -> None:
        if not self.log_path.exists():
            return
        entries: list[DependencyEntry] = []
        with self.log_path.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    entries.append(DependencyEntry.model_validate_json(line))
        self.playbook = SocialPlaybook(entries=entries)

    def snapshot(self) -> SocialPlaybook:
        return SocialPlaybook(entries=list(self.playbook.entries))

    def export_json(self) -> str:
        return json.dumps(self.playbook.to_matrix_summary(), indent=2)