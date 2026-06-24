# THE ATTENTION AGENT SOCIETY — VoxForge

Hackathon Track 3: **Agent Society Design**. A living collective of specialized agents that collaboratively designs and builds **VoxForge** — a real-time collaborative engineering workspace.

## Track 3 Showcase

| Requirement | Implementation |
|---|---|
| Task decomposition & role assignment | `Decomposer` assigns subtasks to specialist agents via Attention matching |
| Dialogue & negotiation | `Negotiator` runs structured proposal/counter-offer rounds |
| Conflict resolution | `ConflictResolver` triggers on high Auditor regret — voting & compromise |
| Efficiency gain | Dual mode: **Run Society** vs **Run Single Agent** with live metrics dashboard |

## Specialist Cast

- **Voxel Architect** — Conway pixel-art Three.js visualization
- **Orchestrator** — LangGraph + SSE pipeline
- **Optimizer** — Benchmark harness & metrics
- **Integrator** — FastAPI + frontend glue
- **UX Weaver** — Dashboard, negotiation panel, demo controls
- **Critic / Evaluator** — Society vs baseline comparison

## Learning Loop

**PERFORM → DECOMPOSE → ATTEND → NEGOTIATE → AUDIT → CONFLICT → REFORM → CONFESS**

## Run

```bash
# Backend
cd backend && pip install -e . && uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend && npm install && npm run dev
```

Open http://localhost:5173

### Demo Buttons

- **Run Society** — multi-agent collaborative mode
- **Run Single Agent** — baseline comparison
- **Inject Conflict** — trigger conflict resolution demo
- **Step** / **Advance Phase** / **Show Metrics**

Optional: `OPENAI_API_KEY` for LLM-enhanced judgments (heuristic fallback included).