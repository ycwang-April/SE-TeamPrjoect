import {type ReactElement, useEffect, useMemo, useState} from 'react';
import type {WorkflowDetailSnapshot} from '../../../src/shared/api';
import type {
  CapabilityAdapterManifest,
  ExecutorKind,
  PermissionTier,
  WorkflowRecord,
  WorkspaceEntry,
} from '../../../src/shared/types';
import {orchApi} from '../api/client';
import {formatWorkflowStatus, tr, type UiLang} from '../i18n';
import {
  AlertIcon,
  LockIcon,
  PlayIcon,
  PlusIcon,
  ShieldCheckIcon,
} from '../components/Icons';
import {TwinGraphCanvas} from '../components/TwinGraphCanvas';

interface WorkflowsViewProps {
  readonly lang: UiLang;
  readonly workspaces: readonly WorkspaceEntry[];
  readonly workflows: readonly WorkflowRecord[];
  readonly capabilities: readonly CapabilityAdapterManifest[];
  readonly selectedWorkflowId: string | null;
  readonly onSelectWorkflow: (workflowId: string) => void;
  readonly onRefreshBootstrap: () => Promise<void>;
  readonly onStartedRun: (runId: string) => void;
}

const DEFAULT_IMPORT_MD = `# Payment Settlement Retry Engine

## Goal
Implement bounded exponential retry and dead-letter persistence for failed settlement webhooks.

## Inputs
- Confirmed Webhook Event Contract (JSON)
- PostgreSQL / SQLite storage adapter

## Outputs
- Idempotent retry scheduler (\`src/core/retry-scheduler.ts\`)
- Dead-letter inspection endpoints (\`src/api/dlq.ts\`)

## Constraints
- Never issue concurrent duplicate retries for the same transactionId.
- Maximum 5 retries before transitioning to dead-letter queue.

## Requirements
- FR-01: Bounded Backoff Calculator — Compute jittered exponential backoff intervals cleanly.
- FR-02: Dead-Letter State Machine — Persist exhausted settlements with diagnostic context.

## Acceptance Criteria
- AC-01: Repeated retry requests honor backoff deadline.
- AC-02: Exhausted events transition deterministically to \`dead_letter\`.
`;

export function WorkflowsView(props: WorkflowsViewProps): ReactElement {
  const {
    lang,
    workspaces,
    workflows,
    capabilities,
    selectedWorkflowId,
    onSelectWorkflow,
    onRefreshBootstrap,
    onStartedRun,
  } = props;

  const [detail, setDetail] = useState<WorkflowDetailSnapshot | null>(null);
  const [subTab, setSubTab] = useState<'spec' | 'graph' | 'validate'>('graph');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Import PRD Modal
  const [showImport, setShowImport] = useState(false);
  const [importMd, setImportMd] = useState(DEFAULT_IMPORT_MD);
  const [importTier, setImportTier] = useState<PermissionTier>('supervised');
  const [importVerifyCmd, setImportVerifyCmd] = useState(
    'node -e "console.log(\'Gate OK\')"',
  );

  // Draft Node Editor form
  const [editTitle, setEditTitle] = useState('');
  const [editCapId, setEditCapId] = useState('');
  const [editExecKind, setEditExecKind] = useState<ExecutorKind>('agent');
  const [editRationale, setEditRationale] = useState('');
  const [editInputContract, setEditInputContract] = useState('');
  const [editOutputContract, setEditOutputContract] = useState('');
  const [editReqRefs, setEditReqRefs] = useState('');
  const [editFileScope, setEditFileScope] = useState('');
  const [editGateCmd, setEditGateCmd] = useState('');

  // Quick add node
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskCode, setNewTaskCode] = useState('P2.CUSTOM');

  const activeId = selectedWorkflowId ?? workflows[0]?.id ?? null;

  const loadDetail = async (id: string): Promise<void> => {
    try {
      const snap = await orchApi.getWorkflowDetail(id);
      setDetail(snap);
      if (
        snap.nodes.length > 0 &&
        !snap.nodes.some(n => n.id === selectedNodeId)
      ) {
        const firstTask =
          snap.nodes.find(n => n.kind === 'task') ?? snap.nodes[0]!;
        setSelectedNodeId(firstTask.id);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (activeId) {
      void loadDetail(activeId);
    } else {
      setDetail(null);
    }
  }, [activeId]);

  const selectedNode = useMemo(
    () => detail?.nodes.find(n => n.id === selectedNodeId) ?? null,
    [detail?.nodes, selectedNodeId],
  );

  useEffect(() => {
    if (!selectedNode) {
      return;
    }
    setEditTitle(selectedNode.title);
    setEditCapId(selectedNode.capabilityId);
    setEditExecKind(selectedNode.executorKind);
    setEditRationale(selectedNode.planningRationale);
    setEditInputContract(selectedNode.inputContract);
    setEditOutputContract(selectedNode.outputContract);
    setEditReqRefs(selectedNode.requirementRefs.join(', '));
    setEditFileScope(selectedNode.fileScope.join(', '));
    setEditGateCmd(selectedNode.gateCommand ?? '');
  }, [selectedNode]);

  const handleImportPrd = async (): Promise<void> => {
    const ws = workspaces[0];
    if (!ws || !importMd.trim()) {
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      const created = await orchApi.importRequirements({
        workspaceId: ws.id,
        markdown: importMd,
        permissionTier: importTier,
        verifyCommand: importVerifyCmd.trim() || undefined,
      });
      setShowImport(false);
      await onRefreshBootstrap();
      onSelectWorkflow(created.workflow.id);
      setDetail(created);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmAssumption = async (asmId: string): Promise<void> => {
    if (!detail) {
      return;
    }
    setBusy(true);
    try {
      const updated = await orchApi.updateGoalSpec(detail.workflow.id, {
        assumptions: detail.goalSpec.assumptions.map(a =>
          a.id === asmId ? {...a, source: 'user_confirmed'} : a,
        ),
      });
      setDetail(updated);
      await onRefreshBootstrap();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveNodePatch = async (): Promise<void> => {
    if (!detail || !selectedNode) {
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      const updated = await orchApi.updateDraftGraph(detail.workflow.id, {
        nodePatches: [
          {
            id: selectedNode.id,
            title: editTitle.trim() || selectedNode.title,
            capabilityId: editCapId,
            executorKind: editExecKind,
            planningRationale: editRationale.trim(),
            inputContract: editInputContract.trim(),
            outputContract: editOutputContract.trim(),
            requirementRefs: editReqRefs
              .split(',')
              .map(s => s.trim())
              .filter(Boolean),
            fileScope: editFileScope
              .split(',')
              .map(s => s.trim())
              .filter(Boolean),
            gateCommand: editGateCmd.trim() || null,
          },
        ],
      });
      setDetail(updated);
      await onRefreshBootstrap();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleAddDraftNode = async (): Promise<void> => {
    if (!detail || !newTaskTitle.trim()) {
      return;
    }
    setBusy(true);
    try {
      const updated = await orchApi.updateDraftGraph(detail.workflow.id, {
        addNodes: [
          {
            code: newTaskCode.trim() || 'P2.T_CUSTOM',
            title: newTaskTitle.trim(),
            description: 'Manually added draft node from Design Studio.',
            planningRationale: 'Operator manual addition for domain coverage.',
            kind: 'task',
            executorKind: 'agent',
            capabilityId: 'native-api',
            requirementRefs: detail.goalSpec.requirements
              .slice(0, 1)
              .map(r => r.code),
            afterNodeId: selectedNode?.id ?? null,
          },
        ],
      });
      setNewTaskTitle('');
      setDetail(updated);
      await onRefreshBootstrap();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleReplan = async (): Promise<void> => {
    if (!detail) {
      return;
    }
    setBusy(true);
    try {
      const updated = await orchApi.replanWorkflow(detail.workflow.id);
      setDetail(updated);
      await onRefreshBootstrap();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleTrial = async (): Promise<void> => {
    if (!detail) {
      return;
    }
    setBusy(true);
    try {
      const updated = await orchApi.runTrial(detail.workflow.id);
      setDetail(updated);
      setSubTab('validate');
      await onRefreshBootstrap();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleLockAndOrStart = async (andStart: boolean): Promise<void> => {
    if (!detail) {
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      let versionId = detail.versions[0]?.id;
      if (detail.workflow.status !== 'locked' || !versionId) {
        const res = await orchApi.confirmVersion(detail.workflow.id, {});
        setDetail(res.workflow);
        versionId = res.version.id;
      }
      if (andStart) {
        const runSnap = await orchApi.startRun({
          workflowId: detail.workflow.id,
          versionId,
        });
        await onRefreshBootstrap();
        onStartedRun(runSnap.run.id);
      } else {
        await onRefreshBootstrap();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column'}}
    >
      {/* Top Design Studio Bar */}
      <div
        style={{
          padding: '10px 18px',
          background: '#ffffff',
          borderBottom: '1px solid var(--border-hairline)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
          <select
            style={{width: 280}}
            value={activeId ?? ''}
            onChange={e => onSelectWorkflow(e.target.value)}
          >
            {workflows.map(wf => (
              <option key={wf.id} value={wf.id}>
                {wf.code} · {wf.title}
              </option>
            ))}
          </select>
          {detail && (
            <>
              <span
                className={`tag ${
                  detail.validation.valid ? 'tag-green' : 'tag-red'
                }`}
              >
                {formatWorkflowStatus(lang, detail.workflow.status)}
              </span>
              <span className="tag">
                {detail.goalSpec.requirements.length} FR ·{' '}
                {detail.goalSpec.acceptanceCriteria.length} AC
              </span>
              {detail.validation.errorCount > 0 && (
                <span className="tag tag-red">
                  <AlertIcon size={12} /> {detail.validation.errorCount}{' '}
                  {tr(lang, '阻断错误', 'Blocking Errors')}
                </span>
              )}
            </>
          )}
        </div>

        <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
          <button
            type="button"
            className="btn"
            onClick={() => setShowImport(true)}
          >
            <PlusIcon size={14} />{' '}
            {tr(lang, '导入需求文档 (PRD)', 'Import Requirements')}
          </button>
          <button
            type="button"
            className="btn btn-soft"
            disabled={!detail || busy}
            onClick={() => void handleTrial()}
          >
            {tr(lang, '隔离试运行 (Dry-Run)', 'Trial Run')}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!detail || busy || !detail.validation.valid}
            onClick={() => void handleLockAndOrStart(false)}
          >
            <LockIcon size={13} /> {tr(lang, '锁定不可变版本', 'Lock Version')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!detail || busy || !detail.validation.valid}
            onClick={() => void handleLockAndOrStart(true)}
          >
            <PlayIcon size={13} />{' '}
            {tr(lang, '发布并实时执行', 'Lock & Launch Run')}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="error-banner">
          <span>{errorMsg}</span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setErrorMsg(null)}
          >
            ×
          </button>
        </div>
      )}

      {/* Design Tabs */}
      <div
        className="underline-tabs"
        style={{padding: '0 20px', background: '#ffffff'}}
      >
        <button
          type="button"
          className={`underline-tab ${subTab === 'spec' ? 'active' : ''}`}
          onClick={() => setSubTab('spec')}
        >
          {tr(lang, '1. GoalSpec 与需求追踪', '1. GoalSpec & Traceability')}
        </button>
        <button
          type="button"
          className={`underline-tab ${subTab === 'graph' ? 'active' : ''}`}
          onClick={() => setSubTab('graph')}
        >
          {tr(
            lang,
            '2. WBS 任务拆解与双态编排图 (Twin-Graph)',
            '2. WBS & Dual-Mode Twin-Graph',
          )}
        </button>
        <button
          type="button"
          className={`underline-tab ${subTab === 'validate' ? 'active' : ''}`}
          onClick={() => setSubTab('validate')}
        >
          {tr(
            lang,
            `3. 三级校验与试运行报告 (${detail?.validation.issues.length ?? 0})`,
            `3. Validation & Trial Report (${detail?.validation.issues.length ?? 0})`,
          )}
        </button>
      </div>

      {!detail ? (
        <div className="page-scroll">
          <div className="card">
            {tr(
              lang,
              '请点击上方“导入需求文档”开始编排。',
              'Import a Requirements Markdown document to begin.',
            )}
          </div>
        </div>
      ) : subTab === 'spec' ? (
        <div className="page-scroll">
          <div
            style={{display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16}}
          >
            <div className="card">
              <h3 style={{marginTop: 0}}>{detail.goalSpec.title}</h3>
              <p style={{color: 'var(--text-secondary)'}}>
                <strong>{tr(lang, '目标:', 'Goal:')}</strong>{' '}
                {detail.goalSpec.goal}
              </p>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                  marginTop: 12,
                }}
              >
                <div>
                  <div style={{fontWeight: 700, marginBottom: 4}}>
                    {tr(lang, '输入契约 (Inputs)', 'Inputs')}
                  </div>
                  <ul style={{margin: 0, paddingLeft: 18}}>
                    {detail.goalSpec.inputs.map((inp, i) => (
                      <li key={i}>{inp}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div style={{fontWeight: 700, marginBottom: 4}}>
                    {tr(lang, '交付产物 (Outputs)', 'Outputs')}
                  </div>
                  <ul style={{margin: 0, paddingLeft: 18}}>
                    {detail.goalSpec.outputs.map((out, i) => (
                      <li key={i}>{out}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div style={{marginTop: 14}}>
                <div style={{fontWeight: 700, marginBottom: 6}}>
                  {tr(
                    lang,
                    '功能需求条目 (FR) 与节点映射',
                    'Functional Requirements (FR)',
                  )}
                </div>
                {detail.goalSpec.requirements.map(r => {
                  const mapped = detail.nodes
                    .filter(
                      n =>
                        n.kind !== 'phase_container' &&
                        n.requirementRefs.includes(r.code),
                    )
                    .map(n => n.code);
                  return (
                    <div
                      key={r.id}
                      style={{
                        padding: '8px 10px',
                        border: '1px solid var(--border-card)',
                        borderRadius: 6,
                        marginBottom: 6,
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <div>
                        <span className="mono tag tag-indigo">{r.code}</span>{' '}
                        <strong>{r.title}</strong>
                        <div
                          style={{
                            color: 'var(--text-muted)',
                            fontSize: 12,
                            marginTop: 2,
                          }}
                        >
                          {r.description}
                        </div>
                      </div>
                      <div style={{textAlign: 'right'}}>
                        <span
                          className={`tag ${
                            mapped.length > 0 ? 'tag-green' : 'tag-red'
                          }`}
                        >
                          {mapped.length > 0
                            ? `${tr(lang, '映射', 'Mapped')}: ${mapped.join(', ')}`
                            : tr(lang, '未覆盖!', 'Unmapped!')}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
              <div className="card">
                <div style={{fontWeight: 700, marginBottom: 8}}>
                  {tr(
                    lang,
                    '系统识别假设与人工确认 (doc / suggested)',
                    'Assumptions & Confirmations',
                  )}
                </div>
                {detail.goalSpec.assumptions.map(a => (
                  <div
                    key={a.id}
                    style={{
                      padding: '8px 10px',
                      border: '1px solid var(--border-card)',
                      borderRadius: 6,
                      marginBottom: 6,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 6,
                      }}
                    >
                      <span
                        className={`tag ${
                          a.source === 'suggested'
                            ? 'tag-amber'
                            : a.source === 'user_confirmed'
                              ? 'tag-green'
                              : 'tag-indigo'
                        }`}
                      >
                        {a.source}
                      </span>
                      {a.source === 'suggested' && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={busy}
                          onClick={() => void handleConfirmAssumption(a.id)}
                        >
                          {tr(lang, '确认此假设', 'Confirm Assumption')}
                        </button>
                      )}
                    </div>
                    <div style={{marginTop: 4, fontWeight: 500}}>{a.text}</div>
                    <div style={{fontSize: 11.5, color: 'var(--text-muted)'}}>
                      {a.rationale}
                    </div>
                  </div>
                ))}
              </div>

              <div className="card">
                <div style={{fontWeight: 700, marginBottom: 8}}>
                  {tr(
                    lang,
                    '原始需求文档 Markdown',
                    'Raw Requirements Markdown',
                  )}
                </div>
                <pre
                  className="mono"
                  style={{
                    margin: 0,
                    fontSize: 11.5,
                    whiteSpace: 'pre-wrap',
                    background: 'var(--bg-page)',
                    padding: 10,
                    borderRadius: 6,
                    maxHeight: 280,
                    overflowY: 'auto',
                  }}
                >
                  {detail.goalSpec.rawMarkdown}
                </pre>
              </div>
            </div>
          </div>
        </div>
      ) : subTab === 'graph' ? (
        <div className="split-workbench">
          <div className="canvas-pane">
            {detail.lastImpact && (
              <div
                style={{
                  padding: '6px 14px',
                  background: '#fffbeb',
                  borderBottom: '1px solid #fde68a',
                  fontSize: 12,
                  color: '#92400e',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>
                  <strong>{tr(lang, '变更影响分析:', 'Change Impact:')}</strong>{' '}
                  {detail.lastImpact.summary}
                </span>
                {detail.lastImpact.affectedDownstreamCodes.length > 0 && (
                  <span className="mono">
                    Downstream:{' '}
                    {detail.lastImpact.affectedDownstreamCodes.join(', ')}
                  </span>
                )}
              </div>
            )}
            <TwinGraphCanvas
              nodes={detail.nodes}
              edges={detail.edges}
              selectedNodeId={selectedNodeId}
              impactedCodes={detail.lastImpact?.affectedDownstreamCodes}
              mode="design"
              lang={lang}
              onSelectNode={setSelectedNodeId}
            />
          </div>

          <div className="inspector-pane">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <strong style={{fontSize: 13.5}}>
                {tr(lang, '双态节点配置器', 'Draft Node Editor')}
              </strong>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={() => void handleReplan()}
              >
                {tr(lang, '由 Spec 重生成', 'Recompile Graph')}
              </button>
            </div>

            {selectedNode && selectedNode.kind !== 'phase_container' ? (
              <div style={{display: 'flex', flexDirection: 'column', gap: 9}}>
                <div>
                  <span className="mono tag tag-indigo">
                    {selectedNode.code}
                  </span>{' '}
                  <span className="tag">{selectedNode.kind}</span>
                </div>
                <label>
                  <span style={{fontSize: 11, color: 'var(--text-muted)'}}>
                    {tr(lang, '节点名称', 'Title')}
                  </span>
                  <input
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                  />
                </label>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 8,
                  }}
                >
                  <label>
                    <span style={{fontSize: 11, color: 'var(--text-muted)'}}>
                      {tr(lang, '执行者类型', 'Executor Kind')}
                    </span>
                    <select
                      value={editExecKind}
                      onChange={e =>
                        setEditExecKind(e.target.value as ExecutorKind)
                      }
                    >
                      <option value="agent">agent</option>
                      <option value="tool">tool</option>
                      <option value="human">human</option>
                      <option value="control">control</option>
                    </select>
                  </label>
                  <label>
                    <span style={{fontSize: 11, color: 'var(--text-muted)'}}>
                      {tr(lang, '绑定能力 (Capability)', 'Capability')}
                    </span>
                    <select
                      value={editCapId}
                      onChange={e => setEditCapId(e.target.value)}
                    >
                      {capabilities.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.id} {!c.enabled ? '(disabled)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  <span style={{fontSize: 11, color: 'var(--text-muted)'}}>
                    {tr(
                      lang,
                      '规划依据 (Planning Rationale)',
                      'Planning Rationale',
                    )}
                  </span>
                  <textarea
                    rows={2}
                    value={editRationale}
                    onChange={e => setEditRationale(e.target.value)}
                  />
                </label>
                <label>
                  <span style={{fontSize: 11, color: 'var(--text-muted)'}}>
                    {tr(
                      lang,
                      '映射需求编号 (逗号分隔)',
                      'Requirement Refs (comma-separated)',
                    )}
                  </span>
                  <input
                    value={editReqRefs}
                    onChange={e => setEditReqRefs(e.target.value)}
                  />
                </label>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 8,
                  }}
                >
                  <label>
                    <span style={{fontSize: 11, color: 'var(--text-muted)'}}>
                      Input Contract
                    </span>
                    <input
                      value={editInputContract}
                      onChange={e => setEditInputContract(e.target.value)}
                    />
                  </label>
                  <label>
                    <span style={{fontSize: 11, color: 'var(--text-muted)'}}>
                      Output Contract
                    </span>
                    <input
                      value={editOutputContract}
                      onChange={e => setEditOutputContract(e.target.value)}
                    />
                  </label>
                </div>
                <label>
                  <span style={{fontSize: 11, color: 'var(--text-muted)'}}>
                    File Scope (并行写冲突检测)
                  </span>
                  <input
                    value={editFileScope}
                    onChange={e => setEditFileScope(e.target.value)}
                  />
                </label>
                <label>
                  <span style={{fontSize: 11, color: 'var(--text-muted)'}}>
                    Gate / Tool Command (optional)
                  </span>
                  <input
                    className="mono"
                    value={editGateCmd}
                    onChange={e => setEditGateCmd(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void handleSaveNodePatch()}
                >
                  {tr(
                    lang,
                    '保存节点修改并分析影响',
                    'Save & Run Impact Check',
                  )}
                </button>
              </div>
            ) : (
              <div style={{color: 'var(--text-muted)'}}>
                {tr(
                  lang,
                  '点击画布中任意任务或检查点节点以查看或修改属性。',
                  'Select a node on the canvas to inspect or edit.',
                )}
              </div>
            )}

            <hr
              style={{
                border: 'none',
                borderTop: '1px solid var(--border-hairline)',
                width: '100%',
              }}
            />
            <div>
              <strong style={{fontSize: 12.5}}>
                {tr(lang, '人工新增子任务节点', 'Add Draft Task Node')}
              </strong>
              <div style={{display: 'flex', gap: 6, marginTop: 6}}>
                <input
                  style={{width: 96}}
                  value={newTaskCode}
                  onChange={e => setNewTaskCode(e.target.value)}
                  placeholder="P2.T_ADD"
                />
                <input
                  value={newTaskTitle}
                  onChange={e => setNewTaskTitle(e.target.value)}
                  placeholder={tr(lang, '新任务名称...', 'New task title...')}
                />
                <button
                  type="button"
                  className="btn btn-soft"
                  disabled={busy || !newTaskTitle.trim()}
                  onClick={() => void handleAddDraftNode()}
                >
                  {tr(lang, '添加', 'Add')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="page-scroll">
          <div
            style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16}}
          >
            <div className="card">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 10,
                }}
              >
                <strong style={{fontSize: 14}}>
                  <ShieldCheckIcon size={15} />{' '}
                  {tr(
                    lang,
                    '三级一致性与结构校验诊断',
                    '3-Level Validation Diagnostics',
                  )}
                </strong>
                <span
                  className={`tag ${detail.validation.valid ? 'tag-green' : 'tag-red'}`}
                >
                  E:{detail.validation.errorCount} / W:
                  {detail.validation.warningCount} / I:
                  {detail.validation.infoCount}
                </span>
              </div>
              {detail.validation.issues.length === 0 ? (
                <div className="tag tag-green">
                  {tr(
                    lang,
                    '所有结构、需求映射与能力约束检查全部通过。',
                    'Zero validation issues found.',
                  )}
                </div>
              ) : (
                detail.validation.issues.map(iss => (
                  <div
                    key={iss.id}
                    style={{
                      padding: '8px 10px',
                      border: '1px solid var(--border-card)',
                      borderRadius: 6,
                      marginBottom: 8,
                    }}
                  >
                    <div
                      style={{display: 'flex', gap: 6, alignItems: 'center'}}
                    >
                      <span
                        className={`tag ${
                          iss.level === 'error'
                            ? 'tag-red'
                            : iss.level === 'warning'
                              ? 'tag-amber'
                              : 'tag-indigo'
                        }`}
                      >
                        {iss.level.toUpperCase()} · {iss.category}
                      </span>
                      {iss.nodeCode && (
                        <span className="mono tag">{iss.nodeCode}</span>
                      )}
                      {iss.requirementCode && (
                        <span className="mono tag">{iss.requirementCode}</span>
                      )}
                    </div>
                    <div style={{marginTop: 4, fontWeight: 500}}>
                      {iss.message}
                    </div>
                    <div style={{fontSize: 11.5, color: 'var(--text-muted)'}}>
                      {tr(lang, '修复建议:', 'Suggestion:')} {iss.suggestion}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="card">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 10,
                }}
              >
                <strong style={{fontSize: 14}}>
                  {tr(
                    lang,
                    '隔离试运行 (Dry-Run) 仿真链路',
                    'Isolated Trial Simulation Report',
                  )}
                </strong>
                <button
                  type="button"
                  className="btn btn-sm btn-soft"
                  disabled={busy}
                  onClick={() => void handleTrial()}
                >
                  {tr(lang, '重新试运行', 'Re-Run Trial')}
                </button>
              </div>
              {!detail.latestTrial ? (
                <div style={{color: 'var(--text-muted)'}}>
                  {tr(
                    lang,
                    '尚未执行试运行；点击“隔离试运行”在不改动工作区的前提下检验条件分支与契约流转。',
                    'No trial run yet. Run isolated simulation before locking version.',
                  )}
                </div>
              ) : (
                <div>
                  <div style={{display: 'flex', gap: 8, marginBottom: 10}}>
                    <span
                      className={`tag ${
                        detail.latestTrial.passed ? 'tag-green' : 'tag-red'
                      }`}
                    >
                      {detail.latestTrial.passed
                        ? 'TRIAL PASSED'
                        : 'TRIAL BLOCKED'}
                    </span>
                    <span className="tag">
                      Active: {detail.latestTrial.simulatedPath.length} ·
                      Skipped: {detail.latestTrial.skippedNodes.length}
                    </span>
                  </div>
                  {detail.latestTrial.steps.map((s, idx) => (
                    <div
                      key={`${s.nodeCode}-${idx}`}
                      style={{
                        padding: '6px 9px',
                        borderBottom: '1px solid var(--border-hairline)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                        fontSize: 12,
                      }}
                    >
                      <div>
                        <span className="mono" style={{fontWeight: 700}}>
                          {s.nodeCode}
                        </span>{' '}
                        {s.title}
                        <div style={{color: 'var(--text-muted)', fontSize: 11}}>
                          {s.note}
                        </div>
                      </div>
                      <span
                        className={`tag ${
                          s.simulatedStatus === 'skipped'
                            ? ''
                            : s.simulatedStatus === 'waiting_human'
                              ? 'tag-amber'
                              : 'tag-green'
                        }`}
                      >
                        {s.simulatedStatus}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Import PRD Modal */}
      {showImport && (
        <div className="modal-backdrop" onClick={() => setShowImport(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 style={{marginTop: 0}}>
              {tr(
                lang,
                '从需求文档启动 Workflow 编排',
                'Import Confirmed Requirements Document',
              )}
            </h3>
            <p style={{color: 'var(--text-muted)', marginTop: 4}}>
              {tr(
                lang,
                '解析 Markdown 需求文档生成 GoalSpec、任务拆解与可执行的并行/条件 Twin-Graph。',
                'Parses Markdown requirements into structured GoalSpec and executable Twin-Graph.',
              )}
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 10,
                marginBottom: 10,
              }}
            >
              <label>
                <span style={{fontSize: 11.5, fontWeight: 600}}>
                  {tr(lang, '权限治理等级', 'Permission Tier')}
                </span>
                <select
                  value={importTier}
                  onChange={e =>
                    setImportTier(e.target.value as PermissionTier)
                  }
                >
                  <option value="supervised">supervised</option>
                  <option value="strict">strict (with human gate)</option>
                  <option value="turbo">turbo</option>
                </select>
              </label>
              <label>
                <span style={{fontSize: 11.5, fontWeight: 600}}>
                  {tr(lang, '确定性验证命令', 'Verification Gate Command')}
                </span>
                <input
                  className="mono"
                  value={importVerifyCmd}
                  onChange={e => setImportVerifyCmd(e.target.value)}
                />
              </label>
            </div>
            <textarea
              className="mono"
              rows={13}
              value={importMd}
              onChange={e => setImportMd(e.target.value)}
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                marginTop: 12,
              }}
            >
              <button
                type="button"
                className="btn"
                onClick={() => setShowImport(false)}
              >
                {tr(lang, '取消', 'Cancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !importMd.trim()}
                onClick={() => void handleImportPrd()}
              >
                {tr(lang, '解析并生成编排草图', 'Parse & Generate Twin-Graph')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
