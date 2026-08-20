/**
 * @craft-agent/core
 *
 * Core types and utilities for Craft Agent.
 *
 * NOTE: This package currently only exports types and utilities.
 * Storage, credentials, agent, auth, mcp, and prompts are still
 * imported directly from src/ in the consuming apps.
 */

// Re-export all types
export * from './types/index.ts';

// Re-export utilities
export * from './utils/index.ts';

// Re-export platform registries and model (pure TS, unified shell)
export * from './platform/index.ts';
// Re-export the KnowledgeProvider contract (K-03); zero deps on shared/server-core
export * from './knowledge/index.ts';
