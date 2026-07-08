/**
 * @craft-agent/shared/tasks
 *
 * task.yaml spec (schema + types), reference grammar, graph validation, and
 * filesystem persistence for the Tasks feature. The in-process Conductor lives
 * in packages/server-core/src/tasks/ and builds on these primitives.
 */
export * from './schema.ts';
export * from './refs.ts';
export * from './validate.ts';
export * from './storage.ts';
export * from './generator-prompt.ts';
