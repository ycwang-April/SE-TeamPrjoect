import {type ReactElement, useState} from 'react';
import type {EvidenceSearchHit} from '../../../src/shared/api';
import type {
  AuditLedgerEntry,
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
  readonly onOpenRun: (runId: string) => void;
}

export function RunsAuditView(props: RunsAuditViewProps): ReactElement {
  const {lang, versions, runs, recentAudit, onOpenRun} = props;
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<readonly EvidenceSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

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
                      rework {r.reworkCount}
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
