import {type ReactElement, useEffect, useState} from 'react';
import type {EvidenceSearchHit} from '../../../src/shared/api';
import type {
  AuditLedgerEntry,
  ConstitutionRule,
  RehydrationCapsule,
  WorkflowRunRecord,
  WorkflowVersionSnapshot,
} from '../../../src/shared/types';
import {orchApi} from '../api/client';
import {HistoryIcon, SearchIcon} from '../components/Icons';
import {formatRunStatus, tr, type UiLang} from '../i18n';

interface RunsAuditViewProps {
  readonly lang: UiLang;
  readonly versions: readonly WorkflowVersionSnapshot[];
  readonly runs: readonly WorkflowRunRecord[];
  readonly recentAudit: readonly AuditLedgerEntry[];
  readonly rehydrationCapsules: readonly RehydrationCapsule[];
  readonly constitution: ConstitutionRule;
  readonly onRefresh: () => Promise<void>;
  readonly onOpenRun: (runId: string) => void;
}

export function RunsAuditView(props: RunsAuditViewProps): ReactElement {
  const {
    lang,
    versions,
    runs,
    recentAudit,
    rehydrationCapsules,
    constitution,
    onRefresh,
    onOpenRun,
  } = props;
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<readonly EvidenceSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [constMd, setConstMd] = useState(constitution.markdown);
  const [blockedCmds, setBlockedCmds] = useState(
    constitution.blockedCommands.join('\n'),
  );
  const [savingConst, setSavingConst] = useState(false);
  const [constSavedMsg, setConstSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    setConstMd(constitution.markdown);
    setBlockedCmds(constitution.blockedCommands.join('\n'));
  }, [
    constitution.updatedAt,
    constitution.markdown,
    constitution.blockedCommands,
  ]);

  const handleSaveConstitution = async (): Promise<void> => {
    setSavingConst(true);
    setConstSavedMsg(null);
    try {
      await orchApi.saveConstitution({
        markdown: constMd,
        blockedCommands: blockedCmds
          .split(/\r?\n/)
          .map(s => s.trim())
          .filter(Boolean),
      });
      setConstSavedMsg(
        tr(
          lang,
          '工程宪法与禁用指令已保存并生效。',
          'Constitution & command blocks updated.',
        ),
      );
      await onRefresh();
    } finally {
      setSavingConst(false);
    }
  };

  const handleReanchor = async (workflowId: string): Promise<void> => {
    await orchApi.markWorkflowReviewed(workflowId);
    await onRefresh();
  };

  const handleSearch = async (): Promise<void> => {
    if (!query.trim()) {
      setHits(null);
      return;
    }
    setSearching(true);
    try {
      const res = await orchApi.searchEvidence(query.trim());
      setHits(res.hits);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="page-scroll">
      <div style={{marginBottom: 16}}>
        <h2 style={{margin: 0, display: 'flex', alignItems: 'center', gap: 8}}>
          <HistoryIcon size={18} />{' '}
          {tr(
            lang,
            '版本快照、执行记录与 FTS5 审计证据链',
            'Version Registry, Runs & FTS5 Audit Trail',
          )}
        </h2>
        <div style={{color: 'var(--text-muted)', marginTop: 3}}>
          {tr(
            lang,
            '支持版本不可变快照核查、历史 Run 跳转，以及跨会话日志/审计账本全文检索。',
            'Inspect immutable workflow snapshots, jump into runs, and query FTS5 execution evidence.',
          )}
        </div>
      </div>

      {/* FTS5 Search Bar */}
      <div className="card" style={{marginBottom: 16}}>
        <div style={{display: 'flex', gap: 8}}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                void handleSearch();
              }
            }}
            placeholder={tr(
              lang,
              'FTS5 全文证据检索：输入 FR-01、checkpoint、QA、rescue...',
              'Search FTS5 evidence across audit & transcripts (e.g. FR-01, checkpoint, QA)...',
            )}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={searching}
            onClick={() => void handleSearch()}
          >
            <SearchIcon size={13} /> {tr(lang, '检索证据', 'Search Evidence')}
          </button>
          {hits !== null && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setQuery('');
                setHits(null);
              }}
            >
              {tr(lang, '清除', 'Clear')}
            </button>
          )}
        </div>

        {hits !== null && (
          <div style={{marginTop: 12}}>
            <strong>
              {tr(
                lang,
                `命中 ${hits.length} 条记录`,
                `${hits.length} FTS5 Hit(s)`,
              )}
            </strong>
            {hits.length === 0 ? (
              <div style={{color: 'var(--text-muted)', marginTop: 4}}>
                {tr(lang, '无匹配证据记录。', 'No matching evidence found.')}
              </div>
            ) : (
              hits.map(h => (
                <div
                  key={`${h.source}-${h.id}`}
                  style={{
                    padding: '8px 10px',
                    border: '1px solid var(--border-card)',
                    borderRadius: 6,
                    marginTop: 6,
                  }}
                >
                  <div
                    style={{display: 'flex', justifyContent: 'space-between'}}
                  >
                    <span>
                      <span className="tag tag-indigo">{h.source}</span>{' '}
                      <strong>{h.title}</strong>
                    </span>
                    {h.runId && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => onOpenRun(h.runId!)}
                      >
                        Open {h.runId}
                      </button>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      marginTop: 4,
                    }}
                  >
                    {h.snippet}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16}}>
        {/* Immutable Versions */}
        <div className="card">
          <strong style={{fontSize: 13.5}}>
            {tr(
              lang,
              '不可变版本快照 (Locked Versions)',
              'Immutable Version Snapshots',
            )}
          </strong>
          <div style={{marginTop: 8}}>
            {versions.length === 0 ? (
              <div style={{color: 'var(--text-muted)'}}>
                {tr(lang, '尚未锁定任何版本快照。', 'No locked versions yet.')}
              </div>
            ) : (
              versions.map(v => (
                <div
                  key={v.id}
                  style={{
                    padding: '8px 10px',
                    border: '1px solid var(--border-card)',
                    borderRadius: 6,
                    marginBottom: 6,
                  }}
                >
                  <div
                    style={{display: 'flex', justifyContent: 'space-between'}}
                  >
                    <strong>
                      <span className="mono tag tag-indigo">
                        {v.versionTag}
                      </span>{' '}
                      {v.label}
                    </strong>
                    <span className="tag tag-green">
                      {v.nodes.length} nodes
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: 'var(--text-muted)',
                      marginTop: 3,
                    }}
                  >
                    Frozen by {v.frozenBy} · Trial:{' '}
                    {v.trial
                      ? v.trial.passed
                        ? 'PASSED'
                        : 'BLOCKED'
                      : 'Not run'}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Runs History */}
        <div className="card">
          <strong style={{fontSize: 13.5}}>
            {tr(lang, '编排运行实例 (Runs)', 'Execution Runs')}
          </strong>
          <div style={{marginTop: 8}}>
            {runs.length === 0 ? (
              <div style={{color: 'var(--text-muted)'}}>
                {tr(
                  lang,
                  '尚未启动运行实例。',
                  'No execution runs recorded yet.',
                )}
              </div>
            ) : (
              runs.map(r => (
                <div
                  key={r.id}
                  style={{
                    padding: '8px 10px',
                    border: '1px solid var(--border-card)',
                    borderRadius: 6,
                    marginBottom: 6,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{fontWeight: 600}}>
                      {r.title}{' '}
                      <span className="tag">
                        {formatRunStatus(lang, r.status)}
                      </span>
                    </div>
                    <div
                      className="mono"
                      style={{fontSize: 11, color: 'var(--text-muted)'}}
                    >
                      {r.versionTag} · {r.completedNodes}/{r.totalNodes} done ·
                      rework {r.reworkCount} · ${(r.spentUsd ?? 0).toFixed(4)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-soft"
                    onClick={() => onOpenRun(r.id)}
                  >
                    {tr(lang, '查看运行态', 'Inspect')}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Ebbinghaus Re-hydration & Engineering Constitution */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
          marginTop: 16,
        }}
      >
        <div className="card">
          <strong style={{fontSize: 13.5}}>
            {tr(
              lang,
              '人机认知记忆胶囊 (Ebbinghaus Re-hydration)',
              'Human × Agent Re-hydration Capsules',
            )}
          </strong>
          <div style={{marginTop: 8}}>
            {rehydrationCapsules.length === 0 ? (
              <div style={{color: 'var(--text-muted)'}}>
                {tr(lang, '暂无编排工作流胶囊。', 'No capsules computed yet.')}
              </div>
            ) : (
              rehydrationCapsules.map(c => (
                <div
                  key={c.workflowId}
                  style={{
                    padding: '8px 10px',
                    border: '1px solid var(--border-card)',
                    borderRadius: 6,
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <div>
                      <span className="mono tag tag-indigo">
                        {c.workflowCode}
                      </span>{' '}
                      <span
                        className={`tag ${
                          c.tier === 'warm'
                            ? 'tag-green'
                            : c.tier === 'delta_30s'
                              ? 'tag-indigo'
                              : 'tag-amber'
                        }`}
                      >
                        {c.tier} · {Math.round(c.retentionScore * 100)}%
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-soft"
                      onClick={() => void handleReanchor(c.workflowId)}
                    >
                      {tr(lang, '人工已复核重锚', 'Re-Anchor')}
                    </button>
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      marginTop: 4,
                    }}
                  >
                    {c.elapsedHours.toFixed(1)}h elapsed · stability{' '}
                    {c.stabilityHours.toFixed(1)}h · entropy{' '}
                    {c.mutationEntropy.toFixed(2)}
                  </div>
                  <div style={{fontSize: 12, marginTop: 4}}>
                    {c.autonomousDeltaBullets[0] ?? c.northStarGoal}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <strong style={{fontSize: 13.5}}>
              {tr(
                lang,
                '全局工程宪法与高危指令沙箱拦截 (Constitution)',
                'Global Engineering Constitution & Guardrails',
              )}
            </strong>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={savingConst}
              onClick={() => void handleSaveConstitution()}
            >
              {tr(lang, '保存并立即生效', 'Save & Apply')}
            </button>
          </div>
          {constSavedMsg && (
            <div style={{fontSize: 11.5, color: '#15803d', marginBottom: 6}}>
              {constSavedMsg}
            </div>
          )}
          <textarea
            className="mono"
            rows={5}
            value={constMd}
            onChange={e => setConstMd(e.target.value)}
            style={{marginBottom: 8}}
          />
          <div style={{fontSize: 11.5, fontWeight: 600, marginBottom: 4}}>
            {tr(
              lang,
              '沙箱黑名单命令模式 (每行一个)',
              'Blocked Command Patterns (one per line)',
            )}
          </div>
          <textarea
            className="mono"
            rows={3}
            value={blockedCmds}
            onChange={e => setBlockedCmds(e.target.value)}
          />
        </div>
      </div>

      {/* Audit Ledger */}
      <div className="card" style={{marginTop: 16}}>
        <strong style={{fontSize: 13.5}}>
          {tr(
            lang,
            '最近编排审计账本 (Audit Ledger)',
            'Recent Orchestration Audit Ledger',
          )}
        </strong>
        <div style={{marginTop: 8}}>
          {recentAudit.map(entry => (
            <div
              key={entry.id}
              style={{
                padding: '7px 0',
                borderBottom: '1px solid var(--border-hairline)',
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                fontSize: 12,
              }}
            >
              <div>
                <span className="tag">{entry.category}</span>{' '}
                <strong>{entry.title}</strong>
                <div style={{color: 'var(--text-muted)', fontSize: 11.5}}>
                  {entry.detail}
                </div>
              </div>
              <div
                className="mono"
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  flexShrink: 0,
                }}
              >
                {entry.author} · {entry.createdAt.slice(11, 19)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
