import {useEffect, useState} from 'react';
import type {ApprovedRequirementsBaseline} from '../../../../requirements-engineering/src/contracts.ts';
import type {DesignInputDraft, WorkspaceInventory} from '../../../../software-design/src/contracts.ts';
import type {WorkspaceEntry} from '../../../src/shared/types';
import {orchApi} from '../api/client';

export function DesignStart({baseline, workspaces}: {
  baseline: ApprovedRequirementsBaseline; workspaces: readonly WorkspaceEntry[];
}) {
  const [workspaceId, setWorkspaceId] = useState('');
  const [inventory, setInventory] = useState<WorkspaceInventory | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<DesignInputDraft | null>(null);
  useEffect(() => {
    let active = true;
    setInventory(null);
    setError('');
    if (workspaceId) void orchApi.designWorkspace(workspaceId).then(value => {
      if (active) setInventory(value);
    }).catch(e => {if (active) setError((e as Error).message);});
    return () => {active = false;};
  }, [workspaceId, refresh]);
  return <div className="hama-stack">
    <h3>生成软件设计</h3>
    <p>来源项目 {baseline.projectId} · 基线 {baseline.id} · v{baseline.revision} · {baseline.sha256}</p>
    <label>目标工程工作区<select value={workspaceId} disabled={busy} onChange={e => {
      setWorkspaceId(e.target.value); setInventory(null); setDraft(null);
    }}>
      <option value="">请显式选择目标工程</option>
      {workspaces.filter(w => w.description !== 'hama-document-workspace').map(w =>
        <option key={w.id} value={w.id}>{w.name} · {w.rootPath}</option>)}
    </select></label>
    {inventory && <p>目标提交：{inventory.sourceCommit ?? '尚无提交（概念设计）'} · 已有文件 {inventory.existingPaths.length} 个</p>}
    {baseline.mode === 'demo' && <p>演示基线仅供演练，正式交接需要 live 基线。</p>}
    {inventory?.notes.map(note => <p key={note}>{note}</p>)}
    <div className="hama-actions">
      <button className="btn" disabled={!workspaceId || busy} onClick={() => setRefresh(n => n + 1)}>刷新目标提交</button>
      <button className="btn btn-primary" disabled={busy || !inventory || inventory.workspaceId !== workspaceId}
        onClick={() => {
          if (!inventory) return;
          setBusy(true); setError('');
          void orchApi.createDesign({baselineId: baseline.id, workspaceId, sourceCommit: inventory.sourceCommit})
            .then(setDraft).catch(e => setError((e as Error).message)).finally(() => setBusy(false));
        }}>{busy ? '正在创建设计草案…' : '生成软件设计'}</button>
    </div>
    <p className="hama-muted">本阶段保存需求与工程输入草案；设计正文生成及评审在后续阶段接入。</p>
    {error && <p role="alert">{error}</p>}
    {draft && <div className="hama-stack" role="status">
      <p>已保存设计输入草案 {draft.designId} · 修订 {draft.revision} · {draft.contentSha256}</p>
      {draft.blockers.map(b => <p key={b}>{b}</p>)}
      <details className="hama-details"><summary>基线引用、目标提交与需求 / AC 清单</summary>
        <pre>{JSON.stringify({baselineRef: draft.baselineRef, workspace: draft.workspace,
          requirements: draft.baseline.prd.requirements, trace: draft.baseline.prd.trace}, null, 2)}</pre>
      </details>
      <button className="btn" onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], {type: 'application/json'}));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${draft.designId}.json`; anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>导出设计输入记录</button>
    </div>}
  </div>;
}
