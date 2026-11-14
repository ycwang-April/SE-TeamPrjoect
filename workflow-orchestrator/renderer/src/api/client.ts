import type {
  BootstrapSnapshot,
  ConfirmVersionRequest,
  EvidenceSearchHit,
  ImportRequirementsRequest,
  OrchestratorPreloadBridge,
  OrchestratorSseEvent,
  ProposeGhostNodeRequest,
  RegisterCapabilityRequest,
  ResolveInterventionRequest,
  RunDetailSnapshot,
  SessionTranscriptView,
  StartRunRequest,
  UpdateDraftGraphRequest,
  UpdateGoalSpecRequest,
  UpdateProviderSecretRequest,
  WorkflowDetailSnapshot,
} from '../../../src/shared/api';
import type {
  CapabilityAdapterManifest,
  CapabilityHealthProfile,
  ModelProviderConfig,
  WorkflowVersionSnapshot,
  WorkspaceEntry,
} from '../../../src/shared/types';

declare global {
  interface Window {
    readonly workflowOrchestrator?: OrchestratorPreloadBridge;
  }
}

export interface DoctorReportDto {
  readonly gitReady: boolean;
  readonly gitVersion: string;
  readonly nodeVersion: string;
  readonly capabilityHealth: readonly CapabilityHealthProfile[];
  readonly checkedAt: string;
}

function getBridgeConfig(): {
  readonly apiBaseUrl: string;
  readonly sessionToken: string;
} {
  if (window.workflowOrchestrator?.apiBaseUrl) {
    return {
      apiBaseUrl: window.workflowOrchestrator.apiBaseUrl,
      sessionToken: window.workflowOrchestrator.sessionToken,
    };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    apiBaseUrl: params.get('apiBaseUrl') ?? 'http://127.0.0.1:4190',
    sessionToken: params.get('token') ?? '',
  };
}

async function apiFetch<T>(
  path: string,
  options?: {readonly method?: 'GET' | 'POST'; readonly body?: unknown},
): Promise<T> {
  const cfg = getBridgeConfig();
  const res = await fetch(`${cfg.apiBaseUrl}${path}`, {
    method: options?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${cfg.sessionToken}`,
      'Content-Type': 'application/json',
    },
    body:
      options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const msg =
      typeof json['error'] === 'string'
        ? json['error']
        : `HTTP ${res.status} error`;
    throw new Error(msg);
  }
  return json as T;
}

export const orchApi = {
  getBootstrap: () => apiFetch<BootstrapSnapshot>('/api/bootstrap'),

  createWorkspace: (body: {
    readonly name: string;
    readonly rootPath: string;
    readonly verifyCommand?: string;
    readonly description?: string;
  }) =>
    apiFetch<{readonly workspace: WorkspaceEntry}>('/api/workspaces', {
      method: 'POST',
      body,
    }),

  importRequirements: (body: ImportRequirementsRequest) =>
    apiFetch<WorkflowDetailSnapshot>('/api/workflows/import-requirements', {
      method: 'POST',
      body,
    }),

  getWorkflowDetail: (workflowId: string) =>
    apiFetch<WorkflowDetailSnapshot>(`/api/workflows/${workflowId}`),

  updateGoalSpec: (workflowId: string, body: UpdateGoalSpecRequest) =>
    apiFetch<WorkflowDetailSnapshot>(`/api/workflows/${workflowId}/spec`, {
      method: 'POST',
      body,
    }),

  updateDraftGraph: (workflowId: string, body: UpdateDraftGraphRequest) =>
    apiFetch<WorkflowDetailSnapshot>(
      `/api/workflows/${workflowId}/draft-graph`,
      {
        method: 'POST',
        body,
      },
    ),

  replanWorkflow: (workflowId: string) =>
    apiFetch<WorkflowDetailSnapshot>(`/api/workflows/${workflowId}/replan`, {
      method: 'POST',
      body: {},
    }),

  runTrial: (workflowId: string) =>
    apiFetch<WorkflowDetailSnapshot>(`/api/workflows/${workflowId}/trial`, {
      method: 'POST',
      body: {},
    }),

  confirmVersion: (workflowId: string, body: ConfirmVersionRequest = {}) =>
    apiFetch<{
      readonly version: WorkflowVersionSnapshot;
      readonly workflow: WorkflowDetailSnapshot;
    }>(`/api/workflows/${workflowId}/confirm-version`, {
      method: 'POST',
      body,
    }),

  startRun: (body: StartRunRequest) =>
    apiFetch<RunDetailSnapshot>('/api/runs', {method: 'POST', body}),

  getRunDetail: (runId: string) =>
    apiFetch<RunDetailSnapshot>(`/api/runs/${runId}`),

  pauseRun: (runId: string) =>
    apiFetch<RunDetailSnapshot>(`/api/runs/${runId}/pause`, {
      method: 'POST',
      body: {},
    }),

  resumeRun: (runId: string) =>
    apiFetch<RunDetailSnapshot>(`/api/runs/${runId}/resume`, {
      method: 'POST',
      body: {},
    }),

  cancelRun: (runId: string) =>
    apiFetch<RunDetailSnapshot>(`/api/runs/${runId}/cancel`, {
      method: 'POST',
      body: {},
    }),

  retryNode: (runId: string, nodeId: string) =>
    apiFetch<RunDetailSnapshot>(`/api/runs/${runId}/retry-node`, {
      method: 'POST',
      body: {nodeId},
    }),

  proposeGhostNode: (runId: string, body: ProposeGhostNodeRequest) =>
    apiFetch<RunDetailSnapshot>(`/api/runs/${runId}/ghost-node`, {
      method: 'POST',
      body,
    }),

  manualRestore: (runId: string, checkpointId: string) =>
    apiFetch<RunDetailSnapshot>(`/api/runs/${runId}/restore`, {
      method: 'POST',
      body: {checkpointId},
    }),

  setNodeCollapsed: (nodeId: string, collapsed: boolean) =>
    apiFetch(`/api/nodes/${nodeId}/collapse`, {
      method: 'POST',
      body: {collapsed},
    }),

  resolveIntervention: (
    interventionId: string,
    body: ResolveInterventionRequest,
  ) =>
    apiFetch<RunDetailSnapshot>(
      `/api/interventions/${interventionId}/resolve`,
      {
        method: 'POST',
        body,
      },
    ),

  registerCapability: (body: RegisterCapabilityRequest) =>
    apiFetch<{
      readonly capabilities: readonly CapabilityAdapterManifest[];
      readonly capabilityHealth: readonly CapabilityHealthProfile[];
    }>('/api/capabilities', {method: 'POST', body}),

  probeCapability: (id: string) =>
    apiFetch<{
      readonly probe: {readonly ok: boolean; readonly message: string};
      readonly capabilities: readonly CapabilityAdapterManifest[];
      readonly capabilityHealth: readonly CapabilityHealthProfile[];
    }>(`/api/capabilities/${id}/probe`, {method: 'POST', body: {}}),

  toggleCapability: (id: string, enabled: boolean) =>
    apiFetch<{
      readonly capabilities: readonly CapabilityAdapterManifest[];
      readonly capabilityHealth: readonly CapabilityHealthProfile[];
    }>(`/api/capabilities/${id}/toggle`, {method: 'POST', body: {enabled}}),

  setProviderSecret: (providerId: string, body: UpdateProviderSecretRequest) =>
    apiFetch<{readonly modelProviders: readonly ModelProviderConfig[]}>(
      `/api/providers/${providerId}/secret`,
      {method: 'POST', body},
    ),

  getSessionTranscript: (sessionId: string) =>
    apiFetch<SessionTranscriptView>(`/api/sessions/${sessionId}`),

  searchEvidence: (q: string) =>
    apiFetch<{readonly hits: readonly EvidenceSearchHit[]}>(
      `/api/evidence/search?q=${encodeURIComponent(q)}`,
    ),

  runDoctor: () =>
    apiFetch<DoctorReportDto>('/api/doctor', {method: 'POST', body: {}}),

  subscribeSse: (
    onEvent: (evt: OrchestratorSseEvent) => void,
    onStatusChange?: (connected: boolean) => void,
  ): (() => void) => {
    const cfg = getBridgeConfig();
    const url = `${cfg.apiBaseUrl}/api/events?token=${encodeURIComponent(cfg.sessionToken)}`;
    const source = new EventSource(url);
    const eventTypes: OrchestratorSseEvent['type'][] = [
      'snapshot.invalidated',
      'workflow.updated',
      'run.status',
      'node.status',
      'attempt.updated',
      'checkpoint.created',
      'intervention.created',
      'intervention.resolved',
      'session.chunk',
      'audit.appended',
      'heartbeat',
    ];
    source.onopen = () => onStatusChange?.(true);
    source.onerror = () => onStatusChange?.(false);
    for (const evtType of eventTypes) {
      source.addEventListener(evtType, msg => {
        try {
          onEvent(
            JSON.parse(
              (msg as MessageEvent<string>).data,
            ) as OrchestratorSseEvent,
          );
        } catch {
          // ignore malformed chunks
        }
      });
    }
    return () => source.close();
  },
};
