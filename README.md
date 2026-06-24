# THE ATTENTION AGENT

A generative-AI simulation of a society in which the transformer architecture is reborn as **qualitative social physics**. No dot-products. No softmax. Every neural mechanism is an agent playing a philosophical role.

## Architecture

| Deep Learning | Agent Role |
|---|---|
| Cost Function | **The Auditor** — measures regret |
| Feed-Forward | **The Messenger** — carries activation |
| Backward Connection | **The Confessor** — flows consequences to causes |
| Gradient Descent | **The Reformer** — pushes agents toward less regret |
| Weights | **The Custodian** — persistent social memory |
| Attention | **The Attention Agent** — qualitative dependency judgment |

Each tick: **PERFORM → ATTEND → AUDIT → REFORM → CONFESS**

## Quick Start

### Backend

```bash
cd backend
pip install -e .
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

### Environment

```bash
# Optional — heuristic fallback works without it
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

### Windows (both servers)

```powershell
.\scripts\dev.ps1
```

## API

| Endpoint | Description |
|---|---|
| `GET /api/stream` | SSE event stream |
| `GET /api/state` | Full simulation snapshot |
| `POST /api/sim/start` | Start simulation |
| `POST /api/sim/pause` | Pause/resume |
| `POST /api/sim/step` | Single tick |
| `POST /api/season/force` | Force macro/micro season |
| `GET /api/playbook` | Social playbook |
| `GET /api/raptor` | Seasonal memory tree |

## Visualization

Three.js voxel-art world with:
- InstancedMesh agents encoding verbs/nouns/adjectives
- Glowing dependency connections (kind = color, strength = thickness)
- Institution structures with build/dissolve animations
- Seasonal palette transitions
- Tweakpane controls for every mechanism layer
- Click-to-inspect, minimap, screenshot, glTF export