# Implementation & Push Checklist (`workflow-orchestrator`)

- [x] **Milestone 1 (Push 1): Repository Scaffold, Tooling Config & Design Alignment Docs**
  - [x] Root `.gitignore`, `.gitattributes`, and subsystem-scoped `README.md`
  - [x] `package.json`, `tsconfig.json`, `tsconfig.renderer.json`, `eslint.config.mjs`, `.prettierrc.json`
  - [x] `docs/SPEC.md`, `docs/DESIGN-ALIGNMENT.md`, `docs/CHECKLIST.md`
  - [x] Install dependencies (`npm install`) & push Milestone 1 to `origin main`

- [x] **Milestone 2 (Push 2): Shared Contracts, Pure Domain Core & SQLite Store**
  - [x] `src/shared/` (`errors.ts`, `types.ts`, `validation.ts`, `api.ts`)
  - [x] `src/core/` (`spec-parser.ts`, `validator.ts`, `twin-graph.ts`, `policy.ts`, `telemetry.ts`, `index.ts`)
  - [x] `src/store/` (`schema.ts`, `database.ts`, `index.ts`) with `node:sqlite` WAL + FTS5
  - [x] Verify `npm run lint` & `tsc -p tsconfig.json --noEmit`, push Milestone 2

- [x] **Milestone 3 (Push 3): Sandbox, Adapters, Orchestrator Engine & Daemon**
  - [x] `src/sandbox/` (`contracts.ts`, `process-runner.ts`, `git-worktree.ts`, `index.ts`)
  - [x] `src/adapters/` (`contracts.ts`, `resource-broker.ts`, `tool-runner.ts`, `cli-stream.ts`, `acp-client.ts`, `native-api.ts`, `index.ts`)
  - [x] `src/engines/` (`planner.ts`, `certifier.ts`, `orchestrator.ts`, `index.ts`)
  - [x] `src/server/` (`secret-vault.ts`, `http-router.ts`, `runtime.ts`) + `src/electron/` (`main.ts`, `preload.ts`) + `scripts/` (`build.mjs`, `dev.mjs`, `start.mjs`, `run-verify.mjs`)
  - [x] Verify `npm run lint`, host `tsc`, and `esbuild` main/preload build, push Milestone 3

- [x] **Milestone 4 (Push 4): Light DirectUI Workbench Renderer (`ZH` / `EN`)**
  - [x] `renderer/index.html`, `renderer/vite.config.ts`, `renderer/src/styles/theme.css`
  - [x] `renderer/src/i18n.ts`, `renderer/src/api/client.ts`, `renderer/src/components/Icons.tsx`
  - [x] `WorkflowsView` (Requirements Import -> GoalSpec -> WBS & Twin-Graph Design -> Validation -> Change Impact -> Trial Run -> Lock Version)
  - [x] `WorkstationView` (Live Flow Canvas + WBS + Node Inspector + Pause/Resume/Retry/Human Gate/GhostNode/Rollback)
  - [x] `CapabilitiesView` (Capability Pool, Models, Health/Circuit Status) + `RunsAuditView` (Versions, Runs & FTS5 Evidence Traceability)
  - [x] Verify `npm run lint`, `npm run typecheck`, `npm run build`, push Milestone 4

- [x] **Milestone 5 (Push 5): Lean Verification Gates, Smoke Check & Final README**
  - [x] `verify/planner-and-validator.verify.ts`
  - [x] `verify/orchestrator-and-sandbox.verify.ts`
  - [x] `verify/fullstack-smoke.verify.ts`
  - [x] Full `npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify:gates`, loopback `start:web` smoke (`ORCH_SMOKE_EXIT=1`), final push
  - Note: Packaged Electron desktop binary smoke (`scripts/start.mjs`) is deferred in offline/sandboxed CI environments lacking downloaded Electron runtime binaries (`node_modules/electron/dist/electron.exe`).
