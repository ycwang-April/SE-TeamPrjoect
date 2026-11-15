import {type ReactElement, useEffect, useMemo, useState} from 'react';
import type {
  RunDetailSnapshot,
  SessionTranscriptView,
} from '../../../src/shared/api';
import type {WorkflowRunRecord} from '../../../src/shared/types';
import {orchApi} from '../api/client';
import {
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
} from '../components/Icons';
import {TwinGraphCanvas} from '../components/TwinGraphCanvas';
import {
  formatExecutorKind,
  formatNodeStatus,
  formatRunStatus,
  tr,
  type UiLang,
} from '../i18n';

interface WorkstationViewProps {
  readonly lang: UiLang;
  readonly runs: readonly WorkflowRunRecord[];
  readonly selectedRunId: string | null;
  readonly onSelectRun: (runId: string) => void;
  readonly onRefreshBootstrap: () => Promise<void>;
  readonly refreshTick: number;
}

export function WorkstationView(props: WorkstationViewProps): ReactElement {
  const {
    lang,
    runs,
    selectedRunId,
    onSelectRun,
    onRefreshBootstrap,
    refreshTick,
  } = props;

  const activeRunId = selectedRunId ?? runs[0]?.id ?? null;
  const [detail, setDetail] = useState<RunDetailSnapshot | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'graph' | 'wbs'>('graph');
  const [transcript, setTranscript] = useState<SessionTranscriptView | null>(
    null,
  );
  const [showGhostModal, setShowGhostModal] = useState(false);
  const [ghostTitle, setGhostTitle] = useState('');
  const [ghostDesc, setGhostDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadRun = async (id: string): Promise<void> => {
    try {
      const snap = await orchApi.getRunDetail(id);
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
    if (activeRunId) {
      void loadRun(activeRunId);
    } else {
      setDetail(null);
    }
  }, [activeRunId, refreshTick]);

  const selectedNode = useMemo(
    () => detail?.nodes.find(n => n.id === selectedNodeId) ?? null,
    [detail?.nodes, selectedNodeId],
  );

  const nodeAttempts = useMemo(
    () => detail?.attempts.filter(a => a.nodeId === selectedNode?.id) ?? [],
    [detail?.attempts, selectedNode?.id],
  );

  useEffect(() => {
    const latestSessionId = nodeAttempts.find(a => a.sessionId)?.sessionId;
    if (!latestSessionId) {
      setTranscript(null);
      return;
    }
    void orchApi
      .getSessionTranscript(latestSessionId)
      .then(setTranscript)
      .catch(() => setTranscript(null));
  }, [nodeAttempts]);

  const openInterventions = useMemo(
    () => detail?.interventions.filter(i => i.status === 'open') ?? [],
    [detail?.interventions],
  );

  const execAction = async (
    fn: () => Promise<RunDetailSnapshot>,
  ): Promise<void> => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const updated = await fn();
      setDetail(updated);
      await onRefreshBootstrap();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleToggleCollapse = async (
    nodeId: string,
    collapsed: boolean,
  ): Promise<void> => {
    await orchApi.setNodeCollapsed(nodeId, collapsed);
    if (activeRunId) {
      await loadRun(activeRunId);
    }
  };

  const handleGhostSubmit = async (): Promise<void> => {
    if (!detail || !ghostTitle.trim()) {
      return;
    }
    await execAction(() =>
      orchApi.proposeGhostNode(detail.run.id, {
        title: ghostTitle.trim(),
        description: ghostDesc.trim() || 'Runtime amendment task.',
        insertBeforeNodeId:
          selectedNode?.kind === 'phase_container' ? null : selectedNode?.id,
      }),
    );
    setGhostTitle('');
    setGhostDesc('');
    setShowGhostModal(false);
  };

  if (!detail) {
    return (
      <div className="page-scroll">
        <div className="card">
          {tr(
            lang,
            '暂无运行实例。请先在“编排设计台”校验、锁定版本并点击“发布并实时执行”。',
            'No runs yet. Validate & lock a workflow version in Design Studio first.',
          )}
        </div>
      </div>
    );
  }

  const run = detail.run;

  return (
    <div
      style={{flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column'}}
    >
      {/* Top Run Control Bar */}
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
            style={{width: 250}}
            value={run.id}
            onChange={e => onSelectRun(e.target.value)}
          >
            {runs.map(r => (
              <option key={r.id} value={r.id}>
                {r.title} ({r.status})
              </option>
            ))}
          </select>
          <span
            className={`tag ${
              run.status === 'succeeded'
                ? 'tag-green'
                : run.status === 'failed'
                  ? 'tag-red'
                  : run.status === 'waiting_human'
                    ? 'tag-amber'
                    : 'tag-indigo'
            }`}
          >
            {formatRunStatus(lang, run.status)}
          </span>
          <span className="mono tag">
            {run.versionTag} · {run.completedNodes}/{run.totalNodes}{' '}
            {run.skippedNodes > 0 ? `(skipped ${run.skippedNodes})` : ''}
          </span>
          <span className="mono tag" title={run.worktreePath}>
            {run.gitBranch}
          </span>
          <span
            className="mono tag"
            title={tr(
              lang,
              'Token 与成本预算遥测',
              'Token & Cost Budget Telemetry',
            )}
          >
            ${(run.spentUsd ?? 0).toFixed(4)} / $
            {(run.budgetUsdLimit ?? 2.5).toFixed(2)} ·{' '}
            {(
              (run.inputTokens ?? 0) + (run.outputTokens ?? 0)
            ).toLocaleString()}{' '}
            tok
          </span>
        </div>

        <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
          <div className="nav-pills" style={{marginLeft: 0}}>
            <button
              type="button"
              className={`nav-pill ${viewMode === 'graph' ? 'active' : ''}`}
              onClick={() => setViewMode('graph')}
            >
              {tr(lang, '流图视图', 'Flow DAG')}
            </button>
            <button
              type="button"
              className={`nav-pill ${viewMode === 'wbs' ? 'active' : ''}`}
              onClick={() => setViewMode('wbs')}
            >
              {tr(lang, 'WBS 任务表', 'WBS Task Table')}
            </button>
          </div>
          {run.status === 'running' ? (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void execAction(() => orchApi.pauseRun(run.id))}
            >
              <PauseIcon size={13} /> {tr(lang, '暂停', 'Pause')}
            </button>
          ) : run.status === 'paused' ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void execAction(() => orchApi.resumeRun(run.id))}
            >
              <PlayIcon size={13} /> {tr(lang, '继续', 'Resume')}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-soft"
            disabled={busy}
            onClick={() => setShowGhostModal(true)}
          >
            <PlusIcon size={13} />{' '}
            {tr(lang, '插入 GhostNode', 'Inject GhostNode')}
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

      {/* Ebbinghaus Cognitive Re-hydration Capsule Strip */}
      {detail.rehydrationCapsule && (
        <div
          style={{
            padding: '7px 18px',
            background: '#f8fafc',
            borderBottom: '1px solid var(--border-hairline)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            fontSize: 12,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <span
              className={`tag ${
                detail.rehydrationCapsule.tier === 'warm'
                  ? 'tag-green'
                  : detail.rehydrationCapsule.tier === 'delta_30s'
                    ? 'tag-indigo'
                    : 'tag-amber'
              }`}
            >
              {detail.rehydrationCapsule.tier} ·{' '}
              {Math.round(detail.rehydrationCapsule.retentionScore * 100)}%
            </span>
            <span className="mono" style={{color: 'var(--text-muted)'}}>
              {detail.rehydrationCapsule.elapsedHours.toFixed(1)}h · entropy{' '}
              {detail.rehydrationCapsule.mutationEntropy.toFixed(2)}
            </span>
            <span style={{color: 'var(--text-secondary)'}}>
              {detail.rehydrationCapsule.autonomousDeltaBullets[0] ??
                detail.rehydrationCapsule.northStarGoal}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-soft"
            disabled={busy}
            onClick={() =>
              void execAction(async () => {
                await orchApi.markWorkflowReviewed(detail.run.workflowId);
                return orchApi.getRunDetail(detail.run.id);
              })
            }
          >
            {tr(lang, '标记人工已复核重锚', 'Mark Human Re-Anchored')}
          </button>
        </div>
      )}

      {/* Open Human Interventions Strip */}
      {openInterventions.length > 0 && (
        <div
          style={{
            padding: '10px 18px',
            background: '#fffbeb',
            borderBottom: '1px solid #fde68a',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {openInterventions.map(item => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div>
                <strong style={{color: '#92400e'}}>{item.question}</strong>
                <div style={{fontSize: 12, color: '#78350f'}}>
                  {item.contextSnippet}
                </div>
              </div>
              <div style={{display: 'flex', gap: 6, flexShrink: 0}}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy}
                  onClick={() =>
                    void execAction(() =>
                      orchApi.resolveIntervention(item.id, {
                        action: 'approve',
                        resolution: 'Approved by operator.',
                      }),
                    )
                  }
                >
                  {tr(lang, '批准通过', 'Approve')}
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={() =>
                    void execAction(() =>
                      orchApi.resolveIntervention(item.id, {
                        action: 'override',
                        resolution: 'Waived by operator.',
                      }),
                    )
                  }
                >
                  {tr(lang, '豁免', 'Waive')}
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={busy}
                  onClick={() =>
                    void execAction(() =>
                      orchApi.resolveIntervention(item.id, {
                        action: 'reject',
                        resolution: 'Rejected by operator.',
                      }),
                    )
                  }
                >
                  {tr(lang, '拒绝终止', 'Reject')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Synchronized Split Cockpit */}
      <div className="split-workbench">
        <div className="canvas-pane">
          {viewMode === 'graph' ? (
            <TwinGraphCanvas
              nodes={detail.nodes}
              edges={detail.edges}
              selectedNodeId={selectedNodeId}
              mode="run"
              lang={lang}
              onSelectNode={setSelectedNodeId}
              onToggleCollapse={(id, col) => void handleToggleCollapse(id, col)}
            />
          ) : (
            <div className="page-scroll">
              <div className="card">
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: 12.5,
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        textAlign: 'left',
                        borderBottom: '1px solid var(--border-hairline)',
                      }}
                    >
                      <th style={{padding: '7px 6px'}}>Code</th>
                      <th style={{padding: '7px 6px'}}>Phase / Task</th>
                      <th style={{padding: '7px 6px'}}>Executor</th>
                      <th style={{padding: '7px 6px'}}>FR Refs</th>
                      <th style={{padding: '7px 6px'}}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.nodes
                      .filter(n => n.kind !== 'phase_container')
                      .map(n => (
                        <tr
                          key={n.id}
                          onClick={() => setSelectedNodeId(n.id)}
                          style={{
                            cursor: 'pointer',
                            borderBottom: '1px solid var(--border-hairline)',
                            background:
                              n.id === selectedNodeId
                                ? 'var(--accent-soft)'
                                : 'transparent',
                          }}
                        >
                          <td
                            className="mono"
                            style={{padding: '7px 6px', fontWeight: 700}}
                          >
                            {n.code}
                          </td>
                          <td style={{padding: '7px 6px'}}>
                            <div style={{fontWeight: 600}}>{n.title}</div>
                            <div
                              style={{fontSize: 11, color: 'var(--text-muted)'}}
                            >
                              {n.phaseTitle}
                            </div>
                          </td>
                          <td style={{padding: '7px 6px'}}>
                            {formatExecutorKind(lang, n.executorKind)} ·{' '}
                            <span className="mono">{n.capabilityId}</span>
                          </td>
                          <td className="mono" style={{padding: '7px 6px'}}>
                            {n.requirementRefs.join(', ') || '—'}
                          </td>
                          <td style={{padding: '7px 6px'}}>
                            <span className="tag">
                              {formatNodeStatus(lang, n.status)}
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right Live Node Inspector + Attempts + Checkpoints */}
        <div className="inspector-pane">
          {selectedNode ? (
            <>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <span className="mono tag tag-indigo">
                    {selectedNode.code}
                  </span>{' '}
                  <span className="tag">
                    {formatNodeStatus(lang, selectedNode.status)}
                  </span>
                </div>
                {(selectedNode.status === 'failed' ||
                  selectedNode.status === 'waiting_human') && (
                  <button
                    type="button"
                    className="btn btn-sm btn-soft"
                    disabled={busy}
                    onClick={() =>
                      void execAction(() =>
                        orchApi.retryNode(run.id, selectedNode.id),
                      )
                    }
                  >
                    <RotateCcwIcon size={12} />{' '}
                    {tr(lang, '重试节点', 'Retry Node')}
                  </button>
                )}
              </div>

              <div>
                <h4 style={{margin: '0 0 4px'}}>{selectedNode.title}</h4>
                <div style={{fontSize: 12, color: 'var(--text-secondary)'}}>
                  {selectedNode.description}
                </div>
              </div>

              <div
                className="card"
                style={{padding: 10, background: 'var(--bg-page)'}}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--text-muted)',
                  }}
                >
                  {tr(
                    lang,
                    '规划依据 & 契约',
                    'Planning Rationale & Contracts',
                  )}
                </div>
                <div style={{fontSize: 12, marginTop: 4}}>
                  {selectedNode.planningRationale}
                </div>
                <div
                  className="mono"
                  style={{
                    fontSize: 11,
                    marginTop: 6,
                    color: 'var(--text-muted)',
                  }}
                >
                  In: {selectedNode.inputContract || '—'}
                  <br />
                  Out: {selectedNode.outputContract || '—'}
                </div>
              </div>

              {selectedNode.outputSummary && (
                <div>
                  <strong style={{fontSize: 11.5}}>
                    {tr(lang, '最新执行输出', 'Latest Output')}
                  </strong>
                  <pre
                    className="mono"
                    style={{
                      margin: '4px 0 0',
                      fontSize: 11,
                      whiteSpace: 'pre-wrap',
                      background: 'var(--bg-page)',
                      padding: 8,
                      borderRadius: 6,
                      maxHeight: 140,
                      overflowY: 'auto',
                    }}
                  >
                    {selectedNode.outputSummary}
                  </pre>
                </div>
              )}

              <div>
                <strong style={{fontSize: 11.5}}>
                  {tr(lang, '尝试记录 (Node Attempts)', 'Attempt History')}
                </strong>
                {nodeAttempts.length === 0 ? (
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      marginTop: 4,
                    }}
                  >
                    {tr(
                      lang,
                      '尚未产生执行尝试。',
                      'No attempts recorded yet.',
                    )}
                  </div>
                ) : (
                  nodeAttempts.map(a => (
                    <div
                      key={a.id}
                      style={{
                        padding: '6px 8px',
                        border: '1px solid var(--border-card)',
                        borderRadius: 6,
                        marginTop: 4,
                        fontSize: 11.5,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span>
                          #{a.attemptNumber} ·{' '}
                          <span className="mono">{a.capabilityId}</span>
                        </span>
                        <span className="tag">
                          {a.status} · {a.durationSec}s
                        </span>
                      </div>
                      {a.errorMessage && (
                        <div style={{color: 'var(--red)', marginTop: 2}}>
                          {a.errorMessage}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {transcript && (
                <div>
                  <strong style={{fontSize: 11.5}}>
                    {tr(
                      lang,
                      '会话追踪 (Session Stream)',
                      'Session Transcript',
                    )}
                  </strong>
                  <div
                    style={{
                      marginTop: 4,
                      maxHeight: 160,
                      overflowY: 'auto',
                      border: '1px solid var(--border-card)',
                      borderRadius: 6,
                      padding: 8,
                      fontSize: 11.5,
                    }}
                  >
                    {transcript.messages.map(m => (
                      <div key={m.id} style={{marginBottom: 6}}>
                        <span className="mono tag">{m.role}</span>{' '}
                        <span style={{whiteSpace: 'pre-wrap'}}>
                          {m.content}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : null}

          <hr
            style={{
              border: 'none',
              borderTop: '1px solid var(--border-hairline)',
              width: '100%',
            }}
          />

          <div>
            <strong style={{fontSize: 12}}>
              {tr(lang, '物理检查点与安全回退', 'Git Checkpoints & Restore')}
            </strong>
            {detail.checkpoints.map(cp => (
              <div
                key={cp.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 6,
                  padding: '6px 8px',
                  border: '1px solid var(--border-card)',
                  borderRadius: 6,
                  marginTop: 5,
                  fontSize: 11.5,
                }}
              >
                <div>
                  <div style={{fontWeight: 600}}>{cp.label}</div>
                  <div
                    className="mono"
                    style={{fontSize: 10.5, color: 'var(--text-muted)'}}
                  >
                    {cp.gitCommitSha.slice(0, 8)}{' '}
                    {cp.rescueRef ? '· rescue saved' : ''}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={() =>
                    void execAction(() => orchApi.manualRestore(run.id, cp.id))
                  }
                >
                  <RotateCcwIcon size={11} /> {tr(lang, '回退', 'Restore')}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showGhostModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowGhostModal(false)}
        >
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 style={{marginTop: 0}}>
              {tr(
                lang,
                '动态插入运行时 GhostNode',
                'Inject Runtime GhostNode Amendment',
              )}
            </h3>
            <p style={{color: 'var(--text-muted)', fontSize: 12}}>
              {tr(
                lang,
                '仅修改当前 Run 实例的运行图，不会篡改已锁定的不可变版本快照。',
                'Splices into active run graph only; frozen version snapshot remains immutable.',
              )}
            </p>
            <label style={{display: 'block', marginBottom: 8}}>
              <span style={{fontSize: 11.5, fontWeight: 600}}>Title</span>
              <input
                value={ghostTitle}
                onChange={e => setGhostTitle(e.target.value)}
                placeholder={tr(
                  lang,
                  '补充回归校验或边界修复...',
                  'Extra verification or hotfix...',
                )}
              />
            </label>
            <label style={{display: 'block', marginBottom: 12}}>
              <span style={{fontSize: 11.5, fontWeight: 600}}>Description</span>
              <textarea
                rows={3}
                value={ghostDesc}
                onChange={e => setGhostDesc(e.target.value)}
              />
            </label>
            <div style={{display: 'flex', justifyContent: 'flex-end', gap: 8}}>
              <button
                type="button"
                className="btn"
                onClick={() => setShowGhostModal(false)}
              >
                {tr(lang, '取消', 'Cancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !ghostTitle.trim()}
                onClick={() => void handleGhostSubmit()}
              >
                {tr(lang, '注入运行图', 'Splice into Run')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
