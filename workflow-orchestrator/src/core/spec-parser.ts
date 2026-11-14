/**
 * Requirements Document (Markdown/PRD) Parser & Capability-Constrained
 * Twin-Graph Planner.
 *
 * Transforms confirmed requirements Markdown into:
 * 1) Structured `GoalSpec` (goal, inputs, outputs, constraints, FR-xx, AC-xx,
 *    and source-tagged assumptions: `doc` vs `suggested`).
 * 2) Hierarchical WBS + executable Twin-Graph (parallel streams, conditional
 *    routing, Join barrier, Gate/Audit, bounded Restore loop) with explicit
 *    per-node Planning Rationale and requirement traceability.
 */

import {randomUUID} from 'node:crypto';
import type {
  AcceptanceCriterion,
  CapabilityAdapterManifest,
  CapabilityHealthProfile,
  GoalAssumption,
  GoalRequirement,
  GoalSpec,
  GraphEdge,
  GraphNode,
  PermissionTier,
} from '../shared/types.ts';
import {selectHealthyCapability} from './telemetry.ts';

type SectionKey =
  | 'goal'
  | 'inputs'
  | 'outputs'
  | 'constraints'
  | 'domainRules'
  | 'requirements'
  | 'acceptance'
  | 'assumptions'
  | 'other';

function classifyHeading(heading: string): SectionKey {
  const h = heading.toLowerCase();
  if (/goal|objective|summary|概述|目标|背景/.test(h)) {
    return 'goal';
  }
  if (/input|输入|前置/.test(h)) {
    return 'inputs';
  }
  if (/output|deliverable|artifact|输出|交付/.test(h)) {
    return 'outputs';
  }
  if (/constraint|non-functional|limit|约束|限制/.test(h)) {
    return 'constraints';
  }
  if (/domain|rule|invariant|glossary|领域|规则|不变量/.test(h)) {
    return 'domainRules';
  }
  if (/requirement|feature|scope|fr-|功能|需求/.test(h)) {
    return 'requirements';
  }
  if (/acceptance|criteria|test|verify|ac-|验收|测试/.test(h)) {
    return 'acceptance';
  }
  if (/assumption|假设|前提/.test(h)) {
    return 'assumptions';
  }
  return 'other';
}

function cleanBullet(line: string): string {
  return line.replace(/^\s*(?:[-*+]|\d+[.)]|\[[ xX]\])\s+/, '').trim();
}

export function parseRequirementsMarkdown(input: {
  readonly workflowId: string;
  readonly rawMarkdown: string;
  readonly titleHint?: string;
  readonly defaultVerifyCommand?: string;
}): GoalSpec {
  const now = new Date().toISOString();
  const lines = input.rawMarkdown.split(/\r?\n/);

  let parsedTitle = input.titleHint?.trim() ?? '';
  let activeSection: SectionKey = 'goal';

  const buckets: Record<SectionKey, string[]> = {
    goal: [],
    inputs: [],
    outputs: [],
    constraints: [],
    domainRules: [],
    requirements: [],
    acceptance: [],
    assumptions: [],
    other: [],
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }
    const h1 = /^#\s+(.+)$/.exec(trimmed);
    if (h1 && !parsedTitle) {
      parsedTitle = h1[1]!.trim();
      continue;
    }
    const h2 = /^#{2,4}\s+(.+)$/.exec(trimmed);
    if (h2) {
      activeSection = classifyHeading(h2[1]!);
      continue;
    }
    buckets[activeSection].push(cleanBullet(trimmed));
  }

  const title = parsedTitle || 'Untitled Workflow Specification';
  const goal =
    buckets.goal.join(' ').trim() ||
    buckets.other[0] ||
    `Deliver verified implementation for ${title}`;

  const rawReqLines =
    buckets.requirements.length > 0
      ? buckets.requirements
      : buckets.other.length > 0
        ? buckets.other
        : [goal];

  const requirements: GoalRequirement[] = rawReqLines.map((line, index) => {
    const codeMatch = /^(?:\*\*)?(FR-\d+|REQ-\d+)(?:\*\*)?[:：\s-]+(.+)$/i.exec(
      line,
    );
    const code = codeMatch
      ? codeMatch[1]!.toUpperCase()
      : `FR-${String(index + 1).padStart(2, '0')}`;
    const body = codeMatch ? codeMatch[2]!.trim() : line;
    const colonSplit = body.split(/[:：]\s+/);
    const shortTitle =
      colonSplit[0] && colonSplit[0].length <= 64
        ? colonSplit[0].trim()
        : body.slice(0, 56);
    const shouldFlag = /\bshould\b|optional|可选|建议/i.test(body);
    return {
      id: `req-${index + 1}-${randomUUID().slice(0, 6)}`,
      code,
      title: shortTitle,
      description: body,
      priority: shouldFlag ? 'should' : 'must',
      verifyHint:
        input.defaultVerifyCommand ?? 'npm run typecheck && npm run verify',
    };
  });

  const acceptanceCriteria: AcceptanceCriterion[] = (
    buckets.acceptance.length > 0
      ? buckets.acceptance
      : requirements.slice(0, 3).map(r => `Verify ${r.code}: ${r.title}`)
  ).map((line, index) => {
    const codeMatch = /^(?:\*\*)?(AC-\d+)(?:\*\*)?[:：\s-]+(.+)$/i.exec(line);
    const code = codeMatch
      ? codeMatch[1]!.toUpperCase()
      : `AC-${String(index + 1).padStart(2, '0')}`;
    const label = codeMatch ? codeMatch[2]!.trim() : line;
    const cmdMatch = /`([^`]+)`/.exec(label);
    return {
      id: `ac-${index + 1}-${randomUUID().slice(0, 6)}`,
      code,
      label,
      verifyCommand: cmdMatch?.[1] ?? input.defaultVerifyCommand,
      verified: false,
    };
  });

  const assumptions: GoalAssumption[] = buckets.assumptions.map(
    (text, idx) => ({
      id: `asm-doc-${idx + 1}`,
      text,
      source: 'doc',
      rationale: 'Extracted directly from Requirements Document.',
    }),
  );

  if (buckets.inputs.length === 0) {
    assumptions.push({
      id: 'asm-sug-inputs',
      text: 'Workspace repository source tree serves as primary input state.',
      source: 'suggested',
      rationale:
        'Suggested because no explicit Inputs section was found in Markdown.',
    });
  }
  if (buckets.outputs.length === 0) {
    assumptions.push({
      id: 'asm-sug-outputs',
      text: 'Verified commit diff, gate exit report, and traceability audit constitute deliverables.',
      source: 'suggested',
      rationale: 'Suggested because no explicit Outputs section was specified.',
    });
  }
  if (buckets.acceptance.length === 0) {
    assumptions.push({
      id: 'asm-sug-ac',
      text: 'Acceptance criteria were synthesized automatically from top functional requirements.',
      source: 'suggested',
      rationale:
        'Review suggested AC items before locking workflow version for production runs.',
    });
  }

  return {
    id: `spec-${randomUUID().slice(0, 8)}`,
    workflowId: input.workflowId,
    rawMarkdown: input.rawMarkdown,
    title,
    goal,
    inputs:
      buckets.inputs.length > 0
        ? buckets.inputs
        : [
            'Confirmed Requirements Document (Markdown)',
            'Target Git Repository',
          ],
    outputs:
      buckets.outputs.length > 0
        ? buckets.outputs
        : [
            'Implemented & Tested Source Changes',
            'Verification & Audit Bundle',
          ],
    constraints:
      buckets.constraints.length > 0
        ? buckets.constraints
        : [
            'All workspace mutations must stay confined within assigned Git worktree.',
            'Execution must fail closed if verification gates fail.',
          ],
    domainRules: buckets.domainRules,
    requirements,
    acceptanceCriteria,
    assumptions,
    updatedAt: now,
  };
}

function makeNodeId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

export interface PlannedTwinGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

/**
 * Compiles a structured `GoalSpec` into a 3-phase hierarchical WBS + Twin-Graph
 * with parallel branches, conditional routing, Join barrier, Gate/Selfcheck/QA,
 * Checkpoint, Restore loop, and Done terminal node.
 */
export function planTwinGraphFromGoalSpec(input: {
  readonly scopeId: string;
  readonly goalSpec: GoalSpec;
  readonly capabilities: readonly CapabilityAdapterManifest[];
  readonly healthProfiles: readonly CapabilityHealthProfile[];
  readonly permissionTier: PermissionTier;
  readonly verifyCommand: string;
}): PlannedTwinGraph {
  const {
    scopeId,
    goalSpec,
    capabilities,
    healthProfiles,
    permissionTier,
    verifyCommand,
  } = input;
  const now = new Date().toISOString();

  const leadCap =
    selectHealthyCapability(capabilities, healthProfiles, 'agent', 'lead')
      ?.id ?? 'native-api';
  const workerCap =
    selectHealthyCapability(capabilities, healthProfiles, 'agent', 'worker')
      ?.id ?? 'native-api';
  const evalCap =
    selectHealthyCapability(capabilities, healthProfiles, 'agent', 'evaluator')
      ?.id ?? 'native-api';
  const shellCap =
    selectHealthyCapability(capabilities, healthProfiles, 'tool', 'worker')
      ?.id ?? 'tool:shell';
  const humanCap = 'human:reviewer';
  const controlCap = 'control:plane';

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const allReqCodes = goalSpec.requirements.map(r => r.code);
  const allAcCodes = goalSpec.acceptanceCriteria.map(a => a.code);

  // Phase containers (WBS Hierarchy Level 1)
  const p1ContainerId = makeNodeId('p1');
  const p2ContainerId = makeNodeId('p2');
  const p3ContainerId = makeNodeId('p3');

  nodes.push(
    {
      id: p1ContainerId,
      scopeId,
      code: 'P1',
      parentWbsId: null,
      containerNodeId: null,
      phaseId: p1ContainerId,
      phaseTitle: 'Phase 1 · Alignment & Intake',
      depth: 0,
      kind: 'phase_container',
      executorKind: 'control',
      capabilityId: controlCap,
      assignedRole: 'lead',
      assignedModel: null,
      title: 'Phase 1: Specification & Contract Alignment',
      description:
        'Initialize run baseline, verify constraints, and establish contracts.',
      planningRationale:
        'Guarantees domain boundaries and acceptance baselines before branching parallel implementation tasks.',
      requirementRefs: allReqCodes.slice(0, 1),
      inputContract: goalSpec.inputs.join(' + '),
      outputContract: 'Interface Contract & Execution Plan',
      fileScope: ['docs/**'],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 1,
      collapsed: false,
      positionX: 40,
      positionY: 32,
      width: 270,
      height: permissionTier === 'strict' ? 370 : 260,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
    {
      id: p2ContainerId,
      scopeId,
      code: 'P2',
      parentWbsId: null,
      containerNodeId: null,
      phaseId: p2ContainerId,
      phaseTitle: 'Phase 2 · Parallel Execution',
      depth: 0,
      kind: 'phase_container',
      executorKind: 'control',
      capabilityId: controlCap,
      assignedRole: 'worker',
      assignedModel: null,
      title: 'Phase 2: Parallel Synthesis & Routing',
      description:
        'Concurrently execute disjoint feature slices and conditional compliance checks.',
      planningRationale:
        'Parallelizes independent FR slices with disjoint fileScopes to prevent merge conflicts and reduce latency.',
      requirementRefs: allReqCodes,
      inputContract: 'Interface Contract & Execution Plan',
      outputContract: 'Integrated Feature Diff & Artifacts',
      fileScope: ['src/**', 'renderer/**', 'docs/**'],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 1,
      collapsed: false,
      positionX: 350,
      positionY: 32,
      width: 520,
      height: 370,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
    {
      id: p3ContainerId,
      scopeId,
      code: 'P3',
      parentWbsId: null,
      containerNodeId: null,
      phaseId: p3ContainerId,
      phaseTitle: 'Phase 3 · Verification & Recovery',
      depth: 0,
      kind: 'phase_container',
      executorKind: 'control',
      capabilityId: controlCap,
      assignedRole: 'evaluator',
      assignedModel: null,
      title: 'Phase 3: Hard Gates, Audit & Release',
      description:
        'Deterministic command gate, self-check, independent QA, and bounded checkpoint rework.',
      planningRationale:
        'Separates objective shell verification from independent QA scoring with bounded automatic rollback.',
      requirementRefs: allAcCodes,
      inputContract: 'Integrated Feature Diff & Artifacts',
      outputContract: goalSpec.outputs.join(' + '),
      fileScope: [],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 1,
      collapsed: false,
      positionX: 910,
      positionY: 32,
      width: 500,
      height: 370,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
  );

  // Phase 1 Nodes
  const startId = makeNodeId('start');
  const p1TaskId = makeNodeId('p1t1');
  const p1GateId = permissionTier === 'strict' ? makeNodeId('p1gate') : null;

  nodes.push(
    {
      id: startId,
      scopeId,
      code: 'START',
      parentWbsId: p1ContainerId,
      containerNodeId: p1ContainerId,
      phaseId: p1ContainerId,
      phaseTitle: 'Phase 1 · Alignment & Intake',
      depth: 1,
      kind: 'start',
      executorKind: 'control',
      capabilityId: controlCap,
      assignedRole: 'lead',
      assignedModel: null,
      title: 'Start Intake',
      description:
        'Lock GoalSpec inputs and initialize isolated Git worktree baseline.',
      planningRationale:
        'Entry anchor recording base commit SHA and immutable spec context.',
      requirementRefs: allReqCodes.slice(0, 1),
      inputContract: 'Requirements Markdown',
      outputContract: 'Initialized Worktree Context',
      fileScope: [],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 1,
      collapsed: false,
      positionX: 64,
      positionY: 82,
      width: 220,
      height: 70,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
    {
      id: p1TaskId,
      scopeId,
      code: 'P1.T1',
      parentWbsId: p1ContainerId,
      containerNodeId: p1ContainerId,
      phaseId: p1ContainerId,
      phaseTitle: 'Phase 1 · Alignment & Intake',
      depth: 1,
      kind: 'task',
      executorKind: 'agent',
      capabilityId: leadCap,
      assignedRole: 'lead',
      assignedModel: null,
      title: 'Contract & Architecture Alignment',
      description: `Break down interfaces & shared contracts for: ${goalSpec.goal}`,
      planningRationale:
        'Upstream contract alignment prevents schema drift when downstream parallel workers execute simultaneously.',
      requirementRefs: allReqCodes.length > 0 ? allReqCodes : ['FR-01'],
      inputContract: 'Initialized Worktree Context',
      outputContract: 'Verified Shared Contracts & Routing Metadata',
      fileScope: ['src/contracts/**'],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 2,
      collapsed: false,
      positionX: 64,
      positionY: 184,
      width: 220,
      height: 76,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
  );

  edges.push({
    id: makeNodeId('edge'),
    scopeId,
    sourceNodeId: startId,
    targetNodeId: p1TaskId,
    kind: 'dep',
    label: 'init',
    conditionExpr: null,
  });

  let phase1ExitId = p1TaskId;
  if (p1GateId) {
    nodes.push({
      id: p1GateId,
      scopeId,
      code: 'P1.H1',
      parentWbsId: p1ContainerId,
      containerNodeId: p1ContainerId,
      phaseId: p1ContainerId,
      phaseTitle: 'Phase 1 · Alignment & Intake',
      depth: 1,
      kind: 'human_gate',
      executorKind: 'human',
      capabilityId: humanCap,
      assignedRole: 'lead',
      assignedModel: null,
      title: 'Human Contract Sign-Off',
      description:
        'Approve contract plan before parallel mutation phase begins.',
      planningRationale:
        'Enforces strict permission-tier governance prior to code edits.',
      requirementRefs: allReqCodes.slice(0, 1),
      inputContract: 'Verified Shared Contracts',
      outputContract: 'Human Approval Token',
      fileScope: [],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 1,
      collapsed: false,
      positionX: 64,
      positionY: 288,
      width: 220,
      height: 76,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    });
    edges.push({
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: p1TaskId,
      targetNodeId: p1GateId,
      kind: 'dep',
      label: 'approve',
      conditionExpr: null,
    });
    phase1ExitId = p1GateId;
  }

  // Phase 2 Parallel Branches + Conditional Split + Join
  const half = Math.max(1, Math.ceil(goalSpec.requirements.length / 2));
  const sliceAReqs = goalSpec.requirements.slice(0, half);
  const sliceBReqs = goalSpec.requirements.slice(half);

  const p2TaskAId = makeNodeId('p2t1');
  const p2TaskBId = makeNodeId('p2t2');
  const p2DecisionId = makeNodeId('p2d1');
  const p2ExtendedId = makeNodeId('p2ext');
  const p2StandardId = makeNodeId('p2std');
  const p2JoinId = makeNodeId('p2join');

  nodes.push(
    {
      id: p2TaskAId,
      scopeId,
      code: 'P2.T1',
      parentWbsId: p2ContainerId,
      containerNodeId: p2ContainerId,
      phaseId: p2ContainerId,
      phaseTitle: 'Phase 2 · Parallel Execution',
      depth: 1,
      kind: 'task',
      executorKind: 'agent',
      capabilityId: workerCap,
      assignedRole: 'worker',
      assignedModel: null,
      title:
        sliceAReqs[0]?.title.slice(0, 42) ||
        'Core Domain & Service Implementation',
      description:
        sliceAReqs.map(r => `${r.code}: ${r.description}`).join('\n') ||
        goalSpec.goal,
      planningRationale:
        'Primary core logic slice scoped cleanly to `src/core/**` for safe concurrent execution.',
      requirementRefs:
        sliceAReqs.length > 0 ? sliceAReqs.map(r => r.code) : ['FR-01'],
      inputContract: 'Verified Shared Contracts',
      outputContract: 'Core Implementation Diff',
      fileScope: ['src/core/**'],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 3,
      collapsed: false,
      positionX: 374,
      positionY: 82,
      width: 220,
      height: 78,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
    {
      id: p2TaskBId,
      scopeId,
      code: 'P2.T2',
      parentWbsId: p2ContainerId,
      containerNodeId: p2ContainerId,
      phaseId: p2ContainerId,
      phaseTitle: 'Phase 2 · Parallel Execution',
      depth: 1,
      kind: 'task',
      executorKind: 'agent',
      capabilityId: workerCap,
      assignedRole: 'specialist',
      assignedModel: null,
      title:
        sliceBReqs[0]?.title.slice(0, 42) ||
        'Integration Surface & API Adapter',
      description:
        sliceBReqs.length > 0
          ? sliceBReqs.map(r => `${r.code}: ${r.description}`).join('\n')
          : 'Implement external integration surface, error guards, and telemetry hooks.',
      planningRationale:
        'Parallel slice isolated to `src/api/**` so independent integration work completes concurrently.',
      requirementRefs:
        sliceBReqs.length > 0
          ? sliceBReqs.map(r => r.code)
          : allReqCodes.slice(0, 1),
      inputContract: 'Verified Shared Contracts',
      outputContract: 'Integration Surface Diff',
      fileScope: ['src/api/**'],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 3,
      collapsed: false,
      positionX: 374,
      positionY: 204,
      width: 220,
      height: 78,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
    {
      id: p2DecisionId,
      scopeId,
      code: 'P2.D1',
      parentWbsId: p2ContainerId,
      containerNodeId: p2ContainerId,
      phaseId: p2ContainerId,
      phaseTitle: 'Phase 2 · Parallel Execution',
      depth: 1,
      kind: 'decision',
      executorKind: 'control',
      capabilityId: controlCap,
      assignedRole: 'lead',
      assignedModel: null,
      title: 'Complexity & Compliance Route',
      description:
        'Selects extended documentation/compliance pass vs standard fast path based on diff risk.',
      planningRationale:
        'Models conditional branching cleanly so low-risk updates skip unnecessary extra passes.',
      requirementRefs: allAcCodes.slice(0, 1),
      inputContract: 'Core Implementation Diff',
      outputContract: 'Branch Selection Decision',
      fileScope: [],
      gateCommand: null,
      branchCondition: 'standard',
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 1,
      collapsed: false,
      positionX: 626,
      positionY: 82,
      width: 210,
      height: 74,
      outputSummary: '{"selectedBranch":"standard"}',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
    {
      id: p2StandardId,
      scopeId,
      code: 'P2.T3',
      parentWbsId: p2ContainerId,
      containerNodeId: p2ContainerId,
      phaseId: p2ContainerId,
      phaseTitle: 'Phase 2 · Parallel Execution',
      depth: 1,
      kind: 'task',
      executorKind: 'tool',
      capabilityId: shellCap,
      assignedRole: 'worker',
      assignedModel: null,
      title: 'Standard Contract Sanity Check',
      description:
        'Fast automated schema/syntax sanity validation on changed slices.',
      planningRationale:
        'Lightweight deterministic check on default conditional branch.',
      requirementRefs: allAcCodes.slice(0, 1),
      inputContract: 'Core + Integration Diffs',
      outputContract: 'Sanity Check Artifact',
      fileScope: ['tmp/sanity/**'],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 2,
      collapsed: false,
      positionX: 626,
      positionY: 184,
      width: 210,
      height: 70,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
    {
      id: p2ExtendedId,
      scopeId,
      code: 'P2.T4',
      parentWbsId: p2ContainerId,
      containerNodeId: p2ContainerId,
      phaseId: p2ContainerId,
      phaseTitle: 'Phase 2 · Parallel Execution',
      depth: 1,
      kind: 'task',
      executorKind: 'agent',
      capabilityId: workerCap,
      assignedRole: 'specialist',
      assignedModel: null,
      title: 'Extended Security & Docs Pass',
      description:
        'Deep security & migration guide generation triggered when extended route selected.',
      planningRationale:
        'Activated conditionally for high-risk schema or security constraint changes.',
      requirementRefs: allReqCodes.slice(0, 1),
      inputContract: 'Core + Integration Diffs',
      outputContract: 'Extended Compliance Report',
      fileScope: ['docs/compliance/**'],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 2,
      collapsed: false,
      positionX: 626,
      positionY: 274,
      width: 210,
      height: 70,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
    {
      id: p2JoinId,
      scopeId,
      code: 'P2.J1',
      parentWbsId: p2ContainerId,
      containerNodeId: p2ContainerId,
      phaseId: p2ContainerId,
      phaseTitle: 'Phase 2 · Parallel Execution',
      depth: 1,
      kind: 'join',
      executorKind: 'control',
      capabilityId: controlCap,
      assignedRole: 'lead',
      assignedModel: null,
      title: 'Parallel Join Barrier',
      description:
        'Synchronizes parallel implementation branches and resolved conditional branch.',
      planningRationale:
        'Ensures Phase 3 Hard Gates run only after every active Phase 2 branch finishes or cleanly skips.',
      requirementRefs: allReqCodes,
      inputContract: 'Core Diff + Integration Diff + Branch Result',
      outputContract: 'Unified Ready-to-Verify Snapshot',
      fileScope: [],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 1,
      collapsed: false,
      positionX: 374,
      positionY: 312,
      width: 220,
      height: 66,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
  );

  edges.push(
    {
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: phase1ExitId,
      targetNodeId: p2TaskAId,
      kind: 'dep',
      label: 'fork-A',
      conditionExpr: null,
    },
    {
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: phase1ExitId,
      targetNodeId: p2TaskBId,
      kind: 'dep',
      label: 'fork-B',
      conditionExpr: null,
    },
    {
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: p2TaskAId,
      targetNodeId: p2DecisionId,
      kind: 'dep',
      label: 'route',
      conditionExpr: null,
    },
    {
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: p2DecisionId,
      targetNodeId: p2StandardId,
      kind: 'pass',
      label: 'standard',
      conditionExpr: 'standard',
    },
    {
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: p2DecisionId,
      targetNodeId: p2ExtendedId,
      kind: 'pass',
      label: 'extended',
      conditionExpr: 'extended',
    },
    {
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: p2TaskBId,
      targetNodeId: p2JoinId,
      kind: 'dep',
      label: 'sync',
      conditionExpr: null,
    },
    {
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: p2StandardId,
      targetNodeId: p2JoinId,
      kind: 'dep',
      label: 'sync',
      conditionExpr: null,
    },
    {
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: p2ExtendedId,
      targetNodeId: p2JoinId,
      kind: 'dep',
      label: 'sync',
      conditionExpr: null,
    },
  );

  // Phase 3 Verification, Audit & Recovery Loop
  const gateId = makeNodeId('p3gate');
  const selfcheckId = makeNodeId('p3sc');
  const qaId = makeNodeId('p3qa');
  const ckptId = makeNodeId('p3ckpt');
  const restoreId = makeNodeId('p3rst');
  const doneId = makeNodeId('p3done');

  nodes.push(
    {
      id: gateId,
      scopeId,
      code: 'P3.GATE',
      parentWbsId: p3ContainerId,
      containerNodeId: p3ContainerId,
      phaseId: p3ContainerId,
      phaseTitle: 'Phase 3 · Verification & Recovery',
      depth: 1,
      kind: 'gate_shell',
      executorKind: 'tool',
      capabilityId: shellCap,
      assignedRole: 'evaluator',
      assignedModel: null,
      title: 'Deterministic Shell Gate',
      description: `Run verification command: ${verifyCommand}`,
      planningRationale:
        'Objective exit-code gate prevents self-grading before QA review.',
      requirementRefs: allAcCodes,
      inputContract: 'Unified Ready-to-Verify Snapshot',
      outputContract: 'Gate Exit Code & Logs',
      fileScope: [],
      gateCommand: verifyCommand,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 2,
      collapsed: false,
      positionX: 936,
      positionY: 82,
      width: 210,
      height: 74,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
    {
      id: selfcheckId,
      scopeId,
      code: 'P3.SC',
      parentWbsId: p3ContainerId,
      containerNodeId: p3ContainerId,
      phaseId: p3ContainerId,
      phaseTitle: 'Phase 3 · Verification & Recovery',
      depth: 1,
      kind: 'selfcheck',
      executorKind: 'tool',
      capabilityId: shellCap,
      assignedRole: 'evaluator',
      assignedModel: null,
      title: 'Acceptance & Diff Self-Check',
      description: 'Inspect git diff & verify AC mapping completeness.',
      planningRationale:
        'Catches stale artifacts and missing requirement coverage early.',
      requirementRefs: allAcCodes,
      inputContract: 'Gate Exit Code & Logs',
      outputContract: 'Diff Summary & Evidence Manifest',
      fileScope: [],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 2,
      collapsed: false,
      positionX: 936,
      positionY: 184,
      width: 210,
      height: 70,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
    {
      id: qaId,
      scopeId,
      code: 'P3.QA',
      parentWbsId: p3ContainerId,
      containerNodeId: p3ContainerId,
      phaseId: p3ContainerId,
      phaseTitle: 'Phase 3 · Verification & Recovery',
      depth: 1,
      kind: 'qa_audit',
      executorKind: 'agent',
      capabilityId: evalCap,
      assignedRole: 'evaluator',
      assignedModel: null,
      title: 'Independent QA Audit',
      description:
        'Evaluate deliverable strictly against GoalSpec constraints and acceptance criteria.',
      planningRationale:
        'Independent evaluator verdict separates pass commit checkpoint from bounded fail-rewind.',
      requirementRefs: allAcCodes,
      inputContract: 'Diff Summary & Evidence Manifest',
      outputContract: 'Fail-Closed JSON Audit Verdict',
      fileScope: [],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 3,
      collapsed: false,
      positionX: 1178,
      positionY: 184,
      width: 210,
      height: 74,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
    {
      id: ckptId,
      scopeId,
      code: 'P3.CKPT',
      parentWbsId: p3ContainerId,
      containerNodeId: p3ContainerId,
      phaseId: p3ContainerId,
      phaseTitle: 'Phase 3 · Verification & Recovery',
      depth: 1,
      kind: 'checkpoint',
      executorKind: 'control',
      capabilityId: controlCap,
      assignedRole: 'evaluator',
      assignedModel: null,
      title: 'Physical Git Checkpoint',
      description: 'Commit certified worktree state and tag durable snapshot.',
      planningRationale:
        'Persists recoverable milestone snapshot on verified QA pass.',
      requirementRefs: allAcCodes.slice(0, 1),
      inputContract: 'Pass Audit Verdict',
      outputContract: 'Git Commit SHA & Tag',
      fileScope: [],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 1,
      collapsed: false,
      positionX: 1178,
      positionY: 82,
      width: 210,
      height: 70,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
    {
      id: restoreId,
      scopeId,
      code: 'P3.RST',
      parentWbsId: p3ContainerId,
      containerNodeId: p3ContainerId,
      phaseId: p3ContainerId,
      phaseTitle: 'Phase 3 · Verification & Recovery',
      depth: 1,
      kind: 'restore',
      executorKind: 'control',
      capabilityId: controlCap,
      assignedRole: 'evaluator',
      assignedModel: null,
      title: 'Bounded Rescue Rewind',
      description:
        'Create non-destructive git rescue ref and rewind execution frontier on QA failure.',
      planningRationale:
        'Guarantees bounded rework without losing forensic failure state.',
      requirementRefs: [],
      inputContract: 'Fail Audit Verdict',
      outputContract: 'Rescue Ref & Rewound Frontier',
      fileScope: [],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 3,
      collapsed: false,
      positionX: 936,
      positionY: 294,
      width: 210,
      height: 72,
      outputSummary: '',
      restoreTargetCheckpointId: gateId,
      updatedAt: now,
    },
    {
      id: doneId,
      scopeId,
      code: 'DONE',
      parentWbsId: p3ContainerId,
      containerNodeId: p3ContainerId,
      phaseId: p3ContainerId,
      phaseTitle: 'Phase 3 · Verification & Recovery',
      depth: 1,
      kind: 'done',
      executorKind: 'control',
      capabilityId: controlCap,
      assignedRole: 'lead',
      assignedModel: null,
      title: 'Workflow Certified Complete',
      description:
        'Mark workflow run completed with full evidence traceability.',
      planningRationale:
        'Final sink reached strictly after checkpoint commit succeeds.',
      requirementRefs: allAcCodes,
      inputContract: 'Git Commit SHA & Tag',
      outputContract: goalSpec.outputs.join(' + '),
      fileScope: [],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 1,
      collapsed: false,
      positionX: 1178,
      positionY: 294,
      width: 210,
      height: 70,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
  );

  edges.push(
    {
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: p2JoinId,
      targetNodeId: gateId,
      kind: 'dep',
      label: 'verify',
      conditionExpr: null,
    },
    {
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: gateId,
      targetNodeId: selfcheckId,
      kind: 'pass',
      label: 'exit 0',
      conditionExpr: null,
    },
    {
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: gateId,
      targetNodeId: restoreId,
      kind: 'fail',
      label: 'fail',
      conditionExpr: null,
    },
    {
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: selfcheckId,
      targetNodeId: qaId,
      kind: 'dep',
      label: 'audit',
      conditionExpr: null,
    },
    {
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: qaId,
      targetNodeId: ckptId,
      kind: 'pass',
      label: 'pass',
      conditionExpr: null,
    },
    {
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: qaId,
      targetNodeId: restoreId,
      kind: 'fail',
      label: 'fail',
      conditionExpr: null,
    },
    {
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: restoreId,
      targetNodeId: gateId,
      kind: 'loop',
      label: 'rework',
      conditionExpr: null,
    },
    {
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: ckptId,
      targetNodeId: doneId,
      kind: 'dep',
      label: 'certify',
      conditionExpr: null,
    },
  );

  return {nodes, edges};
}
