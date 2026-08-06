const VALID_TASK_STATUSES = ['completed', 'failed', 'stopped'] as const;

export type ClaudeTaskStatus = typeof VALID_TASK_STATUSES[number];

export interface ClaudeTaskNotification {
  taskId: string;
  status: ClaudeTaskStatus;
  outputFile?: string;
  summary?: string;
}

export type ClaudeTaskNotificationClassification =
  | { kind: 'not-task-notification' }
  | { kind: 'missing-task-id' }
  | { kind: 'valid'; notification: ClaudeTaskNotification };

/**
 * Classify the SDK's unexported task_notification shape in one place so in-turn
 * adaptation and between-turn persistent-query routing cannot drift.
 */
export function classifyClaudeTaskNotification(
  message: unknown,
): ClaudeTaskNotificationClassification {
  const candidate = message as {
    type?: unknown;
    subtype?: unknown;
    task_id?: unknown;
    status?: unknown;
    output_file?: unknown;
    summary?: unknown;
  } | null | undefined;

  if (candidate?.type !== 'system' || candidate.subtype !== 'task_notification') {
    return { kind: 'not-task-notification' };
  }
  if (typeof candidate.task_id !== 'string' || candidate.task_id.length === 0) {
    return { kind: 'missing-task-id' };
  }

  const status = typeof candidate.status === 'string'
    && VALID_TASK_STATUSES.includes(candidate.status as ClaudeTaskStatus)
    ? (candidate.status as ClaudeTaskStatus)
    : 'completed';
  const outputFile = typeof candidate.output_file === 'string' && candidate.output_file
    ? candidate.output_file
    : undefined;
  const summary = typeof candidate.summary === 'string' && candidate.summary
    ? candidate.summary
    : undefined;

  return {
    kind: 'valid',
    notification: {
      taskId: candidate.task_id,
      status,
      ...(outputFile ? { outputFile } : {}),
      ...(summary ? { summary } : {}),
    },
  };
}
