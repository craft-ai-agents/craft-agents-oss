import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentMessageReceipt } from './types.ts';

export const AGENT_MESSAGES_DIR = 'agent-messages';

export function getAgentMessagesDir(workspaceRootPath: string): string {
  return join(workspaceRootPath, AGENT_MESSAGES_DIR);
}

export function getAgentMessageReceiptFile(workspaceRootPath: string, receiptId: string): string {
  return join(getAgentMessagesDir(workspaceRootPath), `${receiptId}.json`);
}

export function writeAgentMessageReceipt(workspaceRootPath: string, receipt: AgentMessageReceipt): void {
  const dir = getAgentMessagesDir(workspaceRootPath);
  mkdirSync(dir, { recursive: true });
  const file = getAgentMessageReceiptFile(workspaceRootPath, receipt.id);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(receipt, null, 2), 'utf-8');
  renameSync(tmp, file);
}

export function readAgentMessageReceipt(workspaceRootPath: string, receiptId: string): AgentMessageReceipt | null {
  const file = getAgentMessageReceiptFile(workspaceRootPath, receiptId);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf-8')) as AgentMessageReceipt;
}

export function listAgentMessageReceipts(workspaceRootPath: string): AgentMessageReceipt[] {
  const dir = getAgentMessagesDir(workspaceRootPath);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf-8')) as AgentMessageReceipt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
