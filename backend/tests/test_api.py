from __future__ import annotations

from fastapi.testclient import TestClient


def test_health(client: TestClient) -> None:
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["system"] == "Qualitative Self-Attention"
    assert body["project"] == "QSA"
    assert body["api_version"] == "genai-v2"
    assert body["llm"] in ("Qwen Cloud", "OpenRouter")


def test_attention_catalogue(client: TestClient) -> None:
    res = client.get("/api/attention/catalogue")
    assert res.status_code == 200
    functions = res.json()["functions"]
    assert len(functions) >= 14
    assert {f["id"] for f in functions} >= {"auditor", "negotiator", "attention"}


def test_default_policy_and_normalize(client: TestClient) -> None:
    default = client.get("/api/attention/policy/default")
    assert default.status_code == 200
    payload = default.json()
    assert "attention_head_1" in payload["policy"]["heads"]
    assert payload["preview"]

    raw = {
        "heads": {
            "custom": {
                "primary_focus": ["messenger"],
                "weight_distribution": {"messenger": 1},
            }
        }
    }
    norm = client.post("/api/attention/policy/normalize", json=raw)
    assert norm.status_code == 200
    weights = norm.json()["policy"]["heads"]["custom"]["weight_distribution"]
    assert abs(weights["messenger"] - 1.0) < 1e-9


def test_idle_state_and_canvas(client: TestClient) -> None:
    state = client.get("/api/state").json()
    assert state["running"] is False
    assert state["execution_mode"] == "idle"
    assert state["colony"]["world_size"] == 96
    assert len(state["agents"]) == 48

    canvas = client.get("/api/canvas").json()
    assert canvas["subtasks"]
    assert client.get("/api/playbook").json()["count"] == 0
    assert client.get("/api/raptor").json()["nodes"] == []
    assert client.get("/api/metrics").status_code == 200


def test_qwen_status_without_key(client: TestClient) -> None:
    status = client.get("/api/qwen/status")
    assert status.status_code == 200
    assert "configured" in status.json() or "backend" in status.json()
    usage = client.get("/api/qwen/usage")
    assert usage.status_code == 200


def test_genai_configure(client: TestClient) -> None:
    res = client.post("/api/genai/configure", json={"backend": "openrouter"})
    assert res.status_code == 200
    client.post("/api/qwen/setup", json={"backend": "dashscope"})


def test_start_validation(client: TestClient) -> None:
    too_small = client.post("/api/sim/society", json={"agent_count": 1, "max_ticks": 12})
    assert too_small.status_code == 422
    too_fast = client.post("/api/sim/society", json={"speed": 99})
    assert too_fast.status_code == 422


def test_society_start_and_reset(client: TestClient) -> None:
    started = client.post(
        "/api/sim/society",
        json={"max_ticks": 4, "speed": 10.0, "agent_count": 4, "prompt": "CI smoke"},
    )
    assert started.status_code == 200
    body = started.json()
    assert body["status"] == "society_started"
    assert body["agents"] == 4
    assert body["goal"] == "CI smoke"

    stopped = client.post("/api/sim/stop")
    assert stopped.status_code == 200
    assert stopped.json()["status"] == "stopped"

    reset = client.post("/api/sim/reset")
    assert reset.json()["status"] == "reset"
    idle = client.get("/api/state").json()
    assert idle["running"] is False
    assert idle["execution_mode"] == "idle"


def test_season_force_and_speed(client: TestClient) -> None:
    season = client.post(
        "/api/season/force",
        json={"macro_season": "sharp", "micro_season": "festival", "design_phase": "polish"},
    )
    assert season.status_code == 200
    assert season.json()["micro_season"] == "festival"

    speed = client.post("/api/sim/speed", json={"speed": 2.5})
    assert speed.json()["speed"] == 2.5


def test_missing_agent_routes(client: TestClient) -> None:
    assert client.get("/api/agents/nope").status_code == 404
    assert client.post("/api/sim/inject-conflict").status_code == 400
    assert client.post("/api/sim/advance-phase").status_code == 400
