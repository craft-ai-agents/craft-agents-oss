/**
 * What agents are told about a task. A task's own session (the orchestrator) has no messages until
 * a run's verification, and a task `create_task` made lives only in task.yaml, so an agent asked
 * to "do the task" had never seen its goal. SessionManager sends `buildTaskSessionContext` with
 * the task session's turns (once, and again after the spec changes), and `get_session_info`
 * returns `taskSubtasks` with the goal for any session of the task.
 */
import { nodeDeps, nodeTitle, type TaskSpec } from './schema.ts';

/** Goal and criteria are quoted up to this length; the spec file has the rest. */
const MAX_TEXT_CHARS = 10_000;
/** Subtask prompts are quoted up to this length. */
const MAX_PROMPT_CHARS = 4_000;
/** Subtasks listed at most. */
const MAX_SUBTASKS = 30;

export interface TaskSubtaskSummary {
  id: string;
  title: string;
  prompt?: string;
  dependsOn?: string[];
}

/**
 * A task's subtasks (DAG nodes), except the lone node that only repeats the goal (`create_task`
 * makes one `main` node whose prompt is the description).
 */
export function taskSubtasks(spec: TaskSpec): TaskSubtaskSummary[] {
  const [only] = spec.nodes;
  if (spec.nodes.length === 1 && only) {
    const prompt = only.prompt?.trim();
    if (!prompt || prompt === spec.goal.trim()) return [];
  }
  return spec.nodes.map((node) => {
    const prompt = node.prompt?.trim();
    const dependsOn = nodeDeps(node);
    return {
      id: node.id,
      title: nodeTitle(node),
      ...(prompt ? { prompt } : {}),
      ...(dependsOn.length > 0 ? { dependsOn } : {}),
    };
  });
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}… (cut, see the spec file for the rest)`;
}

/** The task as its own session's agent gets it, in a `<task_context>` block. */
export function buildTaskSessionContext(spec: TaskSpec, specPath: string): string {
  const lines = [
    `This session belongs to the task "${spec.title}" on the Tasks board; its spec is ${specPath}. Use what follows when the user refers to the task or asks you to work on it.`,
    '',
    'Goal:',
    clip(spec.goal.trim(), MAX_TEXT_CHARS),
  ];
  const criteria = spec.acceptance_criteria?.trim();
  if (criteria) lines.push('', 'Acceptance criteria:', clip(criteria, MAX_TEXT_CHARS));

  const subtasks = taskSubtasks(spec);
  if (subtasks.length > 0) {
    lines.push('', 'Subtasks:');
    subtasks.slice(0, MAX_SUBTASKS).forEach((subtask, index) => {
      const after = subtask.dependsOn ? `, after ${subtask.dependsOn.join(', ')}` : '';
      lines.push(`${index + 1}. ${subtask.title} (${subtask.id}${after})`);
      if (subtask.prompt) lines.push(clip(subtask.prompt, MAX_PROMPT_CHARS).replace(/^/gm, '   '));
    });
    if (subtasks.length > MAX_SUBTASKS) lines.push(`… and ${subtasks.length - MAX_SUBTASKS} more in the spec file.`);
  }

  if (spec.skills?.length) lines.push('', `Skills the task uses: ${spec.skills.join(', ')}`);
  // The spec can hold text from anywhere (an automation's create_task): it never ends the block early
  const body = lines.join('\n').replaceAll('</task_context>', '&lt;/task_context&gt;');
  return `<task_context>\n${body}\n</task_context>`;
}
