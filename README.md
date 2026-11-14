# SE-TeamPrjoect

Software Engineering team project repository.

## Implemented Subsystem: [`workflow-orchestrator/`](file:///d:/Desktop/Courses_27/SE/SE-TeamPrjoect/workflow-orchestrator/README.md)

This folder implements the **Requirements-to-Execution Real-Time Workflow Orchestration Subsystem** — starting strictly from receiving a confirmed Requirements Document / PRD and carrying the pipeline end-to-end through:

1. **Specification Extraction & Validation**: Parses Markdown requirements into a structured `GoalSpec` (`FR-xx`, `AC-xx`, inputs, outputs, constraints, traceable assumptions) and checks completeness, structural invariants, capability readiness, and write-scope conflicts (`Error` / `Warning` / `Info`).
2. **Task Decomposition & Twin-Graph Compilation**: Synthesizes hierarchical phases (`Phase -> Task -> Subtask`) paired with an executable **Twin-Graph** (forward execution edges, parallel branches, conditional branches, join barriers, bounded rework edges, and explicit restore checkpoints) complete with per-node **Planning Rationale**.
3. **Dual-Mode Design & Version Isolation**: Supports manual DAG/spec edits, real-time **Change Impact Analysis**, isolated **Trial Run** simulation, and immutable **Version Snapshots** (`v1.0`, `v2.0`, ...) binding every live execution run.
4. **Real-Time Orchestrator & Workspace Isolation**: Executes independent ready nodes concurrently under a bounded resource-slot broker, handles conditional path skipping (`skipped`), bounded rework loops with Git Worktree rescue refs, human-gate suspension (`waiting_human`), pause/resume/retry controls, runtime `GhostNode` amendment, and full FTS5 evidence/audit traceability over SSE.
5. **DirectUI Workbench**: Electron 44 + React 19 + `@xyflow/react` 12 crisp light-mode desktop interface with bilingual (`ZH` / `EN`) support.

### Scope Boundary
Upstream requirement-elicitation chatrooms, organizational knowledge hubs, and platform self-evolution daemons sit outside this subsystem; `workflow-orchestrator/` assumes a confirmed requirements document as its entry contract.

See [`workflow-orchestrator/docs/DESIGN-ALIGNMENT.md`](file:///d:/Desktop/Courses_27\SE\SE-TeamPrjoect\workflow-orchestrator\docs\DESIGN-ALIGNMENT.md) and [`workflow-orchestrator/docs/SPEC.md`](file:///d:/Desktop/Courses_27\SE\SE-TeamPrjoect\workflow-orchestrator\docs\SPEC.md) for architecture details.
