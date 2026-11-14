# SE-TeamPrjoect

Software Engineering team project repository.

## Implemented Subsystem: [`workflow-orchestrator/`](./workflow-orchestrator/README.md)

This folder implements the **Requirements-to-Execution Real-Time Workflow Orchestration Subsystem** — starting strictly from receiving a confirmed Requirements Document / PRD and carrying the pipeline end-to-end through:

1. **Specification Extraction & Validation**: Parses Markdown requirements into a structured `GoalSpec` (`FR-xx`, `AC-xx`, inputs, outputs, constraints, source-tagged `doc` / `suggested` assumptions) and enforces 3-level structural, requirement/contract, and capability/circuit checks (`Error` / `Warning` / `Info`).
2. **Task Decomposition & Twin-Graph Compilation**: Synthesizes hierarchical phases (`Phase -> Task -> Subtask`) paired with an executable **Twin-Graph** (forward execution edges, parallel branches, conditional routes, join barriers, bounded rework loops, and explicit restore checkpoints) complete with per-node **Planning Rationale**.
3. **Dual-Mode Design & Version Isolation**: Supports form + graph canvas edits, real-time **Change Impact Analysis**, isolated **Trial Run** simulation, and immutable **Version Snapshots** (`v1.0`, `v2.0`, ...) binding every live execution run.
4. **Real-Time Orchestrator & Workspace Isolation**: Executes independent ready nodes concurrently under a bounded resource-slot broker inside isolated Git Worktrees, handles conditional path skipping (`skipped`), bounded rework loops with non-destructive `refs/orchestrator-backup/...` rescue refs, human-gate suspension (`waiting_human`), pause/resume/retry controls, runtime `GhostNode` splicing, and `node:sqlite` WAL + FTS5 evidence/audit traceability over SSE.
5. **DirectUI Workbench**: Crisp Light-mode UI (`Electron 44` / standalone Web + `React 19` + `@xyflow/react` 12) with bilingual `ZH` / `EN` support.

### Scope Boundary
Upstream requirement-elicitation chatrooms, organizational knowledge hubs, and platform self-evolution daemons sit outside this subsystem; [`workflow-orchestrator/`](./workflow-orchestrator/README.md) assumes a confirmed requirements document as its entry contract.

See [`workflow-orchestrator/docs/DESIGN-ALIGNMENT.md`](./workflow-orchestrator/docs/DESIGN-ALIGNMENT.md) and [`workflow-orchestrator/docs/SPEC.md`](./workflow-orchestrator/docs/SPEC.md) for details.
