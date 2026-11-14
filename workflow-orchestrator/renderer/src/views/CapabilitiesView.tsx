import {type ReactElement, useState} from 'react';
import type {
  CapabilityAdapterManifest,
  CapabilityHealthProfile,
  ExecutorKind,
  ModelProviderConfig,
} from '../../../src/shared/types';
import {orchApi, type DoctorReportDto} from '../api/client';
import {CpuIcon, ShieldCheckIcon} from '../components/Icons';
import {formatExecutorKind, tr, type UiLang} from '../i18n';

interface CapabilitiesViewProps {
  readonly lang: UiLang;
  readonly capabilities: readonly CapabilityAdapterManifest[];
  readonly capabilityHealth: readonly CapabilityHealthProfile[];
  readonly modelProviders: readonly ModelProviderConfig[];
  readonly onRefresh: () => Promise<void>;
}

export function CapabilitiesView(props: CapabilitiesViewProps): ReactElement {
  const {lang, capabilities, capabilityHealth, modelProviders, onRefresh} =
    props;

  const [busy, setBusy] = useState(false);
  const [doctor, setDoctor] = useState<DoctorReportDto | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState<Record<string, string>>({});

  // Custom Capability Form
  const [newId, setNewId] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newCommand, setNewCommand] = useState('');
  const [newExecKind, setNewExecKind] = useState<ExecutorKind>('tool');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const healthById = new Map(capabilityHealth.map(h => [h.capabilityId, h]));

  const handleProbe = async (id: string): Promise<void> => {
    setBusy(true);
    setErrMsg(null);
    try {
      await orchApi.probeCapability(id);
      await onRefresh();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (id: string, enabled: boolean): Promise<void> => {
    setBusy(true);
    setErrMsg(null);
    try {
      await orchApi.toggleCapability(id, enabled);
      await onRefresh();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveProviderKey = async (providerId: string): Promise<void> => {
    setBusy(true);
    setErrMsg(null);
    try {
      await orchApi.setProviderSecret(providerId, {
        apiKey: apiKeyDraft[providerId] ?? '',
      });
      setApiKeyDraft(prev => ({...prev, [providerId]: ''}));
      await onRefresh();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterCustom = async (): Promise<void> => {
    if (!newId.trim() || !newLabel.trim()) {
      return;
    }
    setBusy(true);
    setErrMsg(null);
    try {
      await orchApi.registerCapability({
        manifest: {
          id: newId.trim(),
          label: newLabel.trim(),
          executorKind: newExecKind,
          specialty: 'Custom registered workflow capability',
          sovereignSoul: 'Execute custom command/agent slice safely.',
          transport: newExecKind === 'tool' ? 'local-tool' : 'cli-stream',
          command: newCommand.trim() || 'node',
          baseArgs: [],
          healthProbeArgs: ['--version'],
          mcpInjection: 'none',
          jsonlParser: 'generic-jsonl',
          permissionFlags: {turbo: [], supervised: [], strict: []},
          envAllowlist: [],
          defaultModel: 'default',
          supportedRoles: ['worker'],
          maxConcurrentSlots: 2,
          enabled: true,
          builtIn: false,
        },
      });
      setNewId('');
      setNewLabel('');
      setNewCommand('');
      await onRefresh();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRunDoctor = async (): Promise<void> => {
    setBusy(true);
    try {
      const report = await orchApi.runDoctor();
      setDoctor(report);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-scroll">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <div>
          <h2
            style={{margin: 0, display: 'flex', alignItems: 'center', gap: 8}}
          >
            <CpuIcon size={18} />{' '}
            {tr(
              lang,
              '执行能力池与模型供应配置',
              'Capabilities Pool & Model Providers',
            )}
          </h2>
          <div style={{color: 'var(--text-muted)', marginTop: 3}}>
            {tr(
              lang,
              '管理 Agent / Tool / Human / Control 能力状态、熔断器与商业大模型安全密钥池。',
              'Manage capability adapters, circuit breakers, and isolated API provider credentials.',
            )}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-soft"
          disabled={busy}
          onClick={() => void handleRunDoctor()}
        >
          <ShieldCheckIcon size={14} />{' '}
          {tr(lang, '环境体检 (Env Doctor)', 'Run Env Doctor')}
        </button>
      </div>

      {errMsg && (
        <div
          className="error-banner"
          style={{marginBottom: 12, borderRadius: 8}}
        >
          <span>{errMsg}</span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setErrMsg(null)}
          >
            ×
          </button>
        </div>
      )}

      {doctor && (
        <div
          className="card"
          style={{
            marginBottom: 16,
            background: '#f0fdf4',
            borderColor: '#86efac',
          }}
        >
          <strong>
            {tr(lang, '环境体检报告', 'Environment Doctor Report')}
          </strong>{' '}
          · Node {doctor.nodeVersion} · Git:{' '}
          <span className="mono">{doctor.gitVersion}</span>
        </div>
      )}

      <div
        style={{display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 16}}
      >
        {/* Capabilities Registry & Health */}
        <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
          <div className="card">
            <strong style={{fontSize: 13.5}}>
              {tr(
                lang,
                '能力注册与熔断监控',
                'Capability Registry & Circuit Status',
              )}
            </strong>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                marginTop: 10,
              }}
            >
              {capabilities.map(cap => {
                const hp = healthById.get(cap.id);
                const circuit =
                  hp?.circuitState ?? (cap.enabled ? 'closed' : 'open');
                return (
                  <div
                    key={cap.id}
                    style={{
                      border: '1px solid var(--border-card)',
                      borderRadius: 8,
                      padding: '10px 12px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                    }}
                  >
                    <div>
                      <div
                        style={{display: 'flex', alignItems: 'center', gap: 6}}
                      >
                        <span className="mono" style={{fontWeight: 700}}>
                          {cap.id}
                        </span>
                        <span className="tag tag-indigo">
                          {formatExecutorKind(lang, cap.executorKind)}
                        </span>
                        <span
                          className={`tag ${
                            circuit === 'closed'
                              ? 'tag-green'
                              : circuit === 'half_open'
                                ? 'tag-amber'
                                : 'tag-red'
                          }`}
                        >
                          circuit: {circuit}
                        </span>
                      </div>
                      <div style={{fontWeight: 600, marginTop: 3}}>
                        {cap.label}
                      </div>
                      <div style={{fontSize: 11.5, color: 'var(--text-muted)'}}>
                        {cap.specialty} · Probe: {cap.probeMessage}
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        flexShrink: 0,
                      }}
                    >
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busy}
                        onClick={() => void handleProbe(cap.id)}
                      >
                        {tr(lang, '探测', 'Probe')}
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${cap.enabled ? '' : 'btn-primary'}`}
                        disabled={busy}
                        onClick={() => void handleToggle(cap.id, !cap.enabled)}
                      >
                        {cap.enabled
                          ? tr(lang, '禁用', 'Disable')
                          : tr(lang, '启用', 'Enable')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <strong style={{fontSize: 13}}>
              {tr(lang, '注册自定义能力', 'Register Custom Capability')}
            </strong>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr 1fr auto',
                gap: 8,
                marginTop: 8,
              }}
            >
              <input
                value={newId}
                onChange={e => setNewId(e.target.value)}
                placeholder="tool:pytest"
              />
              <input
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder="Pytest Runner"
              />
              <select
                value={newExecKind}
                onChange={e => setNewExecKind(e.target.value as ExecutorKind)}
              >
                <option value="tool">tool</option>
                <option value="agent">agent</option>
              </select>
              <input
                value={newCommand}
                onChange={e => setNewCommand(e.target.value)}
                placeholder="command / bin"
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !newId.trim() || !newLabel.trim()}
                onClick={() => void handleRegisterCustom()}
              >
                {tr(lang, '注册', 'Register')}
              </button>
            </div>
          </div>
        </div>

        {/* Provider Vault */}
        <div className="card" style={{height: 'fit-content'}}>
          <strong style={{fontSize: 13.5}}>
            {tr(
              lang,
              '模型供应与密钥保险库 (Secrets Vault)',
              'Model Providers & Secret Vault',
            )}
          </strong>
          <div
            style={{
              fontSize: 11.5,
              color: 'var(--text-muted)',
              marginTop: 3,
              marginBottom: 10,
            }}
          >
            {tr(
              lang,
              '密钥持久化在主机安全文件，永不进入 SQLite 转录日志；未配密钥时自动降级为确定性本地执行以保障演示和离线验证。',
              'API keys live outside SQLite transcripts; offline deterministic synthesis works cleanly when unconfigured.',
            )}
          </div>
          {modelProviders.map(p => (
            <div
              key={p.id}
              style={{
                border: '1px solid var(--border-card)',
                borderRadius: 8,
                padding: '10px 12px',
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <strong>{p.name}</strong>
                <span className={`tag ${p.hasApiKey ? 'tag-green' : ''}`}>
                  {p.hasApiKey
                    ? p.maskedKeyHint
                    : tr(lang, '未配置', 'Not configured')}
                </span>
              </div>
              <div
                className="mono"
                style={{fontSize: 11, color: 'var(--text-muted)', marginTop: 3}}
              >
                {p.baseUrl} · {p.models.map(m => m.id).join(', ')}
              </div>
              <div style={{display: 'flex', gap: 6, marginTop: 8}}>
                <input
                  type="password"
                  value={apiKeyDraft[p.id] ?? ''}
                  onChange={e =>
                    setApiKeyDraft(prev => ({...prev, [p.id]: e.target.value}))
                  }
                  placeholder={tr(
                    lang,
                    '输入 API Key (留空清除)...',
                    'Enter API Key (empty clears)...',
                  )}
                />
                <button
                  type="button"
                  className="btn btn-soft"
                  disabled={busy}
                  onClick={() => void handleSaveProviderKey(p.id)}
                >
                  {tr(lang, '保存', 'Save')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
