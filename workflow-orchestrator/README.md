# Workflow Orchestrator (`workflow-orchestrator`)

Requirements-to-Execution Real-Time Workflow Orchestration Subsystem.

This subsystem begins at receiving a confirmed **Requirements Document (Markdown / PRD)** and handles autonomous planning, 3-level consistency validation, dual-mode graph/form design editing with change impact analysis, dry-run simulation, immutable version snapshots, and real-time multi-node orchestration inside isolated Git worktrees.

## Quick Start

Requirements: **Node.js >= 24.0.0** (uses native `node:sqlite`) and **Git** on `PATH`.

```bash
cd workflow-orchestrator
npm install
npm run typecheck
npm run build
npm run verify:gates
```

### Launch Modes

- **Web Workbench (pure Node 24 + loopback HTTP/SSE)**:
  ```bash
  npm run start:web
  ```
  Prints a tokenized `http://127.0.0.1:4190/?apiBaseUrl=...&token=...` URL ready to open in any browser.
- **Electron 44 Desktop Workbench**:
  ```bash
  npm start
  ```
  Requires the Chromium Electron runtime binary (installed during `npm install` when online).
- **Development Mode (Vite HMR + live backend watch)**:
  ```bash
  npm run dev
  ```

## Architecture Overview

| Layer | Directory / Entry | Responsibility |
| --- | --- | --- |
| **Shared Contracts** | `src/shared/` (`types.ts`, `api.ts`, `validation.ts`, `errors.ts`) | Domain models, HTTP/SSE DTOs, strict JSON validators, fail-closed errors |
| **Domain Core** | `src/core/` (`spec-parser.ts`, `twin-graph.ts`, `validator.ts`, `trial-simulator.ts`, `telemetry.ts`, `policy.ts`) | PRD -> `GoalSpec` parsing, hierarchical WBS + Twin-Graph synthesis, forward cycle & conditional/join resolution, 3-level validation, Change Impact Analysis, isolated Trial Run |
| **Persistence** | `src/store/` (`schema.ts`, `database.ts`) | `node:sqlite` WAL database, transaction savepoints, FTS5 full-text evidence index |
| **Sandbox** | `src/sandbox/` (`process-runner.ts`, `git-worktree.ts`) | Symlink-safe `resolveInside` workspace confinement, bounded timeouts, isolated Git worktrees, Git checkpoint tags, non-destructive `refs/orchestrator-backup/...` rescue refs |
| **Capabilities** | `src/adapters/` (`resource-broker.ts`, `tool-runner.ts`, `cli-stream.ts`, `acp-client.ts`, `native-api.ts`) | Concurrency slot broker, ACP client, CLI JSONL stream parser, native OpenAI-compatible / Anthropic API runner (with deterministic offline synthesis when unconfigured) |
| **Engines** | `src/engines/` (`planner.ts`, `certifier.ts`, `orchestrator.ts`) | Draft lifecycle + version freezing, shell gate & independent QA certification, concurrent frontier execution, Pause/Resume/Retry/Human Gate/`GhostNode`/Bounded Rework |
| **Host & Desktop** | `src/server/` (`http-router.ts`, `secret-vault.ts`, `runtime.ts`), `src/electron/` | `127.0.0.1` loopback HTTP REST + multiplexed SSE with Bearer auth, Electron 44 sandboxed window shell |
| **Workbench UI** | `renderer/src/` (`WorkflowsView.tsx`, `WorkstationView.tsx`, `CapabilitiesView.tsx`, `RunsAuditView.tsx`, `TwinGraphCanvas.tsx`) | Crisp Light DirectUI (`#f8fafc` / `#ffffff`) desktop/web console with `ZH` / `EN` toggle |
| **Verification** | `verify/` (`planner-and-validator.verify.ts`, `orchestrator-and-sandbox.verify.ts`, `fullstack-smoke.verify.ts`) | End-to-end automated verification gates |

## Design Documentation

- [`docs/SPEC.md`](./docs/SPEC.md) — Formal four-layer technical specification
- [`docs/DESIGN-ALIGNMENT.md`](./docs/DESIGN-ALIGNMENT.md) — Mapping between V2.0 workflow orchestration requirements and modern implementation choices
- [`docs/CHECKLIST.md`](./docs/CHECKLIST.md) — Incremental implementation & verification checklist
- [`docs/CHANGELOG.md`](./docs/CHANGELOG.md) — Milestone delivery log
