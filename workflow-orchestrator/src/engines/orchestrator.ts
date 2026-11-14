/**
 * Real-Time Parallel & Conditional Workflow Orchestrator Engine.
 *
 * Responsibilities:
 * - Launches immutable Version Snapshots inside isolated Git Worktrees
 * - Computes ready frontiers concurrently (parallel tasks + conditional branch skipping + Join barriers)
 * - Dispatches `agent` / `tool` / `human` / `control` nodes
 * - Supports Pause / Resume / Retry / Human Gate resolution / Runtime GhostNode splicing
 * - Executes bounded Rework loops via non-destructive Git Rescue Refs
 */

import {randomUUID} from 'node:crypto';
import {
  computeNextFrontier,
  computeRewindSet,
  spliceGhostNode,
} from '../core/twin-graph.ts';
import type {ICapabilityHub} from '../adapters/contracts.ts';
import type {IGitWorktreeManager} from '../sandbox/contracts.ts';
import type {
  ProposeGhostNodeRequest,
  ResolveInterventionRequest,
  RunDetailSnapshot,
  StartRunRequest,
} from '../shared/api.ts';
import {OrchestratorError} from '../shared/errors.ts';
import type {
  CheckpointRecord,
  GoalSpec,
  GraphNode,
  WorkflowRunRecord,
} from '../shared/types.ts';
import type {OrchestratorStore} from '../store/database.ts';
import type {ExecutionCertifier} from './certifier.ts';

export class WorkflowOrchestratorEngine {
  private readonly store: OrchestratorStore;
  private readonly worktrees: IGitWorktreeManager;
  private readonly hub: ICapabilityHub;
  private readonly certifier: ExecutionCertifier;
  private readonly worktreesRoot: string;
  private readonly broadcast: (
    type:
      | 'run.status'
      | 'node.status'
      | 'attempt.updated'
      | 'checkpoint.created'
      | 'intervention.created'
      | 'intervention.resolved'
      | 'session.chunk'
      | 'audit.appended',
    ids: {
      readonly workflowId?: string;
      readonly runId: string;
      readonly nodeId?: string;
    },
    payload: Record<string, unknown>,
  ) => void;

  private readonly activeAbortByRun = new Map<string, AbortController>();
  private readonly activeTaskCountByRun = new Map<string, number>();

  constructor(input: {
    readonly store: OrchestratorStore;
    readonly worktrees: IGitWorktreeManager;
    readonly hub: ICapabilityHub;
    readonly certifier: ExecutionCertifier;
    readonly worktreesRoot: string;
    readonly broadcast: (
      type:
        | 'run.status'
        | 'node.status'
        | 'attempt.updated'
        | 'checkpoint.created'
        | 'intervention.created'
        | 'intervention.resolved'
        | 'session.chunk'
        | 'audit.appended',
      ids: {
        readonly workflowId?: string;
        readonly runId: string;
        readonly nodeId?: string;
      },
      payload: Record<string, unknown>,
    ) => void;
  }) {
    this.store = input.store;
    this.worktrees = input.worktrees;
    this.hub = input.hub;
    this.certifier = input.certifier;
    this.worktreesRoot = input.worktreesRoot;
    this.broadcast = input.broadcast;
  }

  async startRun(req: StartRunRequest): Promise<RunDetailSnapshot> {
    const wf = this.store.getWorkflow(req.workflowId);
    const versions = this.store.listVersions(wf.id);
    const version = req.versionId
      ? this.store.getVersion(req.versionId)
      : versions[0];

    if (!version) {
      throw new OrchestratorError(
        'SPEC_INVALID',
        'No locked version snapshot exists yet. Run Validation & Lock Version before executing.',
        400,
      );
    }

    const workspace = this.store.getWorkspace(wf.workspaceId);
    const runId = `run-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    const wt = await this.worktrees.provisionWorktree({
      repoPath: workspace.rootPath,
      worktreesRoot: this.worktreesRoot,
      repoId: workspace.id,
      runCode: runId,
      baseRef: workspace.defaultBranch,
    });

    const execNodes = version.nodes.filter(n => n.kind !== 'phase_container');
    const runRecord: WorkflowRunRecord = {
      id: runId,
      workflowId: wf.id,
      versionId: version.id,
      versionTag: version.versionTag,
      title: req.title?.trim() || `${wf.code} · ${version.versionTag}`,
      status: 'running',
      permissionTier: req.permissionTier ?? wf.permissionTier,
      worktreePath: wt.worktreePath,
      gitBranch: wt.branchName,
      baseCommitSha: wt.baseCommitSha,
      verifyCommand: wf.verifyCommand,
      maxReworkIterations: wf.maxReworkIterations,
      reworkCount: 0,
      totalNodes: execNodes.length,
      completedNodes: 0,
      failedNodes: 0,
      skippedNodes: 0,
      startedAt: now,
      finishedAt: null,
      updatedAt: now,
    };

    const clonedNodes = version.nodes.map(n => ({
      ...n,
      scopeId: runId,
      status: 'pending' as const,
      attemptCount: 0,
      outputSummary: n.kind === 'decision' ? n.outputSummary : '',
      updatedAt: now,
    }));
    const clonedEdges = version.edges.map(e => ({
      ...e,
      id: `re-${randomUUID().slice(0, 8)}-${e.id.slice(0, 6)}`,
      scopeId: runId,
    }));
    const idRemap = new Map(version.nodes.map(n => [n.id, `${runId}-${n.id}`]));
    const remappedNodes = clonedNodes.map(n => ({
      ...n,
      id: idRemap.get(n.id) ?? n.id,
      parentWbsId: n.parentWbsId
        ? (idRemap.get(n.parentWbsId) ?? n.parentWbsId)
        : null,
      containerNodeId: n.containerNodeId
        ? (idRemap.get(n.containerNodeId) ?? n.containerNodeId)
        : null,
      phaseId: n.phaseId ? (idRemap.get(n.phaseId) ?? n.phaseId) : null,
      restoreTargetCheckpointId: n.restoreTargetCheckpointId
        ? (idRemap.get(n.restoreTargetCheckpointId) ??
          n.restoreTargetCheckpointId)
        : null,
    }));
    const remappedEdges = clonedEdges.map(e => ({
      ...e,
      sourceNodeId: idRemap.get(e.sourceNodeId) ?? e.sourceNodeId,
      targetNodeId: idRemap.get(e.targetNodeId) ?? e.targetNodeId,
    }));

    this.store.savepoint(() => {
      this.store.createRun(runRecord);
      this.store.replaceGraph(runId, remappedNodes, remappedEdges);
      this.store.createCheckpoint({
        id: `cp-${randomUUID().slice(0, 8)}`,
        runId,
        nodeId: remappedNodes.find(n => n.kind === 'start')?.id ?? runId,
        label: `Initial Base (${version.versionTag})`,
        gitCommitSha: wt.baseCommitSha,
        gitTag: `orchestrator/${runId}/base`,
        rescueRef: null,
        completedNodeCount: 0,
        totalNodeCount: execNodes.length,
        engineSnapshotJson: JSON.stringify({versionTag: version.versionTag}),
        createdAt: now,
      });
      this.store.appendAudit({
        workflowId: wf.id,
        runId,
        category: 'execution',
        author: 'OrchestratorEngine',
        title: `Started run ${runId} (${version.versionTag})`,
        detail: `Worktree=${wt.worktreePath} branch=${wt.branchName}`,
      });
    });

    this.broadcast(
      'run.status',
      {workflowId: wf.id, runId},
      {status: 'running', versionTag: version.versionTag},
    );

    queueMicrotask(() => {
      this.schedulePump(runId);
    });

    return this.getRunDetail(runId);
  }

  pauseRun(runId: string): RunDetailSnapshot {
    const run = this.store.getRun(runId);
    if (run.status !== 'running' && run.status !== 'waiting_human') {
      return this.getRunDetail(runId);
    }

    this.activeAbortByRun.get(runId)?.abort();
    this.activeAbortByRun.delete(runId);

    // Revert any actively interrupted running nodes cleanly to `pending` so Resume continues seamlessly
    const nodes = this.store.listGraphNodes(runId);
    for (const n of nodes) {
      if (n.status === 'running') {
        this.store.updateNodeState(n.id, {status: 'pending'});
      }
    }

    this.store.updateRun(runId, {status: 'paused'});
    this.store.appendAudit({
      workflowId: run.workflowId,
      runId,
      category: 'execution',
      author: 'Operator',
      title: 'Paused workflow run',
      detail: 'Interrupted active tasks safely returned to pending queue.',
    });
    this.broadcast(
      'run.status',
      {workflowId: run.workflowId, runId},
      {status: 'paused'},
    );
    return this.getRunDetail(runId);
  }

  resumeRun(runId: string): RunDetailSnapshot {
    const run = this.store.getRun(runId);
    if (run.status !== 'paused' && run.status !== 'waiting_human') {
      return this.getRunDetail(runId);
    }
    this.store.updateRun(runId, {status: 'running'});
    this.store.appendAudit({
      workflowId: run.workflowId,
      runId,
      category: 'execution',
      author: 'Operator',
      title: 'Resumed workflow run',
      detail: 'Re-evaluating Twin-Graph frontier.',
    });
    this.broadcast(
      'run.status',
      {workflowId: run.workflowId, runId},
      {status: 'running'},
    );
    this.schedulePump(runId);
    return this.getRunDetail(runId);
  }

  cancelRun(runId: string): RunDetailSnapshot {
    const run = this.store.getRun(runId);
    this.activeAbortByRun.get(runId)?.abort();
    this.activeAbortByRun.delete(runId);
    this.store.updateRun(runId, {
      status: 'cancelled',
      finishedAt: new Date().toISOString(),
    });
    this.broadcast(
      'run.status',
      {workflowId: run.workflowId, runId},
      {status: 'cancelled'},
    );
    return this.getRunDetail(runId);
  }

  retryNode(runId: string, nodeId: string): RunDetailSnapshot {
    const run = this.store.getRun(runId);
    const node = this.store.listGraphNodes(runId).find(n => n.id === nodeId);
    if (!node) {
      throw new OrchestratorError('NOT_FOUND', `Node ${nodeId} not found`, 404);
    }
    this.store.updateNodeState(node.id, {status: 'pending'});
    this.store.updateRun(runId, {status: 'running', finishedAt: null});
    this.store.appendAudit({
      workflowId: run.workflowId,
      runId,
      category: 'execution',
      author: 'Operator',
      title: `Manual Retry queued for ${node.code}`,
      detail: `Reset ${node.code} to pending and resumed frontier.`,
    });
    this.broadcast(
      'node.status',
      {workflowId: run.workflowId, runId, nodeId},
      {status: 'pending'},
    );
    this.schedulePump(runId);
    return this.getRunDetail(runId);
  }

  resolveIntervention(
    interventionId: string,
    req: ResolveInterventionRequest,
  ): RunDetailSnapshot {
    const action = req.action ?? 'approve';
    const item = this.store.resolveIntervention(
      interventionId,
      req.resolution,
      action === 'reject',
    );
    const run = this.store.getRun(item.runId);

    if (item.nodeId) {
      if (action === 'approve' || action === 'override') {
        this.store.updateNodeState(item.nodeId, {
          status: action === 'override' ? 'waived' : 'succeeded',
          outputSummary: `Human decision (${action}): ${req.resolution}`,
        });
      } else {
        this.store.updateNodeState(item.nodeId, {
          status: 'failed',
          outputSummary: `Human rejected: ${req.resolution}`,
        });
      }
    }

    const openRemaining = this.store
      .listInterventions(run.id)
      .filter(i => i.status === 'open');
    if (action === 'reject') {
      this.store.updateRun(run.id, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
      });
    } else if (openRemaining.length === 0 && run.status !== 'paused') {
      this.store.updateRun(run.id, {status: 'running'});
      this.schedulePump(run.id);
    }

    this.broadcast(
      'intervention.resolved',
      {
        workflowId: run.workflowId,
        runId: run.id,
        nodeId: item.nodeId ?? undefined,
      },
      {interventionId, action, resolution: req.resolution},
    );
    return this.getRunDetail(run.id);
  }

  proposeGhostNode(
    runId: string,
    req: ProposeGhostNodeRequest,
  ): RunDetailSnapshot {
    const run = this.store.getRun(runId);
    const nodes = this.store.listGraphNodes(runId);
    const edges = this.store.listGraphEdges(runId);
    const now = new Date().toISOString();
    const ghostId = `ghost-${randomUUID().slice(0, 8)}`;

    const ghostNode: GraphNode = {
      id: ghostId,
      scopeId: runId,
      code: `GHOST.${nodes.filter(n => n.kind === 'ghost').length + 1}`,
      parentWbsId: null,
      containerNodeId: null,
      phaseId: null,
      phaseTitle: 'Runtime Amendment',
      depth: 1,
      kind: 'ghost',
      executorKind: req.executorKind ?? 'agent',
      capabilityId: req.capabilityId ?? 'native-api',
      assignedRole: 'specialist',
      assignedModel: null,
      title: req.title,
      description: req.description,
      planningRationale:
        'Dynamic runtime amendment spliced without altering locked version snapshot.',
      requirementRefs: [],
      inputContract: 'Current Worktree State',
      outputContract: 'Amended Artifact & Diff',
      fileScope: [],
      gateCommand: req.gateCommand ?? null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 2,
      collapsed: false,
      positionX: 520,
      positionY: 20,
      width: 220,
      height: 74,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    };

    const spliced = spliceGhostNode({
      scopeId: runId,
      nodes,
      edges,
      ghostNode,
      insertBeforeNodeId: req.insertBeforeNodeId,
    });

    this.store.savepoint(() => {
      this.store.replaceGraph(runId, spliced.nodes, spliced.edges);
      this.store.recountRunProgress(runId);
      this.store.appendAudit({
        workflowId: run.workflowId,
        runId,
        category: 'execution',
        author: 'Operator',
        title: `Spliced runtime GhostNode ${ghostNode.code}`,
        detail: `${req.title} (locked version snapshot untouched).`,
      });
    });

    if (run.status === 'running') {
      this.schedulePump(runId);
    }
    return this.getRunDetail(runId);
  }

  async manualRestoreCheckpoint(
    runId: string,
    checkpointId: string,
  ): Promise<RunDetailSnapshot> {
    const run = this.store.getRun(runId);
    const cp = this.store
      .listCheckpoints(runId)
      .find(c => c.id === checkpointId);
    if (!cp) {
      throw new OrchestratorError(
        'NOT_FOUND',
        `Checkpoint ${checkpointId} not found`,
        404,
      );
    }

    this.activeAbortByRun.get(runId)?.abort();
    const rewound = await this.worktrees.rewindToCheckpoint({
      worktreePath: run.worktreePath,
      runCode: run.id,
      targetCommitSha: cp.gitCommitSha,
    });

    const nodes = this.store.listGraphNodes(runId);
    const edges = this.store.listGraphEdges(runId);
    const rewindIds = computeRewindSet(nodes, edges, cp.nodeId);

    this.store.savepoint(() => {
      for (const n of nodes) {
        if (rewindIds.has(n.id)) {
          this.store.updateNodeState(n.id, {
            status: 'pending',
            outputSummary: `Rewound via rescue ref ${rewound.rescueRef}`,
          });
        }
      }
      this.store.createCheckpoint({
        id: `cp-${randomUUID().slice(0, 8)}`,
        runId,
        nodeId: cp.nodeId,
        label: `Rewound -> ${cp.label}`,
        gitCommitSha: rewound.restoredCommitSha,
        gitTag: `orchestrator/${runId}/rewind-${Date.now()}`,
        rescueRef: rewound.rescueRef,
        completedNodeCount: run.completedNodes,
        totalNodeCount: run.totalNodes,
        engineSnapshotJson: JSON.stringify({rewoundFrom: checkpointId}),
        createdAt: new Date().toISOString(),
      });
      this.store.updateRun(runId, {status: 'running', finishedAt: null});
      this.store.recountRunProgress(runId);
      this.store.appendAudit({
        workflowId: run.workflowId,
        runId,
        category: 'checkpoint',
        author: 'RecoveryController',
        title: `Restored worktree to ${cp.label}`,
        detail: `Rescue ref preserved: ${rewound.rescueRef}`,
      });
    });

    this.schedulePump(runId);
    return this.getRunDetail(runId);
  }

  getRunDetail(runId: string): RunDetailSnapshot {
    const run = this.store.getRun(runId);
    return {
      run,
      version: this.store.getVersion(run.versionId),
      nodes: this.store.listGraphNodes(runId),
      edges: this.store.listGraphEdges(runId),
      attempts: this.store.listAttempts(runId),
      checkpoints: this.store.listCheckpoints(runId),
      interventions: this.store.listInterventions(runId),
      sessions: this.store.listSessionsForRun(runId),
      recentAudit: this.store.listRecentAudit(50, runId),
    };
  }

  schedulePump(runId: string): void {
    const run = this.store.getRun(runId);
    if (run.status !== 'running') {
      return;
    }

    const openInterventions = this.store
      .listInterventions(runId)
      .filter(i => i.status === 'open');
    if (openInterventions.length > 0) {
      this.store.updateRun(runId, {status: 'waiting_human'});
      this.broadcast(
        'run.status',
        {workflowId: run.workflowId, runId},
        {status: 'waiting_human'},
      );
      return;
    }

    const nodesNow = this.store.listGraphNodes(runId);
    const edges = this.store.listGraphEdges(runId);
    const toLaunch: GraphNode[] = [];

    for (let wave = 0; wave < 24; wave += 1) {
      const latestNodes = this.store.listGraphNodes(runId);
      const frontier = computeNextFrontier(latestNodes, edges);
      if (frontier.skipNodeIds.length > 0) {
        for (const skipId of frontier.skipNodeIds) {
          const updated = this.store.updateNodeState(skipId, {
            status: 'skipped',
            outputSummary: 'Bypassed via conditional branch selection.',
          });
          this.store.recordAttempt({
            id: `att-${randomUUID().slice(0, 8)}`,
            runId,
            nodeId: updated.id,
            nodeCode: updated.code,
            attemptNumber: updated.attemptCount,
            executorKind: updated.executorKind,
            capabilityId: updated.capabilityId,
            model: updated.assignedModel ?? '',
            status: 'skipped',
            exitCode: 0,
            durationSec: 0,
            inputSnapshotJson: '{}',
            outputSummary: updated.outputSummary,
            errorMessage: '',
            sessionId: null,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          });
          this.broadcast(
            'node.status',
            {workflowId: run.workflowId, runId, nodeId: updated.id},
            {status: 'skipped', code: updated.code},
          );
        }
        continue;
      }

      for (const readyId of frontier.readyNodeIds) {
        const node = latestNodes.find(n => n.id === readyId);
        if (!node || node.status !== 'pending') {
          continue;
        }
        const claimed = this.store.updateNodeState(node.id, {
          status: 'running',
          attemptCount: node.attemptCount + 1,
        });
        this.broadcast(
          'node.status',
          {workflowId: run.workflowId, runId, nodeId: claimed.id},
          {status: 'running', code: claimed.code},
        );
        toLaunch.push(claimed);
      }
      break;
    }

    if (toLaunch.length === 0) {
      const runningCount = nodesNow.filter(n => n.status === 'running').length;
      const inFlight = this.activeTaskCountByRun.get(runId) ?? 0;
      const doneNode = this.store
        .listGraphNodes(runId)
        .find(n => n.kind === 'done');
      if (runningCount === 0 && inFlight === 0) {
        const updatedRun = this.store.recountRunProgress(runId);
        if (doneNode?.status === 'succeeded') {
          this.store.updateRun(runId, {
            status: 'succeeded',
            finishedAt: new Date().toISOString(),
          });
          this.broadcast(
            'run.status',
            {workflowId: run.workflowId, runId},
            {status: 'succeeded'},
          );
        } else if (updatedRun.failedNodes > 0) {
          this.store.updateRun(runId, {
            status: 'failed',
            finishedAt: new Date().toISOString(),
          });
          this.broadcast(
            'run.status',
            {workflowId: run.workflowId, runId},
            {status: 'failed'},
          );
        }
      }
      return;
    }

    let controller = this.activeAbortByRun.get(runId);
    if (!controller || controller.signal.aborted) {
      controller = new AbortController();
      this.activeAbortByRun.set(runId, controller);
    }

    for (const node of toLaunch) {
      this.activeTaskCountByRun.set(
        runId,
        (this.activeTaskCountByRun.get(runId) ?? 0) + 1,
      );
      void this.executeNode(runId, node, controller.signal).finally(() => {
        const nextCount = Math.max(
          0,
          (this.activeTaskCountByRun.get(runId) ?? 1) - 1,
        );
        this.activeTaskCountByRun.set(runId, nextCount);
        const latestRun = this.store.getRun(runId);
        if (latestRun.status === 'running') {
          this.schedulePump(runId);
        }
      });
    }
  }

  private async executeNode(
    runId: string,
    node: GraphNode,
    signal: AbortSignal,
  ): Promise<void> {
    const run = this.store.getRun(runId);
    const version = this.store.getVersion(run.versionId);
    const goalSpec: GoalSpec = version.goalSpec;
    const attemptId = `att-${randomUUID().slice(0, 8)}`;
    const startedAt = new Date().toISOString();

    this.store.recordAttempt({
      id: attemptId,
      runId,
      nodeId: node.id,
      nodeCode: node.code,
      attemptNumber: node.attemptCount,
      executorKind: node.executorKind,
      capabilityId: node.capabilityId,
      model: node.assignedModel ?? '',
      status: 'running',
      exitCode: null,
      durationSec: 0,
      inputSnapshotJson: JSON.stringify({
        inputContract: node.inputContract,
        requirementRefs: node.requirementRefs,
      }),
      outputSummary: '',
      errorMessage: '',
      sessionId: null,
      startedAt,
      finishedAt: null,
    });

    try {
      if (signal.aborted || this.store.getRun(runId).status !== 'running') {
        this.store.updateNodeState(node.id, {status: 'pending'});
        return;
      }

      if (
        node.kind === 'start' ||
        node.kind === 'join' ||
        node.kind === 'done'
      ) {
        const summary =
          node.kind === 'done'
            ? 'All upstream gates & checkpoints certified; run complete.'
            : `${node.code} control synchronization complete.`;
        this.finishNodeSuccess(
          runId,
          run.workflowId,
          node,
          attemptId,
          startedAt,
          summary,
          null,
        );
        return;
      }

      if (node.kind === 'decision') {
        const summary =
          node.outputSummary.trim() ||
          JSON.stringify({
            selectedBranch: node.branchCondition || 'standard',
          });
        this.finishNodeSuccess(
          runId,
          run.workflowId,
          node,
          attemptId,
          startedAt,
          summary,
          null,
        );
        return;
      }

      if (node.kind === 'human_gate') {
        const intItem = this.store.createIntervention({
          runId,
          nodeId: node.id,
          kind: 'human_gate',
          question: `Human Gate (${node.code}): ${node.title}`,
          contextSnippet: `${node.description}\nInput Contract: ${node.inputContract}`,
          options: ['Approve & Continue', 'Waive Gate', 'Reject & Stop'],
          recommendedIndex: 0,
          downstreamBlockedCount: 1,
        });
        this.store.updateNodeState(node.id, {status: 'waiting_human'});
        this.store.updateRun(runId, {status: 'waiting_human'});
        this.broadcast(
          'intervention.created',
          {workflowId: run.workflowId, runId, nodeId: node.id},
          {interventionId: intItem.id, question: intItem.question},
        );
        return;
      }

      if (node.kind === 'checkpoint') {
        const commitRes = await this.worktrees.createCheckpoint({
          worktreePath: run.worktreePath,
          runCode: run.id,
          nodeCode: node.code,
          message: `chore(${run.id}): checkpoint ${node.code} verified`,
        });
        const progressed = this.store.recountRunProgress(runId);
        const cp: CheckpointRecord = {
          id: `cp-${randomUUID().slice(0, 8)}`,
          runId,
          nodeId: node.id,
          label: `${node.code} Verified Snapshot`,
          gitCommitSha: commitRes.commitSha,
          gitTag: commitRes.gitTag,
          rescueRef: null,
          completedNodeCount: progressed.completedNodes,
          totalNodeCount: progressed.totalNodes,
          engineSnapshotJson: JSON.stringify({
            changedFiles: commitRes.changedFiles,
          }),
          createdAt: new Date().toISOString(),
        };
        this.store.createCheckpoint(cp);
        this.broadcast(
          'checkpoint.created',
          {workflowId: run.workflowId, runId, nodeId: node.id},
          {checkpointId: cp.id, gitTag: cp.gitTag},
        );
        this.finishNodeSuccess(
          runId,
          run.workflowId,
          node,
          attemptId,
          startedAt,
          `Created Git checkpoint ${commitRes.gitTag} (${commitRes.commitSha.slice(0, 8)})`,
          null,
        );
        return;
      }

      if (node.kind === 'restore') {
        if (run.reworkCount >= run.maxReworkIterations) {
          this.finishNodeFailure(
            runId,
            run.workflowId,
            node,
            attemptId,
            startedAt,
            1,
            `Bounded rework budget exhausted (${run.reworkCount}/${run.maxReworkIterations}).`,
            null,
          );
          this.store.createIntervention({
            runId,
            nodeId: node.id,
            kind: 'escalation',
            question: `Rework limit reached (${run.maxReworkIterations}) at ${node.code}`,
            contextSnippet:
              'Choose whether to retry a gate manually or abort run.',
            options: ['Manual Retry Gate', 'Cancel Run'],
          });
          this.store.updateRun(runId, {status: 'waiting_human'});
          return;
        }

        const cps = this.store.listCheckpoints(runId);
        const baseCp = cps[cps.length - 1];
        const targetSha = baseCp?.gitCommitSha ?? run.baseCommitSha;
        const rewound = await this.worktrees.rewindToCheckpoint({
          worktreePath: run.worktreePath,
          runCode: run.id,
          targetCommitSha: targetSha,
        });

        const edges = this.store.listGraphEdges(runId);
        const loopEdge = edges.find(
          e => e.sourceNodeId === node.id && e.kind === 'loop',
        );
        const targetNodeId =
          node.restoreTargetCheckpointId ?? loopEdge?.targetNodeId ?? node.id;
        const resetSet = computeRewindSet(
          this.store.listGraphNodes(runId),
          edges,
          targetNodeId,
        );

        this.store.savepoint(() => {
          for (const id of resetSet) {
            this.store.updateNodeState(id, {status: 'pending'});
          }
          this.store.updateRun(runId, {reworkCount: run.reworkCount + 1});
          this.store.appendAudit({
            workflowId: run.workflowId,
            runId,
            category: 'checkpoint',
            author: 'RecoveryController',
            title: `Bounded rework #${run.reworkCount + 1} rewound via ${rewound.rescueRef}`,
            detail: `Reset ${resetSet.size} node(s) from ${node.code}`,
          });
        });

        this.finishNodeSuccess(
          runId,
          run.workflowId,
          node,
          attemptId,
          startedAt,
          `Rewound ${resetSet.size} nodes cleanly via rescue ref ${rewound.rescueRef}`,
          null,
        );
        return;
      }

      if (node.kind === 'gate_shell') {
        const res = await this.certifier.runShellGate(run, node);
        if (res.passed) {
          this.finishNodeSuccess(
            runId,
            run.workflowId,
            node,
            attemptId,
            startedAt,
            res.summary,
            res.sessionId,
          );
        } else {
          this.finishNodeFailure(
            runId,
            run.workflowId,
            node,
            attemptId,
            startedAt,
            res.exitCode,
            res.errorMessage,
            res.sessionId,
          );
        }
        return;
      }

      if (node.kind === 'selfcheck') {
        const res = await this.certifier.runSelfCheck(run, goalSpec);
        this.finishNodeSuccess(
          runId,
          run.workflowId,
          node,
          attemptId,
          startedAt,
          res.summary,
          res.sessionId,
        );
        return;
      }

      if (node.kind === 'qa_audit') {
        const res = await this.certifier.runQaAudit(
          run,
          node,
          goalSpec,
          signal,
          chunk => {
            this.broadcast(
              'session.chunk',
              {workflowId: run.workflowId, runId, nodeId: node.id},
              {chunk},
            );
          },
        );
        if (res.passed) {
          this.finishNodeSuccess(
            runId,
            run.workflowId,
            node,
            attemptId,
            startedAt,
            res.summary,
            res.sessionId,
          );
        } else {
          this.finishNodeFailure(
            runId,
            run.workflowId,
            node,
            attemptId,
            startedAt,
            res.exitCode,
            res.errorMessage,
            res.sessionId,
          );
        }
        return;
      }

      // `task` or `ghost`
      const cap =
        this.store.listCapabilities().find(c => c.id === node.capabilityId) ??
        this.store.listCapabilities().find(c => c.id === 'native-api')!;
      const model = node.assignedModel || cap.defaultModel;
      const session = this.store.createSession({
        runId,
        nodeId: node.id,
        capabilityId: cap.id,
        model,
        role: node.assignedRole,
      });

      const userPrompt = [
        `Workflow Goal: ${goalSpec.goal}`,
        `Node: ${node.code} — ${node.title}`,
        `Description: ${node.description}`,
        `Requirements: ${node.requirementRefs.join(', ') || 'General'}`,
        `Input Contract: ${node.inputContract}`,
        `Output Contract: ${node.outputContract}`,
      ].join('\n');

      this.store.appendSessionMessage({
        sessionId: session.id,
        role: 'user',
        content: userPrompt,
      });

      const result = await this.hub.invokeCapability({
        sessionId: session.id,
        runId,
        nodeId: node.id,
        nodeCode: node.code,
        role: node.assignedRole,
        capability: cap,
        model,
        permissionTier: run.permissionTier,
        cwd: run.worktreePath,
        systemPrompt: cap.sovereignSoul,
        userPrompt,
        gateCommand: node.gateCommand,
        fileScope: node.fileScope,
        readOnly: false,
        signal,
        onChunk: (role, content, toolName) => {
          this.store.appendSessionMessage({
            sessionId: session.id,
            role,
            content,
            toolName,
          });
          this.broadcast(
            'session.chunk',
            {workflowId: run.workflowId, runId, nodeId: node.id},
            {sessionId: session.id, role, content},
          );
        },
      });

      if (signal.aborted || this.store.getRun(runId).status === 'paused') {
        this.store.finishSession(session.id, 'failed');
        this.store.updateNodeState(node.id, {status: 'pending'});
        return;
      }

      if (result.outcome === 'completed') {
        this.store.finishSession(session.id, 'completed');
        this.finishNodeSuccess(
          runId,
          run.workflowId,
          node,
          attemptId,
          startedAt,
          result.finalText.slice(0, 1200),
          session.id,
        );
      } else {
        this.store.finishSession(session.id, 'failed');
        this.finishNodeFailure(
          runId,
          run.workflowId,
          node,
          attemptId,
          startedAt,
          result.exitCode,
          result.errorMessage || result.outcome,
          session.id,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (signal.aborted || this.store.getRun(runId).status === 'paused') {
        this.store.updateNodeState(node.id, {status: 'pending'});
        return;
      }
      this.finishNodeFailure(
        runId,
        run.workflowId,
        node,
        attemptId,
        startedAt,
        1,
        msg,
        null,
      );
    }
  }

  private finishNodeSuccess(
    runId: string,
    workflowId: string,
    node: GraphNode,
    attemptId: string,
    startedAt: string,
    summary: string,
    sessionId: string | null,
  ): void {
    const finishedAt = new Date().toISOString();
    const durationSec = Math.max(
      0.01,
      Number(
        ((Date.parse(finishedAt) - Date.parse(startedAt)) / 1000).toFixed(2),
      ),
    );
    this.store.updateNodeState(node.id, {
      status: 'succeeded',
      outputSummary: summary,
    });
    this.store.recordAttempt({
      id: attemptId,
      runId,
      nodeId: node.id,
      nodeCode: node.code,
      attemptNumber: node.attemptCount,
      executorKind: node.executorKind,
      capabilityId: node.capabilityId,
      model: node.assignedModel ?? '',
      status: 'succeeded',
      exitCode: 0,
      durationSec,
      inputSnapshotJson: JSON.stringify({inputContract: node.inputContract}),
      outputSummary: summary,
      errorMessage: '',
      sessionId,
      startedAt,
      finishedAt,
    });
    this.store.recountRunProgress(runId);
    this.broadcast(
      'node.status',
      {workflowId, runId, nodeId: node.id},
      {status: 'succeeded', code: node.code, summary},
    );
  }

  private finishNodeFailure(
    runId: string,
    workflowId: string,
    node: GraphNode,
    attemptId: string,
    startedAt: string,
    exitCode: number,
    errorMessage: string,
    sessionId: string | null,
  ): void {
    const finishedAt = new Date().toISOString();
    const durationSec = Math.max(
      0.01,
      Number(
        ((Date.parse(finishedAt) - Date.parse(startedAt)) / 1000).toFixed(2),
      ),
    );
    this.store.updateNodeState(node.id, {
      status: 'failed',
      outputSummary: errorMessage,
    });
    this.store.recordAttempt({
      id: attemptId,
      runId,
      nodeId: node.id,
      nodeCode: node.code,
      attemptNumber: node.attemptCount,
      executorKind: node.executorKind,
      capabilityId: node.capabilityId,
      model: node.assignedModel ?? '',
      status: 'failed',
      exitCode,
      durationSec,
      inputSnapshotJson: JSON.stringify({inputContract: node.inputContract}),
      outputSummary: '',
      errorMessage,
      sessionId,
      startedAt,
      finishedAt,
    });
    this.store.recountRunProgress(runId);
    this.store.appendAudit({
      workflowId,
      runId,
      category: 'execution',
      author: 'OrchestratorEngine',
      title: `Node ${node.code} failed`,
      detail: errorMessage,
    });
    this.broadcast(
      'node.status',
      {workflowId, runId, nodeId: node.id},
      {status: 'failed', code: node.code, errorMessage},
    );
  }
}
