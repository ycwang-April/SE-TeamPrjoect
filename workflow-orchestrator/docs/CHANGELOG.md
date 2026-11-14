# Changelog (`workflow-orchestrator`)

## v0.1.0 — Milestone 5: Verification Gates & Documentation
- Added lean verification suite (`verify/planner-and-validator.verify.ts`, `verify/orchestrator-and-sandbox.verify.ts`, `verify/fullstack-smoke.verify.ts`) covering PRD parsing, 3-level validation, fail-closed version locking, isolated Git worktree execution, Human Gate suspension/approval, runtime `GhostNode` splicing, conditional branch skipping, bounded `Restore` rework via Git rescue refs, FTS5 search, Bearer auth, and SSE.
- Fixed `computeNextFrontier` fail-edge OR triggering for recovery nodes with multiple upstream failure sources and enabled multi-iteration `restore` re-arming within rework budget.
- Added standalone pure-Node loopback web launcher (`scripts/serve-web.mjs` via `npm run start:web`).

## v0.1.0 — Milestone 4: Light DirectUI Workbench Renderer (`ZH` / `EN`)
- Implemented light-mode React 19 + `@xyflow/react` 12 workbench across `WorkflowsView`, `WorkstationView`, `CapabilitiesView`, and `RunsAuditView` with bilingual `ZH` / `EN` switching and live SSE updates.

## v0.1.0 — Milestone 3: Sandbox, Adapters, Orchestrator Engine & Daemon
- Implemented `GitWorktreeManager`, `SandboxProcessRunner`, `CapabilityHub`, `WorkflowPlannerEngine`, `ExecutionCertifier`, `WorkflowOrchestratorEngine`, loopback HTTP/SSE server (`127.0.0.1`), Electron 44 main/preload shell, and esbuild/Vite build pipeline.

## v0.1.0 — Milestone 2: Domain Core & SQLite Store
- Implemented `GoalSpec` Markdown parser, WBS + Twin-Graph planner, 3-level validator, Change Impact Analyzer, Trial Run simulator, and `node:sqlite` WAL + FTS5 persistence store with seeded sample workflow.

## v0.1.0 — Milestone 1: Subsystem Scaffold & Design Alignment
- Initialized subsystem package configuration, TypeScript/ESLint/Prettier tooling, and alignment documentation against the V2.0 workflow design spec.
