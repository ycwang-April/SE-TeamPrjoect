import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hasForwardCycle} from '../src/core/twin-graph.ts';
import {WorkflowPlannerEngine} from '../src/engines/planner.ts';
import {OrchestratorStore} from '../src/store/database.ts';

function run(): void {
  const tempRoot = mkdtempSync(join(tmpdir(), 'orch-verify-planner-'));
  const store = new OrchestratorStore(join(tempRoot, 'planner.sqlite'));

  try {
    const ws = store.createWorkspace({
      name: 'Verify Repo',
      rootPath: join(tempRoot, 'repo'),
      defaultBranch: 'main',
      verifyCommand: 'node -e "process.exit(0)"',
    });

    const events: string[] = [];
    const planner = new WorkflowPlannerEngine(store, type => {
      events.push(type);
    });

    const markdown = [
      '# Order Reconciliation Service',
      '',
      '## Goal',
      'Automate ledger ingestion, anomaly detection, and audit report export.',
      '',
      '## Inputs',
      '- Settlement CSV feed',
      '- Tax rule table',
      '',
      '## Functional Requirements',
      '- FR-01: Parse incoming settlement batches idempotently.',
      '- FR-02: Route high-value variances to extended compliance check.',
      '- FR-03: Export signed reconciliation summary.',
      '',
      '## Acceptance Criteria',
      '- AC-01: Zero unhandled duplicate entries across rerun.',
      '- AC-02: Verification gate exits 0 with audit record persisted.',
      '',
      '## Assumptions',
      '- Settlement timestamps arrive in UTC.',
    ].join('\n');

    // 1. Parse Requirements Document -> GoalSpec -> WBS + Twin-Graph
    const imported = planner.importRequirements({
      workspaceId: ws.id,
      markdown,
      verifyCommand: 'node -e "process.exit(0)"',
      permissionTier: 'supervised',
      maxReworkIterations: 2,
    });

    assert.equal(imported.goalSpec.requirements.length, 3);
    assert.equal(imported.goalSpec.acceptanceCriteria.length, 2);
    assert.ok(
      imported.goalSpec.assumptions.some(a => a.source === 'doc'),
      'Expected doc-tagged assumption from PRD',
    );
    assert.ok(
      imported.nodes.some(n => n.kind === 'phase_container'),
      'Expected hierarchical phase containers',
    );
    assert.ok(
      imported.nodes.every(
        n => n.kind === 'phase_container' || n.planningRationale.length > 0,
      ),
      'Every non-container node must carry a Planning Rationale',
    );
    assert.equal(imported.validation.valid, true);

    // 2. Dual-mode edit + ChangeImpactReport + Fail-closed capability blocking
    const taskNode = imported.nodes.find(n => n.kind === 'task');
    assert.ok(taskNode, 'Expected at least one task node');

    const baseCap = store.listCapabilities()[0]!;
    store.upsertCapability({
      ...baseCap,
      id: 'cap-unstable',
      label: 'Unstable Adapter',
      enabled: false,
      builtIn: false,
    });
    store.setCapabilityProbe(
      'cap-unstable',
      false,
      'Disabled for check',
      false,
    );

    const blockedDraft = planner.updateDraftGraph(imported.workflow.id, {
      nodePatches: [
        {
          id: taskNode.id,
          capabilityId: 'cap-unstable',
          outputContract: 'Signed Variance Ledger + Checksum',
        },
      ],
    });
    assert.ok(
      blockedDraft.lastImpact,
      'Expected ChangeImpactReport after edit',
    );
    assert.ok(
      blockedDraft.lastImpact.modifiedNodeCodes.includes(taskNode.code),
    );
    assert.equal(blockedDraft.validation.valid, false);
    assert.throws(
      () => planner.confirmVersion(imported.workflow.id),
      /blocking validation error/i,
      'confirmVersion must fail closed when Error-level validation issues exist',
    );

    // 3. Cycle guard distinguishes forward edges from rework loop edges
    assert.equal(
      hasForwardCycle(blockedDraft.nodes, blockedDraft.edges),
      false,
      'Bounded rework loop edge must not trigger forward cycle error',
    );
    const doneNode = blockedDraft.nodes.find(n => n.kind === 'done');
    const startNode = blockedDraft.nodes.find(n => n.kind === 'start');
    assert.ok(doneNode && startNode);
    assert.equal(
      hasForwardCycle(blockedDraft.nodes, [
        ...blockedDraft.edges,
        {
          id: 'synthetic-cycle',
          scopeId: imported.workflow.id,
          sourceNodeId: doneNode.id,
          targetNodeId: startNode.id,
          kind: 'dep',
          label: 'bad-cycle',
          conditionExpr: null,
        },
      ]),
      true,
      'Forward cycle back to START must be rejected',
    );

    // 4. Restore valid capability -> Trial Run -> Lock immutable v1.0
    const repaired = planner.updateDraftGraph(imported.workflow.id, {
      nodePatches: [{id: taskNode.id, capabilityId: 'native-api'}],
    });
    assert.equal(repaired.validation.valid, true);

    const trialed = planner.runTrial(imported.workflow.id);
    assert.ok(trialed.latestTrial?.passed, 'Trial simulation should pass');
    assert.ok(
      trialed.latestTrial.steps.some(t => t.simulatedStatus === 'skipped'),
      'Expected non-selected conditional branch trace marked skipped',
    );

    const version = planner.confirmVersion(imported.workflow.id, {
      label: 'Baseline Verified v1.0',
      frozenBy: 'verify-suite',
    });
    assert.equal(version.versionTag, 'v1.0');
    assert.equal(version.frozenBy, 'verify-suite');
    assert.equal(store.getWorkflow(imported.workflow.id).status, 'locked');
    assert.ok(events.includes('workflow.updated'));

    console.log(
      '[PASS] planner-and-validator: PRD -> GoalSpec -> WBS/Graph -> Impact -> Fail-Closed -> Trial -> v1.0',
    );
  } finally {
    store.close();
    rmSync(tempRoot, {recursive: true, force: true});
  }
}

run();
