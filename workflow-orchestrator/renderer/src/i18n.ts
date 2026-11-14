export type UiLang = 'ZH' | 'EN';

export function tr(lang: UiLang, zh: string, en: string): string {
  return lang === 'ZH' ? zh : en;
}

export function formatNodeStatus(lang: UiLang, status: string): string {
  switch (status) {
    case 'pending':
      return tr(lang, '待调度', 'Pending');
    case 'ready':
      return tr(lang, '就绪', 'Ready');
    case 'running':
      return tr(lang, '执行中', 'Running');
    case 'succeeded':
      return tr(lang, '已完成', 'Succeeded');
    case 'failed':
      return tr(lang, '失败', 'Failed');
    case 'skipped':
      return tr(lang, '条件跳过', 'Skipped');
    case 'waiting_human':
      return tr(lang, '待人工裁决', 'Waiting Human');
    case 'rewound':
      return tr(lang, '已回退', 'Rewound');
    case 'waived':
      return tr(lang, '已豁免', 'Waived');
    default:
      return status;
  }
}

export function formatRunStatus(lang: UiLang, status: string): string {
  switch (status) {
    case 'queued':
      return tr(lang, '排队中', 'Queued');
    case 'running':
      return tr(lang, '实时编排中', 'Running');
    case 'paused':
      return tr(lang, '已暂停', 'Paused');
    case 'waiting_human':
      return tr(lang, '等待人工门禁', 'Waiting Human');
    case 'succeeded':
      return tr(lang, '已认证完成', 'Succeeded');
    case 'failed':
      return tr(lang, '执行失败', 'Failed');
    case 'cancelled':
      return tr(lang, '已终止', 'Cancelled');
    default:
      return status;
  }
}

export function formatWorkflowStatus(lang: UiLang, status: string): string {
  switch (status) {
    case 'draft':
      return tr(lang, '草稿待校验', 'Draft');
    case 'validated':
      return tr(lang, '已通过校验', 'Validated');
    case 'trial_passed':
      return tr(lang, '试运行通过', 'Trial Passed');
    case 'locked':
      return tr(lang, '版本已锁定', 'Locked');
    default:
      return status;
  }
}

export function formatExecutorKind(lang: UiLang, kind: string): string {
  switch (kind) {
    case 'agent':
      return tr(lang, '智能体 (Agent)', 'Agent');
    case 'tool':
      return tr(lang, '工具 (Tool)', 'Tool');
    case 'human':
      return tr(lang, '人工 (Human)', 'Human');
    case 'control':
      return tr(lang, '控制流 (Control)', 'Control');
    default:
      return kind;
  }
}
