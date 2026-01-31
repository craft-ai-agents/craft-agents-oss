/**
 * Lab Storage
 *
 * CRUD operations for Lab projects, personas, and pipelines.
 * Storage follows the same workspace-scoped pattern as sources/skills:
 *
 *   {workspaceRootPath}/lab/
 *     personas/
 *       {personaId}.json
 *     projects/
 *       {projectId}/
 *         project.json
 *         pipelines/
 *           {pipelineId}.json
 *
 * All functions take `workspaceRootPath` (absolute path), not workspace slug.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { join, basename } from 'path';
import { randomUUID } from 'crypto';
import type {
  LabPersona,
  CreatePersonaInput,
  LabProject,
  CreateProjectInput,
  LabPipeline,
  LoadedLabProject,
} from './types.ts';
import { createLogger } from '../utils/debug.ts';

const logger = createLogger('lab:storage');
const log = (message: string) => logger.debug(message);

// ============================================================
// Path Utilities
// ============================================================

export function getLabPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'lab');
}

export function getPersonasPath(workspaceRootPath: string): string {
  return join(getLabPath(workspaceRootPath), 'personas');
}

export function getProjectsPath(workspaceRootPath: string): string {
  return join(getLabPath(workspaceRootPath), 'projects');
}

export function getProjectPath(workspaceRootPath: string, projectId: string): string {
  return join(getProjectsPath(workspaceRootPath), projectId);
}

export function getPipelinesPath(workspaceRootPath: string, projectId: string): string {
  return join(getProjectPath(workspaceRootPath, projectId), 'pipelines');
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function ensureLabDirs(workspaceRootPath: string): void {
  ensureDir(getPersonasPath(workspaceRootPath));
  ensureDir(getProjectsPath(workspaceRootPath));
}

/**
 * Generate a URL-safe slug from a name, deduplicating against existing IDs.
 */
function generateSlug(name: string, existingIds: string[]): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'untitled';

  if (!existingIds.includes(base)) return base;

  let counter = 1;
  while (existingIds.includes(`${base}-${counter}`)) {
    counter++;
  }
  return `${base}-${counter}`;
}

// ============================================================
// Persona CRUD
// ============================================================

/**
 * Create a new persona in the workspace.
 */
export function createPersona(
  workspaceRootPath: string,
  input: CreatePersonaInput,
): LabPersona {
  ensureLabDirs(workspaceRootPath);

  const existingIds = listPersonaIds(workspaceRootPath);
  const id = generateSlug(input.name, existingIds);
  const now = Date.now();

  const persona: LabPersona = {
    id,
    name: input.name,
    role: input.role,
    icon: input.icon || '🤖',
    mindset: input.mindset,
    knowledge: input.knowledge,
    evaluationCriteria: input.evaluationCriteria,
    model: input.model,
    createdAt: now,
    updatedAt: now,
  };

  const filePath = join(getPersonasPath(workspaceRootPath), `${id}.json`);
  writeFileSync(filePath, JSON.stringify(persona, null, 2), 'utf-8');
  log(`Created persona "${persona.name}" (${id})`);
  return persona;
}

/**
 * Load a single persona by ID.
 */
export function loadPersona(
  workspaceRootPath: string,
  personaId: string,
): LabPersona | null {
  const filePath = join(getPersonasPath(workspaceRootPath), `${personaId}.json`);
  if (!existsSync(filePath)) return null;

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as LabPersona;
  } catch {
    log(`Failed to load persona ${personaId}`);
    return null;
  }
}

/**
 * Load all personas in the workspace.
 */
export function loadAllPersonas(workspaceRootPath: string): LabPersona[] {
  const dir = getPersonasPath(workspaceRootPath);
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  const personas: LabPersona[] = [];

  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as LabPersona;
      personas.push(data);
    } catch {
      log(`Failed to parse persona file: ${file}`);
    }
  }

  return personas.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * List all persona IDs.
 */
export function listPersonaIds(workspaceRootPath: string): string[] {
  const dir = getPersonasPath(workspaceRootPath);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}

/**
 * Update a persona.
 */
export function savePersona(
  workspaceRootPath: string,
  persona: LabPersona,
): void {
  ensureLabDirs(workspaceRootPath);
  persona.updatedAt = Date.now();
  const filePath = join(getPersonasPath(workspaceRootPath), `${persona.id}.json`);
  writeFileSync(filePath, JSON.stringify(persona, null, 2), 'utf-8');
  log(`Saved persona "${persona.name}"`);
}

/**
 * Delete a persona by ID.
 */
export function deletePersona(
  workspaceRootPath: string,
  personaId: string,
): boolean {
  const filePath = join(getPersonasPath(workspaceRootPath), `${personaId}.json`);
  if (!existsSync(filePath)) return false;
  rmSync(filePath);
  log(`Deleted persona ${personaId}`);
  return true;
}

/**
 * Resolve multiple persona IDs to full persona objects.
 */
export function resolvePersonas(
  workspaceRootPath: string,
  personaIds: string[],
): LabPersona[] {
  return personaIds
    .map(id => loadPersona(workspaceRootPath, id))
    .filter((p): p is LabPersona => p !== null);
}

// ============================================================
// Project CRUD
// ============================================================

/**
 * Create a new project.
 */
export function createProject(
  workspaceRootPath: string,
  input: CreateProjectInput,
): LabProject {
  ensureLabDirs(workspaceRootPath);

  const existingIds = listProjectIds(workspaceRootPath);
  const id = generateSlug(input.name, existingIds);
  const now = Date.now();

  const project: LabProject = {
    id,
    name: input.name,
    description: input.description,
    goals: input.goals || [],
    repository: input.repository,
    workingDirectory: input.workingDirectory,
    personaIds: input.personaIds || [],
    createdAt: now,
    updatedAt: now,
  };

  const projectDir = getProjectPath(workspaceRootPath, id);
  ensureDir(projectDir);
  ensureDir(join(projectDir, 'pipelines'));

  writeFileSync(
    join(projectDir, 'project.json'),
    JSON.stringify(project, null, 2),
    'utf-8',
  );

  log(`Created project "${project.name}" (${id})`);
  return project;
}

/**
 * Load a project by ID.
 */
export function loadProject(
  workspaceRootPath: string,
  projectId: string,
): LabProject | null {
  const filePath = join(getProjectPath(workspaceRootPath, projectId), 'project.json');
  if (!existsSync(filePath)) return null;

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as LabProject;
  } catch {
    log(`Failed to load project ${projectId}`);
    return null;
  }
}

/**
 * Load a fully resolved project with personas and pipeline count.
 */
export function loadLabProject(
  workspaceRootPath: string,
  projectId: string,
): LoadedLabProject | null {
  const project = loadProject(workspaceRootPath, projectId);
  if (!project) return null;

  const personas = resolvePersonas(workspaceRootPath, project.personaIds);
  const pipelines = listPipelineIds(workspaceRootPath, projectId);
  const latestPipelineId = pipelines[pipelines.length - 1];
  const latestPipeline = latestPipelineId
    ? loadPipeline(workspaceRootPath, projectId, latestPipelineId)
    : null;

  return {
    project,
    personas,
    pipelineCount: pipelines.length,
    latestPipelineStatus: latestPipeline?.status,
    path: getProjectPath(workspaceRootPath, projectId),
  };
}

/**
 * Load all projects in the workspace.
 */
export function loadAllProjects(workspaceRootPath: string): LabProject[] {
  const dir = getProjectsPath(workspaceRootPath);
  if (!existsSync(dir)) return [];

  const entries = readdirSync(dir, { withFileTypes: true });
  const projects: LabProject[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const project = loadProject(workspaceRootPath, entry.name);
    if (project) projects.push(project);
  }

  return projects.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * List all project IDs.
 */
export function listProjectIds(workspaceRootPath: string): string[] {
  const dir = getProjectsPath(workspaceRootPath);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

/**
 * Save/update a project.
 */
export function saveProject(
  workspaceRootPath: string,
  project: LabProject,
): void {
  const projectDir = getProjectPath(workspaceRootPath, project.id);
  ensureDir(projectDir);
  project.updatedAt = Date.now();
  writeFileSync(
    join(projectDir, 'project.json'),
    JSON.stringify(project, null, 2),
    'utf-8',
  );
  log(`Saved project "${project.name}"`);
}

/**
 * Delete a project and all its pipelines.
 */
export function deleteProject(
  workspaceRootPath: string,
  projectId: string,
): boolean {
  const projectDir = getProjectPath(workspaceRootPath, projectId);
  if (!existsSync(projectDir)) return false;
  rmSync(projectDir, { recursive: true, force: true });
  log(`Deleted project ${projectId}`);
  return true;
}

// ============================================================
// Pipeline CRUD
// ============================================================

/**
 * Create a new pipeline for a project.
 */
export function createPipeline(
  workspaceRootPath: string,
  projectId: string,
  prompt: string,
  maxIterations: number = 2,
): LabPipeline {
  const pipelinesDir = getPipelinesPath(workspaceRootPath, projectId);
  ensureDir(pipelinesDir);

  const id = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const now = Date.now();

  const pipeline: LabPipeline = {
    id,
    projectId,
    prompt,
    status: 'pending',
    phases: [],
    iteration: 0,
    maxIterations,
    createdAt: now,
    updatedAt: now,
  };

  writeFileSync(
    join(pipelinesDir, `${id}.json`),
    JSON.stringify(pipeline, null, 2),
    'utf-8',
  );

  log(`Created pipeline ${id} for project ${projectId}`);
  return pipeline;
}

/**
 * Load a pipeline by ID.
 */
export function loadPipeline(
  workspaceRootPath: string,
  projectId: string,
  pipelineId: string,
): LabPipeline | null {
  const filePath = join(
    getPipelinesPath(workspaceRootPath, projectId),
    `${pipelineId}.json`,
  );
  if (!existsSync(filePath)) return null;

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as LabPipeline;
  } catch {
    log(`Failed to load pipeline ${pipelineId}`);
    return null;
  }
}

/**
 * Load all pipelines for a project.
 */
export function loadProjectPipelines(
  workspaceRootPath: string,
  projectId: string,
): LabPipeline[] {
  const dir = getPipelinesPath(workspaceRootPath, projectId);
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  const pipelines: LabPipeline[] = [];

  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as LabPipeline;
      pipelines.push(data);
    } catch {
      log(`Failed to parse pipeline file: ${file}`);
    }
  }

  return pipelines.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * List pipeline IDs for a project (sorted by creation time).
 */
export function listPipelineIds(
  workspaceRootPath: string,
  projectId: string,
): string[] {
  const dir = getPipelinesPath(workspaceRootPath, projectId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .sort();
}

/**
 * Save/update a pipeline.
 */
export function savePipeline(
  workspaceRootPath: string,
  pipeline: LabPipeline,
): void {
  const dir = getPipelinesPath(workspaceRootPath, pipeline.projectId);
  ensureDir(dir);
  pipeline.updatedAt = Date.now();
  writeFileSync(
    join(dir, `${pipeline.id}.json`),
    JSON.stringify(pipeline, null, 2),
    'utf-8',
  );
}

/**
 * Delete a pipeline.
 */
export function deletePipeline(
  workspaceRootPath: string,
  projectId: string,
  pipelineId: string,
): boolean {
  const filePath = join(
    getPipelinesPath(workspaceRootPath, projectId),
    `${pipelineId}.json`,
  );
  if (!existsSync(filePath)) return false;
  rmSync(filePath);
  log(`Deleted pipeline ${pipelineId}`);
  return true;
}

/**
 * Delete all pipelines for a project (clear history).
 */
export function deleteAllPipelines(
  workspaceRootPath: string,
  projectId: string,
): number {
  const dir = getPipelinesPath(workspaceRootPath, projectId);
  if (!existsSync(dir)) return 0;

  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    rmSync(join(dir, file));
  }
  log(`Deleted ${files.length} pipelines for project ${projectId}`);
  return files.length;
}
