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

- [ ] **Milestone 3 (Push 3): Sandbox, Adapters, Orchestrator Engine & Daemon**
  - [ ] `src/sandbox/` (`contracts.ts`, `process-runner.ts`, `git-worktree.ts`, `index.ts`)
  - [ ] `src/adapters/` (`contracts.ts`, `resource-broker.ts`, `tool-runner.ts`, `cli-stream.ts`, `acp-client.ts`, `native-api.ts`, `index.ts`)
  - [ ] `src/engines/` (`planner.ts`, `certifier.ts`, `orchestrator.ts`, `index.ts`)
  - [ ] `src/server/` (`secret-vault.ts`, `http-router.ts`, `runtime.ts`) + `src/electron/` (`main.ts`, `preload.ts`) + `scripts/` (`build.mjs`, `dev.mjs`, `start.mjs`, `run-verify.mjs`)
  - [ ] Verify `npm run lint`, host `tsc`, and `esbuild` main/preload build, push Milestone 3

- [ ] **Milestone 4 (Push 4): Light DirectUI Workbench Renderer (`ZH` / `EN`)**
  - [ ] `renderer/index.html`, `renderer/vite.config.ts`, `renderer/src/styles/theme.css`
  - [ ] `renderer/src/i18n.ts`, `renderer/src/api/client.ts`, `renderer/src/components/Icons.tsx`
  - [ ] `WorkflowsView` (Requirements Import -> GoalSpec -> WBS & Twin-Graph Design -> Validation -> Change Impact -> Trial Run -> Lock Version)
  - [ ] `WorkstationView` (Live Flow Canvas + WBS + Node Inspector + Pause/Resume/Retry/Human Gate/GhostNode/Rollback)
  - [ ] `CapabilitiesView` (Capability Pool, Models, Health/Circuit Status) + `RunsAuditView` (Versions, Runs & FTS5 Evidence Traceability)
  - [ ] Verify `npm run lint`, `npm run typecheck`, `npm run build`, push Milestone 4

- [ ] **Milestone 5 (Push 5): Lean Verification Gates, Electron Smoke & Final README**
  - [ ] `verify/planner-and-validator.verify.ts`
  - [ ] `verify/orchestrator-and-sandbox.verify.ts`
  - [ ] `verify/fullstack-smoke.verify.ts`
  - [ ] Full `npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify:gates`, Electron smoke run, final push
