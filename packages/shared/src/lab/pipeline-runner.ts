/**
 * Pipeline Runner (War Room)
 *
 * Orchestrates the three-act pipeline:
 *   Act 1 - THINK: Each persona writes a brief in parallel (read-only)
 *   Act 2 - BUILD: Manager synthesizes briefs and implements (sequential)
 *   Act 3 - JUDGE: Each persona reviews the work in parallel (read-only)
 *
 * If reviews indicate issues, the pipeline can iterate (Act 2→3 loop).
 *
 * Runs in the main process. Uses HeadlessRunner for each agent session.
 */

import { randomUUID } from 'crypto';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';
import type { Workspace } from '@craft-agent/core/types';
import type { LabProject, LabPersona, LabPipeline, LabPhase, LabAgentRun, PipelineStatus, AgentRunStatus, PipelineEvent } from './types.ts';
import { savePipeline } from './storage.ts';
import { createLogger } from '../utils/debug.ts';
import { setExecutable, setPathToClaudeCodeExecutable } from '../agent/options.ts';

const logger = createLogger('lab:pipeline');
const log = (message: string) => logger.debug(message);

// Re-export PipelineEvent from types (defined there for renderer-safe imports)
export type { PipelineEvent } from './types.ts';
export type PipelineEventCallback = (event: PipelineEvent) => void;

// ============================================================
// Phase Labels
// ============================================================

const PHASE_LABELS: Record<string, string> = {
  think: 'Think — Parallel Briefs',
  build: 'Build — Implementation',
  review: 'Review — Quality Check',
  iterate: 'Iterate — Fix Issues',
  synthesize: 'Synthesize — Plan',
};

// ============================================================
// System Prompt Builders
// ============================================================

function buildThinkPrompt(persona: LabPersona, project: LabProject, userPrompt: string): string {
  return `You are ${persona.name}, a ${persona.role}.

## Your Mindset
${persona.mindset}

## Your Knowledge
${persona.knowledge}

## Project Context
**Project:** ${project.name}
**Description:** ${project.description}
${project.goals.length > 0 ? `**Goals:**\n${project.goals.map(g => `- ${g}`).join('\n')}` : ''}
${project.workingDirectory ? `**Working Directory:** ${project.workingDirectory}` : ''}

## Your Task
The team has been asked to work on the following:

"${userPrompt}"

Write a **brief** for this task from your perspective as ${persona.role}. Your brief should cover:
1. **Key concerns** from your domain expertise
2. **Requirements** you think are essential
3. **Risks** or pitfalls to watch out for
4. **Recommendations** for how to approach this

Keep your brief focused and actionable. Think about what you uniquely bring to this problem that other team members might miss.

Do NOT write code. Write a structured brief document.`;
}

function buildSynthesizeAndBuildPrompt(
  project: LabProject,
  userPrompt: string,
  briefs: Array<{ personaName: string; personaRole: string; output: string }>,
): string {
  const briefSections = briefs.map(b =>
    `### ${b.personaName} (${b.personaRole})\n${b.output}`
  ).join('\n\n---\n\n');

  return `You are the Project Manager and Lead Implementer for this project.

## Project Context
**Project:** ${project.name}
**Description:** ${project.description}
${project.goals.length > 0 ? `**Goals:**\n${project.goals.map(g => `- ${g}`).join('\n')}` : ''}
${project.workingDirectory ? `**Working Directory:** ${project.workingDirectory}` : ''}

## Task
"${userPrompt}"

## Team Briefs
Your team of experts has reviewed this task and provided the following briefs:

${briefSections}

## Your Mission
1. **Synthesize** the briefs above into a coherent implementation plan
2. **Implement** the solution, taking into account all perspectives
3. **Create** well-structured, production-quality code
4. **Document** key decisions and trade-offs

You have full access to the filesystem and tools. Implement the solution now.`;
}

function buildReviewPrompt(
  persona: LabPersona,
  project: LabProject,
  userPrompt: string,
): string {
  return `You are ${persona.name}, a ${persona.role}.

## Your Mindset
${persona.mindset}

## Your Evaluation Criteria
${persona.evaluationCriteria}

## Project Context
**Project:** ${project.name}
**Description:** ${project.description}
${project.workingDirectory ? `**Working Directory:** ${project.workingDirectory}` : ''}

## Original Task
"${userPrompt}"

## Your Review Mission
The team has completed implementation of the task above. Review the current state of the project:

1. **Read** the relevant code and files in the working directory
2. **Evaluate** the implementation against your criteria
3. **Rate** the quality: PASS, MINOR_ISSUES, or MAJOR_ISSUES
4. **Explain** specific issues if any, with file paths and line numbers

Structure your review as:
- **Rating:** PASS | MINOR_ISSUES | MAJOR_ISSUES
- **Summary:** One-paragraph assessment
- **Issues:** Bullet list of specific problems (if any)
- **Suggestions:** Concrete improvements

Be thorough but fair. MAJOR_ISSUES means the implementation is fundamentally broken or missing critical requirements.`;
}

// ============================================================
// Pipeline Runner
// ============================================================

export interface PipelineRunnerConfig {
  workspace: Workspace;
  workspaceRootPath: string;
  project: LabProject;
  personas: LabPersona[];
  pipeline: LabPipeline;
  onEvent?: PipelineEventCallback;
  signal?: AbortSignal;
}

/**
 * Run a Lab pipeline (War Room execution).
 *
 * This is an async function that runs the full pipeline to completion.
 * Progress is reported via the onEvent callback.
 *
 * Returns the final pipeline state.
 */
/**
 * Ensure the SDK executable paths are configured for subprocess spawning.
 * In Electron dev mode, the SessionManager.initialize() may fail before setting these,
 * so we set them defensively here before creating any HeadlessRunner instances.
 */
function ensureExecutablePaths(): void {
  // Ensure bun is in PATH (Electron GUI apps may have minimal PATH)
  const bunBinDir = join(homedir(), '.bun', 'bin');
  const currentPath = process.env.PATH || '';
  if (!currentPath.includes(bunBinDir)) {
    const sep = process.platform === 'win32' ? ';' : ':';
    process.env.PATH = `${bunBinDir}${sep}${currentPath}`;
    log(`Added ${bunBinDir} to PATH`);
  }

  // Ensure bun executable path is set
  const bunPath = join(bunBinDir, 'bun');
  if (existsSync(bunPath)) {
    setExecutable(bunPath);
    log(`Set executable: ${bunPath}`);
  }

  // Ensure SDK CLI path is set (look in node_modules)
  // Try common locations: cwd, monorepo root patterns
  const sdkRelative = join('node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js');
  const candidates = [
    join(process.cwd(), sdkRelative),
    join(process.cwd(), '..', '..', sdkRelative),  // monorepo root from apps/electron
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      setPathToClaudeCodeExecutable(candidate);
      log(`Set pathToClaudeCodeExecutable: ${candidate}`);
      break;
    }
  }
}

export async function runPipeline(config: PipelineRunnerConfig): Promise<LabPipeline> {
  const { workspace, workspaceRootPath, project, personas, pipeline, onEvent, signal } = config;

  // Ensure executable paths are configured before spawning agent subprocesses
  ensureExecutablePaths();

  // Track active HeadlessRunner instances for abort support
  const activeRunners: Set<InstanceType<typeof import('../headless/index.ts').HeadlessRunner>> = new Set();

  // When signal fires, abort all active runners
  const onAbort = () => {
    log(`Pipeline ${pipeline.id} received abort signal, killing ${activeRunners.size} active runners`);
    for (const runner of activeRunners) {
      runner.abort();
    }
    activeRunners.clear();
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  // Increase max listeners to avoid warning when running many concurrent agents
  // Each HeadlessRunner → CraftAgent → SDK subprocess adds an 'exit' listener
  const currentMax = process.getMaxListeners();
  if (currentMax < personas.length + 10) {
    process.setMaxListeners(personas.length + 10);
  }

  const emit = onEvent || (() => {});
  let totalCostUsd = 0;
  let totalTokens = 0;

  // Update pipeline state helper
  const updatePipeline = (updates: Partial<LabPipeline>) => {
    Object.assign(pipeline, updates, { updatedAt: Date.now() });
    savePipeline(workspaceRootPath, pipeline);
  };

  // Create a conforming LabAgentRun
  const createAgentRun = (persona: { id: string; name: string; icon: string }): LabAgentRun => ({
    id: randomUUID(),
    personaId: persona.id,
    personaName: persona.name,
    personaIcon: persona.icon,
    status: 'running' as AgentRunStatus,
    startedAt: Date.now(),
  });

  // Create a conforming LabPhase
  const createPhase = (type: LabPhase['type']): LabPhase => ({
    id: randomUUID(),
    type,
    label: PHASE_LABELS[type] || type,
    status: 'running',
    agents: [],
    startedAt: Date.now(),
  });

  try {
    emit({ type: 'pipeline_started', pipelineId: pipeline.id });
    updatePipeline({ status: 'thinking' });

    // Helper to check abort before starting a new phase
    const checkAborted = () => {
      if (signal?.aborted) {
        throw new Error('Pipeline cancelled');
      }
    };

    // ============================================================
    // ACT 1: THINK (parallel briefs from each persona)
    // ============================================================
    const thinkPhase = createPhase('think');
    pipeline.phases.push(thinkPhase);
    updatePipeline({});

    emit({ type: 'phase_started', pipelineId: pipeline.id, phaseId: thinkPhase.id, phaseType: 'think', phaseIndex: 0 });

    // Run all persona briefs in parallel
    const briefPromises = personas.map(async (persona) => {
      const agentRun = createAgentRun(persona);
      thinkPhase.agents.push(agentRun);
      updatePipeline({});

      emit({
        type: 'agent_started',
        pipelineId: pipeline.id,
        phaseIndex: 0,
        agentRunId: agentRun.id,
        personaId: persona.id,
        personaName: persona.name,
        personaIcon: persona.icon,
      });

      try {
        checkAborted();
        const { HeadlessRunner } = await import('../headless/index.ts');
        const prompt = buildThinkPrompt(persona, project, pipeline.prompt);

        const runner = new HeadlessRunner({
          prompt,
          workspace,
          model: persona.model || 'haiku',
          permissionPolicy: 'allow-all', // Headless agents must be autonomous (no user to approve)
        });
        activeRunners.add(runner);

        const result = await runner.run();
        activeRunners.delete(runner);

        if (result.success && result.response) {
          agentRun.status = 'completed';
          agentRun.output = result.response;
          agentRun.completedAt = Date.now();
          if (result.usage) {
            agentRun.tokenUsage = {
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
              totalTokens: result.usage.inputTokens + result.usage.outputTokens,
              costUsd: result.usage.costUsd,
            };
            totalCostUsd += result.usage.costUsd;
            totalTokens += agentRun.tokenUsage.totalTokens;
          }

          emit({
            type: 'agent_completed',
            pipelineId: pipeline.id,
            phaseIndex: 0,
            agentRunId: agentRun.id,
            personaId: persona.id,
            output: result.response,
            tokenUsage: agentRun.tokenUsage,
          });
        } else {
          agentRun.status = 'failed';
          agentRun.error = result.error?.message || 'Unknown error';
          agentRun.completedAt = Date.now();

          emit({
            type: 'agent_failed',
            pipelineId: pipeline.id,
            phaseIndex: 0,
            agentRunId: agentRun.id,
            personaId: persona.id,
            error: agentRun.error,
          });
        }
      } catch (err) {
        agentRun.status = 'failed';
        agentRun.error = err instanceof Error ? err.message : String(err);
        agentRun.completedAt = Date.now();

        console.error(`[lab:pipeline] Think phase agent ${persona.name} failed:`, agentRun.error);
        if (err instanceof Error && err.stack) {
          console.error('[lab:pipeline] Stack:', err.stack);
        }

        emit({
          type: 'agent_failed',
          pipelineId: pipeline.id,
          phaseIndex: 0,
          agentRunId: agentRun.id,
          personaId: persona.id,
          error: agentRun.error,
        });
      }

      updatePipeline({});
      return agentRun;
    });

    const briefResults = await Promise.all(briefPromises);

    thinkPhase.status = 'completed';
    thinkPhase.completedAt = Date.now();
    updatePipeline({});

    emit({ type: 'phase_completed', pipelineId: pipeline.id, phaseIndex: 0, phaseType: 'think' });

    // Collect successful briefs
    const successfulBriefs = briefResults
      .filter(r => r.status === 'completed' && r.output)
      .map(r => {
        const persona = personas.find(p => p.id === r.personaId);
        return {
          personaName: r.personaName,
          personaRole: persona?.role || 'Team Member',
          output: r.output!,
        };
      });

    if (successfulBriefs.length === 0) {
      updatePipeline({ status: 'failed' });
      emit({
        type: 'pipeline_error',
        pipelineId: pipeline.id,
        error: 'All persona briefs failed. Cannot proceed to build phase.',
      });
      return pipeline;
    }

    // ============================================================
    // ACT 2: BUILD (sequential implementation)
    // ============================================================
    for (let iteration = 0; iteration <= pipeline.maxIterations; iteration++) {
      pipeline.iteration = iteration;
      updatePipeline({ status: iteration === 0 ? 'building' : 'iterating' });

      const buildPhaseType = iteration === 0 ? 'build' as const : 'iterate' as const;
      const buildPhase = createPhase(buildPhaseType);
      pipeline.phases.push(buildPhase);
      const buildPhaseIndex = pipeline.phases.length - 1;
      updatePipeline({});

      emit({
        type: 'phase_started',
        pipelineId: pipeline.id,
        phaseId: buildPhase.id,
        phaseType: buildPhase.type,
        phaseIndex: buildPhaseIndex,
      });

      const managerPersona = { id: 'manager', name: 'Project Manager', icon: '👨‍💻' };
      const buildRun = createAgentRun(managerPersona);
      buildPhase.agents.push(buildRun);
      updatePipeline({});

      emit({
        type: 'agent_started',
        pipelineId: pipeline.id,
        phaseIndex: buildPhaseIndex,
        agentRunId: buildRun.id,
        personaId: 'manager',
        personaName: 'Project Manager',
        personaIcon: '👨‍💻',
      });

      try {
        checkAborted();
        const { HeadlessRunner } = await import('../headless/index.ts');
        const buildPrompt = buildSynthesizeAndBuildPrompt(project, pipeline.prompt, successfulBriefs);

        const runner = new HeadlessRunner({
          prompt: buildPrompt,
          workspace,
          model: 'sonnet', // Manager uses a capable model
          permissionPolicy: 'allow-all', // Build phase needs write access
        });
        activeRunners.add(runner);

        const result = await runner.run();
        activeRunners.delete(runner);

        if (result.success && result.response) {
          buildRun.status = 'completed';
          buildRun.output = result.response;
          buildRun.completedAt = Date.now();
          if (result.usage) {
            buildRun.tokenUsage = {
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
              totalTokens: result.usage.inputTokens + result.usage.outputTokens,
              costUsd: result.usage.costUsd,
            };
            totalCostUsd += result.usage.costUsd;
            totalTokens += buildRun.tokenUsage.totalTokens;
          }

          emit({
            type: 'agent_completed',
            pipelineId: pipeline.id,
            phaseIndex: buildPhaseIndex,
            agentRunId: buildRun.id,
            personaId: 'manager',
            output: result.response,
            tokenUsage: buildRun.tokenUsage,
          });
        } else {
          buildRun.status = 'failed';
          buildRun.error = result.error?.message || 'Build failed';
          buildRun.completedAt = Date.now();
          buildPhase.status = 'failed';
          buildPhase.completedAt = Date.now();

          updatePipeline({ status: 'failed', totalCostUsd, totalTokens });
          emit({
            type: 'pipeline_error',
            pipelineId: pipeline.id,
            error: `Build phase failed: ${buildRun.error}`,
          });
          return pipeline;
        }
      } catch (err) {
        buildRun.status = 'failed';
        buildRun.error = err instanceof Error ? err.message : String(err);
        buildRun.completedAt = Date.now();
        buildPhase.status = 'failed';
        buildPhase.completedAt = Date.now();

        console.error(`[lab:pipeline] Build phase failed:`, buildRun.error);
        if (err instanceof Error && err.stack) {
          console.error('[lab:pipeline] Stack:', err.stack);
        }

        updatePipeline({ status: 'failed', totalCostUsd, totalTokens });
        emit({
          type: 'pipeline_error',
          pipelineId: pipeline.id,
          error: `Build phase error: ${buildRun.error}`,
        });
        return pipeline;
      }

      buildPhase.status = 'completed';
      buildPhase.completedAt = Date.now();
      updatePipeline({});
      emit({ type: 'phase_completed', pipelineId: pipeline.id, phaseIndex: buildPhaseIndex, phaseType: buildPhase.type });

      // ============================================================
      // ACT 3: JUDGE (parallel reviews from each persona)
      // ============================================================
      updatePipeline({ status: 'reviewing' });

      const reviewPhase = createPhase('review');
      pipeline.phases.push(reviewPhase);
      const reviewPhaseIndex = pipeline.phases.length - 1;
      updatePipeline({});

      emit({ type: 'phase_started', pipelineId: pipeline.id, phaseId: reviewPhase.id, phaseType: 'review', phaseIndex: reviewPhaseIndex });

      const reviewPromises = personas.map(async (persona) => {
        const reviewRun = createAgentRun(persona);
        reviewPhase.agents.push(reviewRun);
        updatePipeline({});

        emit({
          type: 'agent_started',
          pipelineId: pipeline.id,
          phaseIndex: reviewPhaseIndex,
          agentRunId: reviewRun.id,
          personaId: persona.id,
          personaName: persona.name,
          personaIcon: persona.icon,
        });

        try {
          checkAborted();
          const { HeadlessRunner } = await import('../headless/index.ts');
          const prompt = buildReviewPrompt(persona, project, pipeline.prompt);

          const runner = new HeadlessRunner({
            prompt,
            workspace,
            model: persona.model || 'haiku',
            permissionPolicy: 'allow-all', // Headless agents must be autonomous (no user to approve)
          });
          activeRunners.add(runner);

          const result = await runner.run();
          activeRunners.delete(runner);

          if (result.success && result.response) {
            reviewRun.status = 'completed';
            reviewRun.output = result.response;
            reviewRun.completedAt = Date.now();
            if (result.usage) {
              reviewRun.tokenUsage = {
                inputTokens: result.usage.inputTokens,
                outputTokens: result.usage.outputTokens,
                totalTokens: result.usage.inputTokens + result.usage.outputTokens,
                costUsd: result.usage.costUsd,
              };
              totalCostUsd += result.usage.costUsd;
              totalTokens += reviewRun.tokenUsage.totalTokens;
            }

            emit({
              type: 'agent_completed',
              pipelineId: pipeline.id,
              phaseIndex: reviewPhaseIndex,
              agentRunId: reviewRun.id,
              personaId: persona.id,
              output: result.response,
              tokenUsage: reviewRun.tokenUsage,
            });
          } else {
            reviewRun.status = 'failed';
            reviewRun.error = result.error?.message || 'Review failed';
            reviewRun.completedAt = Date.now();

            emit({
              type: 'agent_failed',
              pipelineId: pipeline.id,
              phaseIndex: reviewPhaseIndex,
              agentRunId: reviewRun.id,
              personaId: persona.id,
              error: reviewRun.error,
            });
          }
        } catch (err) {
          reviewRun.status = 'failed';
          reviewRun.error = err instanceof Error ? err.message : String(err);
          reviewRun.completedAt = Date.now();

          console.error(`[lab:pipeline] Review phase agent ${persona.name} failed:`, reviewRun.error);
          if (err instanceof Error && err.stack) {
            console.error('[lab:pipeline] Stack:', err.stack);
          }

          emit({
            type: 'agent_failed',
            pipelineId: pipeline.id,
            phaseIndex: reviewPhaseIndex,
            agentRunId: reviewRun.id,
            personaId: persona.id,
            error: reviewRun.error,
          });
        }

        updatePipeline({});
        return reviewRun;
      });

      await Promise.all(reviewPromises);

      reviewPhase.status = 'completed';
      reviewPhase.completedAt = Date.now();
      updatePipeline({});
      emit({ type: 'phase_completed', pipelineId: pipeline.id, phaseIndex: reviewPhaseIndex, phaseType: 'review' });

      // Check if reviews indicate major issues requiring iteration
      const reviews = reviewPhase.agents.filter(r => r.status === 'completed' && r.output);
      const hasMajorIssues = reviews.some(r =>
        r.output?.toUpperCase().includes('MAJOR_ISSUES')
      );

      if (!hasMajorIssues || iteration >= pipeline.maxIterations) {
        // Pipeline complete (either reviews passed or max iterations reached)
        break;
      }

      log(`Iteration ${iteration + 1}: Major issues found, re-running build phase`);
      // Loop back to build phase (Act 2) with review feedback
      // The next build iteration can read the review files
    }

    // ============================================================
    // COMPLETE
    // ============================================================
    updatePipeline({
      status: 'completed',
      completedAt: Date.now(),
      totalCostUsd,
      totalTokens,
    });

    emit({
      type: 'pipeline_completed',
      pipelineId: pipeline.id,
      status: 'completed',
      totalCostUsd,
      totalTokens,
    });

    log(`Pipeline ${pipeline.id} completed. Cost: $${totalCostUsd.toFixed(2)}, Tokens: ${totalTokens}`);
    return pipeline;

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;
    const isCancelled = errorMsg === 'Pipeline cancelled' || signal?.aborted;

    // Always log errors to stderr regardless of debug mode
    console.error(`[lab:pipeline] Pipeline ${pipeline.id} ${isCancelled ? 'cancelled' : 'failed'}:`, errorMsg);
    if (errorStack && !isCancelled) {
      console.error('[lab:pipeline] Stack:', errorStack);
    }

    // Abort any still-running agents
    for (const runner of activeRunners) {
      runner.abort();
    }
    activeRunners.clear();

    updatePipeline({
      status: isCancelled ? 'cancelled' : 'failed',
      totalCostUsd,
      totalTokens,
    });

    emit({
      type: isCancelled ? 'pipeline_cancelled' : 'pipeline_error',
      pipelineId: pipeline.id,
      error: isCancelled ? 'Pipeline was stopped by user' : errorMsg,
    } as any); // pipeline_cancelled shares same shape as pipeline_error

    log(`Pipeline ${pipeline.id} ${isCancelled ? 'cancelled' : 'failed'}: ${errorMsg}`);
    return pipeline;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
