/**
 * Single-writer SQLite WAL + FTS5 Store (`node:sqlite`) managing Workspaces,
 * Workflows, GoalSpecs, Validation/Trial/Impact Reports, Immutable Versions,
 * Live Runs, Twin-Graph Nodes/Edges, Attempts, Checkpoints, Interventions,
 * Capabilities, Model Providers, Transcripts, and Audit Ledger.
 */

import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {
  parseRequirementsMarkdown,
  planTwinGraphFromGoalSpec,
} from '../core/spec-parser.ts';
import {computeCapabilityHealthProfile} from '../core/telemetry.ts';
import {validateWorkflowSpec} from '../core/validator.ts';
import type {EvidenceSearchHit} from '../shared/api.ts';
import {OrchestratorError} from '../shared/errors.ts';
import type {
  AgentRole,
  AuditLedgerEntry,
  CapabilityAdapterManifest,
  CapabilityHealthProfile,
  ChangeImpactReport,
  CheckpointRecord,
  ExecutorKind,
  GoalSpec,
  GraphEdge,
  GraphEdgeKind,
  GraphNode,
  GraphNodeStatus,
  InterventionItem,
  ModelCatalogEntry,
  ModelProviderConfig,
  NodeAttemptRecord,
  PermissionTier,
  RunStatus,
  TranscriptMessage,
  TranscriptSession,
  TrialRunReport,
  WorkflowNodeKind,
  WorkflowRecord,
  WorkflowRunRecord,
  WorkflowStatus,
  WorkflowVersionSnapshot,
  WorkspaceEntry,
} from '../shared/types.ts';
import {
  BUILTIN_CAPABILITIES,
  DEFAULT_MODEL_PROVIDERS,
  INITIAL_SCHEMA_SQL,
  SAMPLE_REQUIREMENTS_MARKDOWN,
  SCHEMA_VERSION,
} from './schema.ts';

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function buildSafeFtsQuery(raw: string): string {
  const tokens = raw
    .trim()
    .split(/\s+/)
    .map(t => t.replace(/"/g, '').trim())
    .filter(t => t.length > 0);
  if (tokens.length === 0) {
    return '';
  }
  return tokens.map(t => `"${t}"`).join(' OR ');
}

export class OrchestratorStore {
  readonly db: DatabaseSync;
  private readonly savepointCounter = {val: 0};

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), {recursive: true});
    this.db = new DatabaseSync(dbPath);
    this.db.exec(INITIAL_SCHEMA_SQL);
    this.ensureSchemaVersion();
    this.seedBuiltins();
  }

  close(): void {
    this.db.close();
  }

  private ensureSchemaVersion(): void {
    const now = new Date().toISOString();
    const row = this.db
      .prepare('SELECT value_json FROM meta_kv WHERE key = ?')
      .get('schema_version') as {value_json: string} | undefined;
    if (!row) {
      this.db
        .prepare(
          'INSERT INTO meta_kv (key, value_json, updated_at) VALUES (?, ?, ?)',
        )
        .run('schema_version', JSON.stringify(SCHEMA_VERSION), now);
    }
  }

  private seedBuiltins(): void {
    const now = new Date().toISOString();
    const insertCap = this.db.prepare(
      `INSERT OR IGNORE INTO capabilities (id, manifest_json, enabled, probe_ok, probe_message, probed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const cap of BUILTIN_CAPABILITIES) {
      const autoReady =
        cap.transport === 'native-api' ||
        cap.transport === 'local-tool' ||
        cap.transport === 'human-gate' ||
        cap.transport === 'control-plane';
      insertCap.run(
        cap.id,
        JSON.stringify(cap),
        cap.enabled ? 1 : 0,
        autoReady ? 1 : null,
        autoReady
          ? 'Built-in deterministic/API capability ready'
          : 'Not probed yet',
        autoReady ? now : null,
        now,
      );
    }

    const insertProvider = this.db.prepare(
      `INSERT OR IGNORE INTO model_providers (id, name, protocol, base_url, models_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const p of DEFAULT_MODEL_PROVIDERS) {
      insertProvider.run(
        p.id,
        p.name,
        p.protocol,
        p.baseUrl,
        JSON.stringify(p.models),
        now,
      );
    }
  }

  savepoint<T>(fn: () => T): T {
    this.savepointCounter.val += 1;
    const sp = `sp_${this.savepointCounter.val}`;
    this.db.exec(`SAVEPOINT ${sp}`);
    try {
      const result = fn();
      this.db.exec(`RELEASE SAVEPOINT ${sp}`);
      return result;
    } catch (err) {
      this.db.exec(`ROLLBACK TO SAVEPOINT ${sp}`);
      this.db.exec(`RELEASE SAVEPOINT ${sp}`);
      throw err;
    }
  }

  seedSampleWorkflowIfEmpty(sampleWorkspacePath: string): void {
    const existing = this.listWorkspaces();
    if (existing.length > 0) {
      return;
    }
    const ws = this.createWorkspace({
      name: 'Sample Ledger Workspace',
      rootPath: sampleWorkspacePath,
      defaultBranch: 'main',
      verifyCommand: 'node -e "console.log(\'Verification gate passed\')"',
      description:
        'Pre-seeded sample Git workspace for exploring Requirements-to-Execution workflow orchestration.',
    });

    const wfId = `wf-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const goalSpec = parseRequirementsMarkdown({
      workflowId: wfId,
      rawMarkdown: SAMPLE_REQUIREMENTS_MARKDOWN,
      defaultVerifyCommand: ws.verifyCommand,
    });
    const caps = this.listCapabilities();
    const health = this.listCapabilityHealth();
    const planned = planTwinGraphFromGoalSpec({
      scopeId: wfId,
      goalSpec,
      capabilities: caps,
      healthProfiles: health,
      permissionTier: 'supervised',
      verifyCommand: ws.verifyCommand,
    });
    const validation = validateWorkflowSpec({
      workflowId: wfId,
      goalSpec,
      nodes: planned.nodes,
      edges: planned.edges,
      capabilities: caps,
      healthProfiles: health,
      permissionTier: 'supervised',
      maxReworkIterations: 3,
    });

    this.savepoint(() => {
      this.db
        .prepare(
          `INSERT INTO workflows (id, workspace_id, code, title, description, status, current_version_number, permission_tier, verify_command, max_rework_iterations, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          wfId,
          ws.id,
          'WF-001',
          goalSpec.title,
          goalSpec.goal,
          validation.valid ? 'validated' : 'draft',
          0,
          'supervised',
          ws.verifyCommand,
          3,
          now,
          now,
        );
      this.saveGoalSpec(goalSpec);
      this.replaceGraph(wfId, planned.nodes, planned.edges);
      this.saveValidationReport(validation);
      this.appendAudit({
        workflowId: wfId,
        runId: null,
        category: 'plan',
        author: 'Orchestrator Bootstrap',
        title: 'Sample workflow synthesized from PRD',
        detail: `Generated ${planned.nodes.length} Twin-Graph nodes covering ${goalSpec.requirements.length} requirements.`,
      });
    });
  }

  // ---- Workspaces ----

  listWorkspaces(): WorkspaceEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM workspaces ORDER BY created_at DESC')
      .all() as Record<string, unknown>[];
    return rows.map(r => ({
      id: String(r['id']),
      name: String(r['name']),
      rootPath: String(r['root_path']),
      defaultBranch: String(r['default_branch']),
      verifyCommand: String(r['verify_command']),
      description: String(r['description'] ?? ''),
      createdAt: String(r['created_at']),
    }));
  }

  getWorkspace(id: string): WorkspaceEntry {
    const row = this.db
      .prepare('SELECT * FROM workspaces WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!row) {
      throw new OrchestratorError(
        'NOT_FOUND',
        `Workspace ${id} not found`,
        404,
      );
    }
    return {
      id: String(row['id']),
      name: String(row['name']),
      rootPath: String(row['root_path']),
      defaultBranch: String(row['default_branch']),
      verifyCommand: String(row['verify_command']),
      description: String(row['description'] ?? ''),
      createdAt: String(row['created_at']),
    };
  }

  createWorkspace(input: {
    readonly name: string;
    readonly rootPath: string;
    readonly defaultBranch?: string;
    readonly verifyCommand?: string;
    readonly description?: string;
  }): WorkspaceEntry {
    const now = new Date().toISOString();
    const id = `ws-${randomUUID().slice(0, 8)}`;
    const entry: WorkspaceEntry = {
      id,
      name: input.name,
      rootPath: input.rootPath,
      defaultBranch: input.defaultBranch ?? 'main',
      verifyCommand:
        input.verifyCommand ?? 'node -e "console.log(\'Gate OK\')"',
      description: input.description ?? '',
      createdAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO workspaces (id, name, root_path, default_branch, verify_command, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.name,
        entry.rootPath,
        entry.defaultBranch,
        entry.verifyCommand,
        entry.description,
        entry.createdAt,
      );
    return entry;
  }

  // ---- Workflows, GoalSpec, Reports & Versions ----

  private mapWorkflowRow(r: Record<string, unknown>): WorkflowRecord {
    return {
      id: String(r['id']),
      workspaceId: String(r['workspace_id']),
      code: String(r['code']),
      title: String(r['title']),
      description: String(r['description'] ?? ''),
      status: String(r['status']) as WorkflowStatus,
      currentVersionNumber: Number(r['current_version_number'] ?? 0),
      permissionTier: String(r['permission_tier']) as PermissionTier,
      verifyCommand: String(r['verify_command']),
      maxReworkIterations: Number(r['max_rework_iterations'] ?? 3),
      createdAt: String(r['created_at']),
      updatedAt: String(r['updated_at']),
    };
  }

  listWorkflows(): WorkflowRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM workflows ORDER BY updated_at DESC')
      .all() as Record<string, unknown>[];
    return rows.map(r => this.mapWorkflowRow(r));
  }

  getWorkflow(id: string): WorkflowRecord {
    const row = this.db
      .prepare('SELECT * FROM workflows WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!row) {
      throw new OrchestratorError('NOT_FOUND', `Workflow ${id} not found`, 404);
    }
    return this.mapWorkflowRow(row);
  }

  createWorkflowRecord(input: {
    readonly id?: string;
    readonly workspaceId: string;
    readonly title: string;
    readonly description: string;
    readonly permissionTier: PermissionTier;
    readonly verifyCommand: string;
    readonly maxReworkIterations: number;
  }): WorkflowRecord {
    const existingCount = (
      this.db.prepare('SELECT COUNT(*) as c FROM workflows').get() as {
        c: number;
      }
    ).c;
    const now = new Date().toISOString();
    const record: WorkflowRecord = {
      id: input.id ?? `wf-${randomUUID().slice(0, 8)}`,
      workspaceId: input.workspaceId,
      code: `WF-${String(existingCount + 1).padStart(3, '0')}`,
      title: input.title,
      description: input.description,
      status: 'draft',
      currentVersionNumber: 0,
      permissionTier: input.permissionTier,
      verifyCommand: input.verifyCommand,
      maxReworkIterations: input.maxReworkIterations,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO workflows (id, workspace_id, code, title, description, status, current_version_number, permission_tier, verify_command, max_rework_iterations, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.workspaceId,
        record.code,
        record.title,
        record.description,
        record.status,
        record.currentVersionNumber,
        record.permissionTier,
        record.verifyCommand,
        record.maxReworkIterations,
        record.createdAt,
        record.updatedAt,
      );
    return record;
  }

  updateWorkflowMeta(
    id: string,
    patch: Partial<{
      readonly title: string;
      readonly description: string;
      readonly status: WorkflowStatus;
      readonly currentVersionNumber: number;
      readonly permissionTier: PermissionTier;
      readonly verifyCommand: string;
      readonly maxReworkIterations: number;
    }>,
  ): WorkflowRecord {
    const curr = this.getWorkflow(id);
    const now = new Date().toISOString();
    const next: WorkflowRecord = {
      ...curr,
      title: patch.title ?? curr.title,
      description: patch.description ?? curr.description,
      status: patch.status ?? curr.status,
      currentVersionNumber:
        patch.currentVersionNumber ?? curr.currentVersionNumber,
      permissionTier: patch.permissionTier ?? curr.permissionTier,
      verifyCommand: patch.verifyCommand ?? curr.verifyCommand,
      maxReworkIterations:
        patch.maxReworkIterations ?? curr.maxReworkIterations,
      updatedAt: now,
    };
    this.db
      .prepare(
        `UPDATE workflows SET title = ?, description = ?, status = ?, current_version_number = ?,
         permission_tier = ?, verify_command = ?, max_rework_iterations = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.title,
        next.description,
        next.status,
        next.currentVersionNumber,
        next.permissionTier,
        next.verifyCommand,
        next.maxReworkIterations,
        next.updatedAt,
        id,
      );
    return next;
  }

  saveGoalSpec(spec: GoalSpec): void {
    this.db
      .prepare(
        `INSERT INTO goal_specs (workflow_id, payload_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(workflow_id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
      )
      .run(spec.workflowId, JSON.stringify(spec), spec.updatedAt);
  }

  getGoalSpec(workflowId: string): GoalSpec {
    const row = this.db
      .prepare('SELECT payload_json FROM goal_specs WHERE workflow_id = ?')
      .get(workflowId) as {payload_json: string} | undefined;
    if (!row) {
      throw new OrchestratorError(
        'NOT_FOUND',
        `GoalSpec for workflow ${workflowId} not found`,
        404,
      );
    }
    return JSON.parse(row.payload_json) as GoalSpec;
  }

  saveValidationReport(report: {
    readonly workflowId: string;
    readonly checkedAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO validation_reports (workflow_id, payload_json, checked_at) VALUES (?, ?, ?)
         ON CONFLICT(workflow_id) DO UPDATE SET payload_json = excluded.payload_json, checked_at = excluded.checked_at`,
      )
      .run(report.workflowId, JSON.stringify(report), report.checkedAt);
  }

  getValidationReport(
    workflowId: string,
  ): import('../shared/types.ts').ValidationReport {
    const row = this.db
      .prepare(
        'SELECT payload_json FROM validation_reports WHERE workflow_id = ?',
      )
      .get(workflowId) as {payload_json: string} | undefined;
    if (!row) {
      return {
        workflowId,
        valid: false,
        errorCount: 1,
        warningCount: 0,
        infoCount: 0,
        issues: [],
        checkedAt: new Date().toISOString(),
      };
    }
    return JSON.parse(
      row.payload_json,
    ) as import('../shared/types.ts').ValidationReport;
  }

  saveTrialReport(report: TrialRunReport): void {
    this.db
      .prepare(
        'INSERT INTO trial_reports (id, workflow_id, payload_json, ran_at) VALUES (?, ?, ?, ?)',
      )
      .run(report.id, report.workflowId, JSON.stringify(report), report.ranAt);
  }

  getLatestTrialReport(workflowId: string): TrialRunReport | null {
    const row = this.db
      .prepare(
        'SELECT payload_json FROM trial_reports WHERE workflow_id = ? ORDER BY ran_at DESC LIMIT 1',
      )
      .get(workflowId) as {payload_json: string} | undefined;
    return row ? (JSON.parse(row.payload_json) as TrialRunReport) : null;
  }

  saveImpactReport(report: ChangeImpactReport): void {
    this.db
      .prepare(
        `INSERT INTO impact_reports (workflow_id, payload_json, analyzed_at) VALUES (?, ?, ?)
         ON CONFLICT(workflow_id) DO UPDATE SET payload_json = excluded.payload_json, analyzed_at = excluded.analyzed_at`,
      )
      .run(report.workflowId, JSON.stringify(report), report.analyzedAt);
  }

  getImpactReport(workflowId: string): ChangeImpactReport | null {
    const row = this.db
      .prepare('SELECT payload_json FROM impact_reports WHERE workflow_id = ?')
      .get(workflowId) as {payload_json: string} | undefined;
    return row ? (JSON.parse(row.payload_json) as ChangeImpactReport) : null;
  }

  createVersionSnapshot(
    snapshot: WorkflowVersionSnapshot,
  ): WorkflowVersionSnapshot {
    this.db
      .prepare(
        `INSERT INTO workflow_versions (id, workflow_id, version_number, version_tag, label, payload_json, frozen_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        snapshot.id,
        snapshot.workflowId,
        snapshot.versionNumber,
        snapshot.versionTag,
        snapshot.label,
        JSON.stringify(snapshot),
        snapshot.frozenBy,
        snapshot.createdAt,
      );
    return snapshot;
  }

  listVersions(workflowId?: string): WorkflowVersionSnapshot[] {
    const rows = workflowId
      ? (this.db
          .prepare(
            'SELECT payload_json FROM workflow_versions WHERE workflow_id = ? ORDER BY version_number DESC',
          )
          .all(workflowId) as {payload_json: string}[])
      : (this.db
          .prepare(
            'SELECT payload_json FROM workflow_versions ORDER BY created_at DESC',
          )
          .all() as {payload_json: string}[]);
    return rows.map(r => JSON.parse(r.payload_json) as WorkflowVersionSnapshot);
  }

  getVersion(versionId: string): WorkflowVersionSnapshot {
    const row = this.db
      .prepare('SELECT payload_json FROM workflow_versions WHERE id = ?')
      .get(versionId) as {payload_json: string} | undefined;
    if (!row) {
      throw new OrchestratorError(
        'NOT_FOUND',
        `Workflow version ${versionId} not found`,
        404,
      );
    }
    return JSON.parse(row.payload_json) as WorkflowVersionSnapshot;
  }

  // ---- Twin-Graph Nodes & Edges ----

  private mapGraphNode(r: Record<string, unknown>): GraphNode {
    return {
      id: String(r['id']),
      scopeId: String(r['scope_id']),
      code: String(r['code']),
      parentWbsId: r['parent_wbs_id'] ? String(r['parent_wbs_id']) : null,
      containerNodeId: r['container_node_id']
        ? String(r['container_node_id'])
        : null,
      phaseId: r['phase_id'] ? String(r['phase_id']) : null,
      phaseTitle: String(r['phase_title'] ?? ''),
      depth: Number(r['depth'] ?? 1),
      kind: String(r['kind']) as WorkflowNodeKind,
      executorKind: String(r['executor_kind']) as ExecutorKind,
      capabilityId: String(r['capability_id']),
      assignedRole: String(r['assigned_role']) as AgentRole,
      assignedModel: r['assigned_model'] ? String(r['assigned_model']) : null,
      title: String(r['title']),
      description: String(r['description'] ?? ''),
      planningRationale: String(r['planning_rationale'] ?? ''),
      requirementRefs: parseJson<string[]>(
        r['requirement_refs_json'] as string,
        [],
      ),
      inputContract: String(r['input_contract'] ?? ''),
      outputContract: String(r['output_contract'] ?? ''),
      fileScope: parseJson<string[]>(r['file_scope_json'] as string, []),
      gateCommand: r['gate_command'] ? String(r['gate_command']) : null,
      branchCondition: r['branch_condition']
        ? String(r['branch_condition'])
        : null,
      status: String(r['status']) as GraphNodeStatus,
      attemptCount: Number(r['attempt_count'] ?? 0),
      maxAttempts: Number(r['max_attempts'] ?? 3),
      collapsed: Boolean(r['collapsed']),
      positionX: Number(r['position_x'] ?? 0),
      positionY: Number(r['position_y'] ?? 0),
      width: Number(r['width'] ?? 220),
      height: Number(r['height'] ?? 76),
      outputSummary: String(r['output_summary'] ?? ''),
      restoreTargetCheckpointId: r['restore_target_checkpoint_id']
        ? String(r['restore_target_checkpoint_id'])
        : null,
      updatedAt: String(r['updated_at']),
    };
  }

  listGraphNodes(scopeId: string): GraphNode[] {
    const rows = this.db
      .prepare('SELECT * FROM graph_nodes WHERE scope_id = ?')
      .all(scopeId) as Record<string, unknown>[];
    return rows.map(r => this.mapGraphNode(r));
  }

  listGraphEdges(scopeId: string): GraphEdge[] {
    const rows = this.db
      .prepare('SELECT * FROM graph_edges WHERE scope_id = ?')
      .all(scopeId) as Record<string, unknown>[];
    return rows.map(r => ({
      id: String(r['id']),
      scopeId: String(r['scope_id']),
      sourceNodeId: String(r['source_node_id']),
      targetNodeId: String(r['target_node_id']),
      kind: String(r['kind']) as GraphEdgeKind,
      label: String(r['label'] ?? ''),
      conditionExpr: r['condition_expr'] ? String(r['condition_expr']) : null,
    }));
  }

  replaceGraph(
    scopeId: string,
    nodes: readonly GraphNode[],
    edges: readonly GraphEdge[],
  ): void {
    this.savepoint(() => {
      this.db
        .prepare('DELETE FROM graph_edges WHERE scope_id = ?')
        .run(scopeId);
      this.db
        .prepare('DELETE FROM graph_nodes WHERE scope_id = ?')
        .run(scopeId);

      const insNode = this.db.prepare(
        `INSERT INTO graph_nodes (
          id, scope_id, code, parent_wbs_id, container_node_id, phase_id, phase_title,
          depth, kind, executor_kind, capability_id, assigned_role, assigned_model,
          title, description, planning_rationale, requirement_refs_json,
          input_contract, output_contract, file_scope_json, gate_command, branch_condition,
          status, attempt_count, max_attempts, collapsed,
          position_x, position_y, width, height, output_summary,
          restore_target_checkpoint_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      for (const n of nodes) {
        insNode.run(
          n.id,
          scopeId,
          n.code,
          n.parentWbsId,
          n.containerNodeId,
          n.phaseId,
          n.phaseTitle,
          n.depth,
          n.kind,
          n.executorKind,
          n.capabilityId,
          n.assignedRole,
          n.assignedModel,
          n.title,
          n.description,
          n.planningRationale,
          JSON.stringify(n.requirementRefs),
          n.inputContract,
          n.outputContract,
          JSON.stringify(n.fileScope),
          n.gateCommand,
          n.branchCondition,
          n.status,
          n.attemptCount,
          n.maxAttempts,
          n.collapsed ? 1 : 0,
          n.positionX,
          n.positionY,
          n.width,
          n.height,
          n.outputSummary,
          n.restoreTargetCheckpointId,
          n.updatedAt,
        );
      }

      const insEdge = this.db.prepare(
        `INSERT INTO graph_edges (id, scope_id, source_node_id, target_node_id, kind, label, condition_expr)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const e of edges) {
        insEdge.run(
          e.id,
          scopeId,
          e.sourceNodeId,
          e.targetNodeId,
          e.kind,
          e.label,
          e.conditionExpr,
        );
      }
    });
  }

  updateNodeState(
    nodeId: string,
    patch: Partial<{
      readonly status: GraphNodeStatus;
      readonly attemptCount: number;
      readonly outputSummary: string;
      readonly collapsed: boolean;
    }>,
  ): GraphNode {
    const row = this.db
      .prepare('SELECT * FROM graph_nodes WHERE id = ?')
      .get(nodeId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new OrchestratorError('NOT_FOUND', `Node ${nodeId} not found`, 404);
    }
    const curr = this.mapGraphNode(row);
    const now = new Date().toISOString();
    const next: GraphNode = {
      ...curr,
      status: patch.status ?? curr.status,
      attemptCount: patch.attemptCount ?? curr.attemptCount,
      outputSummary: patch.outputSummary ?? curr.outputSummary,
      collapsed: patch.collapsed ?? curr.collapsed,
      updatedAt: now,
    };
    this.db
      .prepare(
        `UPDATE graph_nodes SET status = ?, attempt_count = ?, output_summary = ?, collapsed = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.status,
        next.attemptCount,
        next.outputSummary,
        next.collapsed ? 1 : 0,
        next.updatedAt,
        nodeId,
      );
    return next;
  }

  // ---- Workflow Runs, Attempts, Checkpoints & Interventions ----

  private mapRunRow(r: Record<string, unknown>): WorkflowRunRecord {
    return {
      id: String(r['id']),
      workflowId: String(r['workflow_id']),
      versionId: String(r['version_id']),
      versionTag: String(r['version_tag']),
      title: String(r['title']),
      status: String(r['status']) as RunStatus,
      permissionTier: String(r['permission_tier']) as PermissionTier,
      worktreePath: String(r['worktree_path'] ?? ''),
      gitBranch: String(r['git_branch'] ?? ''),
      baseCommitSha: String(r['base_commit_sha'] ?? ''),
      verifyCommand: String(r['verify_command']),
      maxReworkIterations: Number(r['max_rework_iterations'] ?? 3),
      reworkCount: Number(r['rework_count'] ?? 0),
      totalNodes: Number(r['total_nodes'] ?? 0),
      completedNodes: Number(r['completed_nodes'] ?? 0),
      failedNodes: Number(r['failed_nodes'] ?? 0),
      skippedNodes: Number(r['skipped_nodes'] ?? 0),
      startedAt: String(r['started_at']),
      finishedAt: r['finished_at'] ? String(r['finished_at']) : null,
      updatedAt: String(r['updated_at']),
    };
  }

  listRuns(workflowId?: string): WorkflowRunRecord[] {
    const rows = workflowId
      ? (this.db
          .prepare(
            'SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC',
          )
          .all(workflowId) as Record<string, unknown>[])
      : (this.db
          .prepare('SELECT * FROM workflow_runs ORDER BY started_at DESC')
          .all() as Record<string, unknown>[]);
    return rows.map(r => this.mapRunRow(r));
  }

  getRun(runId: string): WorkflowRunRecord {
    const row = this.db
      .prepare('SELECT * FROM workflow_runs WHERE id = ?')
      .get(runId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new OrchestratorError('NOT_FOUND', `Run ${runId} not found`, 404);
    }
    return this.mapRunRow(row);
  }

  createRun(run: WorkflowRunRecord): WorkflowRunRecord {
    this.db
      .prepare(
        `INSERT INTO workflow_runs (
          id, workflow_id, version_id, version_tag, title, status, permission_tier,
          worktree_path, git_branch, base_commit_sha, verify_command,
          max_rework_iterations, rework_count, total_nodes, completed_nodes,
          failed_nodes, skipped_nodes, started_at, finished_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.workflowId,
        run.versionId,
        run.versionTag,
        run.title,
        run.status,
        run.permissionTier,
        run.worktreePath,
        run.gitBranch,
        run.baseCommitSha,
        run.verifyCommand,
        run.maxReworkIterations,
        run.reworkCount,
        run.totalNodes,
        run.completedNodes,
        run.failedNodes,
        run.skippedNodes,
        run.startedAt,
        run.finishedAt,
        run.updatedAt,
      );
    return run;
  }

  updateRun(
    runId: string,
    patch: Partial<{
      readonly status: RunStatus;
      readonly worktreePath: string;
      readonly gitBranch: string;
      readonly baseCommitSha: string;
      readonly reworkCount: number;
      readonly totalNodes: number;
      readonly completedNodes: number;
      readonly failedNodes: number;
      readonly skippedNodes: number;
      readonly finishedAt: string | null;
    }>,
  ): WorkflowRunRecord {
    const curr = this.getRun(runId);
    const now = new Date().toISOString();
    const next: WorkflowRunRecord = {
      ...curr,
      status: patch.status ?? curr.status,
      worktreePath: patch.worktreePath ?? curr.worktreePath,
      gitBranch: patch.gitBranch ?? curr.gitBranch,
      baseCommitSha: patch.baseCommitSha ?? curr.baseCommitSha,
      reworkCount: patch.reworkCount ?? curr.reworkCount,
      totalNodes: patch.totalNodes ?? curr.totalNodes,
      completedNodes: patch.completedNodes ?? curr.completedNodes,
      failedNodes: patch.failedNodes ?? curr.failedNodes,
      skippedNodes: patch.skippedNodes ?? curr.skippedNodes,
      finishedAt:
        patch.finishedAt !== undefined ? patch.finishedAt : curr.finishedAt,
      updatedAt: now,
    };
    this.db
      .prepare(
        `UPDATE workflow_runs SET status = ?, worktree_path = ?, git_branch = ?,
         base_commit_sha = ?, rework_count = ?, total_nodes = ?, completed_nodes = ?,
         failed_nodes = ?, skipped_nodes = ?, finished_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.status,
        next.worktreePath,
        next.gitBranch,
        next.baseCommitSha,
        next.reworkCount,
        next.totalNodes,
        next.completedNodes,
        next.failedNodes,
        next.skippedNodes,
        next.finishedAt,
        next.updatedAt,
        runId,
      );
    return next;
  }

  recountRunProgress(runId: string): WorkflowRunRecord {
    const nodes = this.listGraphNodes(runId).filter(
      n => n.kind !== 'phase_container',
    );
    const completedNodes = nodes.filter(
      n => n.status === 'succeeded' || n.status === 'waived',
    ).length;
    const failedNodes = nodes.filter(n => n.status === 'failed').length;
    const skippedNodes = nodes.filter(n => n.status === 'skipped').length;
    return this.updateRun(runId, {
      totalNodes: nodes.length,
      completedNodes,
      failedNodes,
      skippedNodes,
    });
  }

  recordAttempt(attempt: NodeAttemptRecord): NodeAttemptRecord {
    this.db
      .prepare(
        `INSERT INTO node_attempts (
          id, run_id, node_id, node_code, attempt_number, executor_kind,
          capability_id, model, status, exit_code, duration_sec,
          input_snapshot_json, output_summary, error_message, session_id,
          started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          exit_code = excluded.exit_code,
          duration_sec = excluded.duration_sec,
          output_summary = excluded.output_summary,
          error_message = excluded.error_message,
          finished_at = excluded.finished_at`,
      )
      .run(
        attempt.id,
        attempt.runId,
        attempt.nodeId,
        attempt.nodeCode,
        attempt.attemptNumber,
        attempt.executorKind,
        attempt.capabilityId,
        attempt.model,
        attempt.status,
        attempt.exitCode,
        attempt.durationSec,
        attempt.inputSnapshotJson,
        attempt.outputSummary,
        attempt.errorMessage,
        attempt.sessionId,
        attempt.startedAt,
        attempt.finishedAt,
      );
    return attempt;
  }

  listAttempts(runId?: string): NodeAttemptRecord[] {
    const rows = runId
      ? (this.db
          .prepare(
            'SELECT * FROM node_attempts WHERE run_id = ? ORDER BY started_at DESC',
          )
          .all(runId) as Record<string, unknown>[])
      : (this.db
          .prepare(
            'SELECT * FROM node_attempts ORDER BY started_at DESC LIMIT 500',
          )
          .all() as Record<string, unknown>[]);
    return rows.map(r => ({
      id: String(r['id']),
      runId: String(r['run_id']),
      nodeId: String(r['node_id']),
      nodeCode: String(r['node_code']),
      attemptNumber: Number(r['attempt_number']),
      executorKind: String(r['executor_kind']) as ExecutorKind,
      capabilityId: String(r['capability_id']),
      model: String(r['model'] ?? ''),
      status: String(r['status']) as NodeAttemptRecord['status'],
      exitCode:
        r['exit_code'] !== null && r['exit_code'] !== undefined
          ? Number(r['exit_code'])
          : null,
      durationSec: Number(r['duration_sec'] ?? 0),
      inputSnapshotJson: String(r['input_snapshot_json'] ?? '{}'),
      outputSummary: String(r['output_summary'] ?? ''),
      errorMessage: String(r['error_message'] ?? ''),
      sessionId: r['session_id'] ? String(r['session_id']) : null,
      startedAt: String(r['started_at']),
      finishedAt: r['finished_at'] ? String(r['finished_at']) : null,
    }));
  }

  createCheckpoint(cp: CheckpointRecord): CheckpointRecord {
    this.db
      .prepare(
        `INSERT INTO checkpoints (
          id, run_id, node_id, label, git_commit_sha, git_tag, rescue_ref,
          completed_node_count, total_node_count, engine_snapshot_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        cp.id,
        cp.runId,
        cp.nodeId,
        cp.label,
        cp.gitCommitSha,
        cp.gitTag,
        cp.rescueRef,
        cp.completedNodeCount,
        cp.totalNodeCount,
        cp.engineSnapshotJson,
        cp.createdAt,
      );
    return cp;
  }

  listCheckpoints(runId: string): CheckpointRecord[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM checkpoints WHERE run_id = ? ORDER BY created_at DESC',
      )
      .all(runId) as Record<string, unknown>[];
    return rows.map(r => ({
      id: String(r['id']),
      runId: String(r['run_id']),
      nodeId: String(r['node_id']),
      label: String(r['label']),
      gitCommitSha: String(r['git_commit_sha']),
      gitTag: String(r['git_tag']),
      rescueRef: r['rescue_ref'] ? String(r['rescue_ref']) : null,
      completedNodeCount: Number(r['completed_node_count'] ?? 0),
      totalNodeCount: Number(r['total_node_count'] ?? 0),
      engineSnapshotJson: String(r['engine_snapshot_json'] ?? '{}'),
      createdAt: String(r['created_at']),
    }));
  }

  // ---- Interventions ----

  private mapIntervention(r: Record<string, unknown>): InterventionItem {
    return {
      id: String(r['id']),
      runId: String(r['run_id']),
      nodeId: r['node_id'] ? String(r['node_id']) : null,
      kind: String(r['kind']) as InterventionItem['kind'],
      question: String(r['question']),
      contextSnippet: String(r['context_snippet'] ?? ''),
      options: parseJson<string[]>(r['options_json'] as string, []),
      recommendedIndex: Number(r['recommended_index'] ?? 0),
      downstreamBlockedCount: Number(r['downstream_blocked_count'] ?? 1),
      estimatedReadSeconds: Number(r['estimated_read_seconds'] ?? 20),
      status: String(r['status']) as InterventionItem['status'],
      resolution: r['resolution'] ? String(r['resolution']) : null,
      createdAt: String(r['created_at']),
      resolvedAt: r['resolved_at'] ? String(r['resolved_at']) : null,
    };
  }

  createIntervention(input: {
    readonly runId: string;
    readonly nodeId: string | null;
    readonly kind: InterventionItem['kind'];
    readonly question: string;
    readonly contextSnippet: string;
    readonly options: readonly string[];
    readonly recommendedIndex?: number;
    readonly downstreamBlockedCount?: number;
  }): InterventionItem {
    const item: InterventionItem = {
      id: `int-${randomUUID().slice(0, 8)}`,
      runId: input.runId,
      nodeId: input.nodeId,
      kind: input.kind,
      question: input.question,
      contextSnippet: input.contextSnippet,
      options: input.options,
      recommendedIndex: input.recommendedIndex ?? 0,
      downstreamBlockedCount: input.downstreamBlockedCount ?? 1,
      estimatedReadSeconds: 20,
      status: 'open',
      resolution: null,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO interventions (
          id, run_id, node_id, kind, question, context_snippet, options_json,
          recommended_index, downstream_blocked_count, estimated_read_seconds,
          status, resolution, created_at, resolved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        item.id,
        item.runId,
        item.nodeId,
        item.kind,
        item.question,
        item.contextSnippet,
        JSON.stringify(item.options),
        item.recommendedIndex,
        item.downstreamBlockedCount,
        item.estimatedReadSeconds,
        item.status,
        item.resolution,
        item.createdAt,
        item.resolvedAt,
      );
    return item;
  }

  listInterventions(runId?: string): InterventionItem[] {
    const rows = runId
      ? (this.db
          .prepare(
            'SELECT * FROM interventions WHERE run_id = ? ORDER BY created_at DESC',
          )
          .all(runId) as Record<string, unknown>[])
      : (this.db
          .prepare(
            "SELECT * FROM interventions WHERE status = 'open' ORDER BY created_at DESC",
          )
          .all() as Record<string, unknown>[]);
    return rows.map(r => this.mapIntervention(r));
  }

  resolveIntervention(
    id: string,
    resolution: string,
    dismiss = false,
  ): InterventionItem {
    const row = this.db
      .prepare('SELECT * FROM interventions WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!row) {
      throw new OrchestratorError(
        'NOT_FOUND',
        `Intervention ${id} not found`,
        404,
      );
    }
    const now = new Date().toISOString();
    const status = dismiss ? 'dismissed' : 'resolved';
    this.db
      .prepare(
        'UPDATE interventions SET status = ?, resolution = ?, resolved_at = ? WHERE id = ?',
      )
      .run(status, resolution, now, id);
    return this.mapIntervention({
      ...row,
      status,
      resolution,
      resolved_at: now,
    });
  }

  // ---- Capabilities & Models ----

  listCapabilities(): CapabilityAdapterManifest[] {
    const rows = this.db
      .prepare('SELECT * FROM capabilities ORDER BY id ASC')
      .all() as Record<string, unknown>[];
    return rows.map(r => {
      const m = parseJson<
        Omit<
          CapabilityAdapterManifest,
          'probeOk' | 'probeMessage' | 'probedAt' | 'enabled'
        >
      >(String(r['manifest_json']), BUILTIN_CAPABILITIES[0]!);
      return {
        ...m,
        enabled: Boolean(r['enabled']),
        probeOk:
          r['probe_ok'] === null || r['probe_ok'] === undefined
            ? null
            : Boolean(r['probe_ok']),
        probeMessage: String(r['probe_message'] ?? ''),
        probedAt: r['probed_at'] ? String(r['probed_at']) : null,
      };
    });
  }

  upsertCapability(
    manifest: Omit<
      CapabilityAdapterManifest,
      'probeOk' | 'probeMessage' | 'probedAt'
    >,
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO capabilities (id, manifest_json, enabled, probe_ok, probe_message, probed_at, updated_at)
         VALUES (?, ?, ?, NULL, 'Registered', NULL, ?)
         ON CONFLICT(id) DO UPDATE SET manifest_json = excluded.manifest_json, enabled = excluded.enabled, updated_at = excluded.updated_at`,
      )
      .run(
        manifest.id,
        JSON.stringify(manifest),
        manifest.enabled ? 1 : 0,
        now,
      );
  }

  setCapabilityProbe(
    id: string,
    ok: boolean,
    message: string,
    enabled?: boolean,
  ): void {
    const now = new Date().toISOString();
    if (enabled !== undefined) {
      this.db
        .prepare(
          'UPDATE capabilities SET probe_ok = ?, probe_message = ?, probed_at = ?, enabled = ?, updated_at = ? WHERE id = ?',
        )
        .run(ok ? 1 : 0, message, now, enabled ? 1 : 0, now, id);
    } else {
      this.db
        .prepare(
          'UPDATE capabilities SET probe_ok = ?, probe_message = ?, probed_at = ?, updated_at = ? WHERE id = ?',
        )
        .run(ok ? 1 : 0, message, now, now, id);
    }
  }

  listCapabilityHealth(): CapabilityHealthProfile[] {
    const caps = this.listCapabilities();
    const attempts = this.listAttempts();
    return caps.map(c => computeCapabilityHealthProfile(c, attempts));
  }

  listModelProviders(
    getKeyStatus: (id: string) => {
      readonly hasApiKey: boolean;
      readonly maskedKeyHint: string;
    },
  ): ModelProviderConfig[] {
    const rows = this.db
      .prepare('SELECT * FROM model_providers ORDER BY id ASC')
      .all() as Record<string, unknown>[];
    return rows.map(r => {
      const id = String(r['id']);
      const ks = getKeyStatus(id);
      return {
        id,
        name: String(r['name']),
        protocol: String(r['protocol']) as ModelProviderConfig['protocol'],
        baseUrl: String(r['base_url']),
        models: parseJson<ModelCatalogEntry[]>(String(r['models_json']), []),
        hasApiKey: ks.hasApiKey,
        maskedKeyHint: ks.maskedKeyHint,
        updatedAt: String(r['updated_at']),
      };
    });
  }

  updateProviderBaseUrl(id: string, baseUrl: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'UPDATE model_providers SET base_url = ?, updated_at = ? WHERE id = ?',
      )
      .run(baseUrl, now, id);
  }

  // ---- Sessions, Messages, Audit & FTS5 Evidence Search ----

  createSession(input: {
    readonly runId: string | null;
    readonly nodeId: string | null;
    readonly capabilityId: string;
    readonly model: string;
    readonly role: AgentRole;
  }): TranscriptSession {
    const session: TranscriptSession = {
      id: `sess-${randomUUID().slice(0, 8)}`,
      runId: input.runId,
      nodeId: input.nodeId,
      capabilityId: input.capabilityId,
      model: input.model,
      role: input.role,
      startedAt: new Date().toISOString(),
      endedAt: null,
      status: 'running',
    };
    this.db
      .prepare(
        `INSERT INTO sessions (id, run_id, node_id, capability_id, model, role, started_at, ended_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.runId,
        session.nodeId,
        session.capabilityId,
        session.model,
        session.role,
        session.startedAt,
        session.endedAt,
        session.status,
      );
    return session;
  }

  finishSession(sessionId: string, status: 'completed' | 'failed'): void {
    this.db
      .prepare('UPDATE sessions SET status = ?, ended_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), sessionId);
  }

  appendSessionMessage(input: {
    readonly sessionId: string;
    readonly role: TranscriptMessage['role'];
    readonly content: string;
    readonly toolName?: string | null;
    readonly isError?: boolean;
    readonly inputTokens?: number;
    readonly cachedTokens?: number;
    readonly outputTokens?: number;
  }): TranscriptMessage {
    const maxSeqRow = this.db
      .prepare(
        'SELECT COALESCE(MAX(seq), 0) as m FROM session_messages WHERE session_id = ?',
      )
      .get(input.sessionId) as {m: number};
    const msg: TranscriptMessage = {
      id: `msg-${randomUUID().slice(0, 8)}`,
      sessionId: input.sessionId,
      seq: Number(maxSeqRow.m) + 1,
      role: input.role,
      content: input.content,
      toolName: input.toolName ?? null,
      isError: Boolean(input.isError),
      inputTokens: input.inputTokens ?? 0,
      cachedTokens: input.cachedTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO session_messages (
          id, session_id, seq, role, content, tool_name, is_error,
          input_tokens, cached_tokens, output_tokens, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        msg.id,
        msg.sessionId,
        msg.seq,
        msg.role,
        msg.content,
        msg.toolName,
        msg.isError ? 1 : 0,
        msg.inputTokens,
        msg.cachedTokens,
        msg.outputTokens,
        msg.createdAt,
      );
    return msg;
  }

  listSessionsForRun(runId: string): TranscriptSession[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM sessions WHERE run_id = ? ORDER BY started_at DESC',
      )
      .all(runId) as Record<string, unknown>[];
    return rows.map(r => ({
      id: String(r['id']),
      runId: r['run_id'] ? String(r['run_id']) : null,
      nodeId: r['node_id'] ? String(r['node_id']) : null,
      capabilityId: String(r['capability_id']),
      model: String(r['model']),
      role: String(r['role']) as AgentRole,
      startedAt: String(r['started_at']),
      endedAt: r['ended_at'] ? String(r['ended_at']) : null,
      status: String(r['status']) as TranscriptSession['status'],
    }));
  }

  getSessionTranscript(sessionId: string): {
    readonly session: TranscriptSession;
    readonly messages: readonly TranscriptMessage[];
  } {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(sessionId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new OrchestratorError(
        'NOT_FOUND',
        `Session ${sessionId} not found`,
        404,
      );
    }
    const msgs = this.db
      .prepare(
        'SELECT * FROM session_messages WHERE session_id = ? ORDER BY seq ASC',
      )
      .all(sessionId) as Record<string, unknown>[];
    return {
      session: {
        id: String(row['id']),
        runId: row['run_id'] ? String(row['run_id']) : null,
        nodeId: row['node_id'] ? String(row['node_id']) : null,
        capabilityId: String(row['capability_id']),
        model: String(row['model']),
        role: String(row['role']) as AgentRole,
        startedAt: String(row['started_at']),
        endedAt: row['ended_at'] ? String(row['ended_at']) : null,
        status: String(row['status']) as TranscriptSession['status'],
      },
      messages: msgs.map(m => ({
        id: String(m['id']),
        sessionId: String(m['session_id']),
        seq: Number(m['seq']),
        role: String(m['role']) as TranscriptMessage['role'],
        content: String(m['content']),
        toolName: m['tool_name'] ? String(m['tool_name']) : null,
        isError: Boolean(m['is_error']),
        inputTokens: Number(m['input_tokens'] ?? 0),
        cachedTokens: Number(m['cached_tokens'] ?? 0),
        outputTokens: Number(m['output_tokens'] ?? 0),
        createdAt: String(m['created_at']),
      })),
    };
  }

  appendAudit(input: {
    readonly workflowId: string | null;
    readonly runId: string | null;
    readonly category: AuditLedgerEntry['category'];
    readonly author: string;
    readonly title: string;
    readonly detail: string;
  }): AuditLedgerEntry {
    const entry: AuditLedgerEntry = {
      id: `aud-${randomUUID().slice(0, 8)}`,
      workflowId: input.workflowId,
      runId: input.runId,
      category: input.category,
      author: input.author,
      title: input.title,
      detail: input.detail,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO audit_ledger (id, workflow_id, run_id, category, author, title, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.workflowId,
        entry.runId,
        entry.category,
        entry.author,
        entry.title,
        entry.detail,
        entry.createdAt,
      );
    return entry;
  }

  listRecentAudit(limit = 60, runId?: string): AuditLedgerEntry[] {
    const rows = runId
      ? (this.db
          .prepare(
            'SELECT * FROM audit_ledger WHERE run_id = ? ORDER BY created_at DESC LIMIT ?',
          )
          .all(runId, limit) as Record<string, unknown>[])
      : (this.db
          .prepare(
            'SELECT * FROM audit_ledger ORDER BY created_at DESC LIMIT ?',
          )
          .all(limit) as Record<string, unknown>[]);
    return rows.map(r => ({
      id: String(r['id']),
      workflowId: r['workflow_id'] ? String(r['workflow_id']) : null,
      runId: r['run_id'] ? String(r['run_id']) : null,
      category: String(r['category']) as AuditLedgerEntry['category'],
      author: String(r['author']),
      title: String(r['title']),
      detail: String(r['detail']),
      createdAt: String(r['created_at']),
    }));
  }

  searchEvidence(rawQuery: string, limit = 30): EvidenceSearchHit[] {
    const ftsQuery = buildSafeFtsQuery(rawQuery);
    if (!ftsQuery) {
      return [];
    }
    const hits: EvidenceSearchHit[] = [];

    const auditRows = this.db
      .prepare(
        `SELECT a.id, a.title, a.detail, a.run_id, a.created_at
         FROM audit_ledger_fts f
         JOIN audit_ledger a ON a.rowid = f.rowid
         WHERE audit_ledger_fts MATCH ?
         LIMIT ?`,
      )
      .all(ftsQuery, limit) as Record<string, unknown>[];
    for (const r of auditRows) {
      hits.push({
        source: 'audit_ledger',
        id: String(r['id']),
        title: String(r['title']),
        snippet: String(r['detail']).slice(0, 220),
        runId: r['run_id'] ? String(r['run_id']) : null,
        nodeId: null,
        createdAt: String(r['created_at']),
      });
    }

    const msgRows = this.db
      .prepare(
        `SELECT m.id, m.content, m.created_at, s.run_id, s.node_id, s.capability_id
         FROM session_messages_fts f
         JOIN session_messages m ON m.rowid = f.rowid
         JOIN sessions s ON s.id = m.session_id
         WHERE session_messages_fts MATCH ?
         LIMIT ?`,
      )
      .all(ftsQuery, limit) as Record<string, unknown>[];
    for (const r of msgRows) {
      hits.push({
        source: 'session_message',
        id: String(r['id']),
        title: `Session Transcript (${String(r['capability_id'])})`,
        snippet: String(r['content']).slice(0, 220),
        runId: r['run_id'] ? String(r['run_id']) : null,
        nodeId: r['node_id'] ? String(r['node_id']) : null,
        createdAt: String(r['created_at']),
      });
    }

    return hits.slice(0, limit);
  }
}
