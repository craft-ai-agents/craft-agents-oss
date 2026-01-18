#!/usr/bin/env bun
/**
 * Extract the Claude Code system prompt from the SDK by intercepting the API call.
 *
 * This script:
 * 1. Sets CLAUDE_EXTRACT_SYSTEM_PROMPT=1 to enable the capture interceptor
 * 2. Runs a minimal SDK query
 * 3. Reads the captured system prompt from /tmp/claude-system-prompt-capture.json
 *
 * Usage:
 *   bun run scripts/system-prompt/extract.ts
 *
 * Output:
 *   prompts/claude-code/v{version}.md
 */

import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const CAPTURE_FILE = '/tmp/claude-system-prompt-capture.json';
const LOG_FILE = '/tmp/claude-extract-debug.log';

// Enable extraction mode for the capture interceptor
process.env.CLAUDE_EXTRACT_SYSTEM_PROMPT = '1';

// Get SDK version
function getSdkVersion(): string {
  const sdkPackageJson = join(
    process.cwd(),
    'node_modules/@anthropic-ai/claude-agent-sdk/package.json'
  );
  if (!existsSync(sdkPackageJson)) {
    throw new Error('Claude Agent SDK not found. Run bun install first.');
  }
  const pkg = JSON.parse(readFileSync(sdkPackageJson, 'utf-8'));
  return pkg.version;
}

// Format system blocks as markdown
function formatSystemPrompt(blocks: unknown[]): string {
  const textBlocks: string[] = [];

  for (const block of blocks) {
    if (typeof block === 'object' && block !== null) {
      const b = block as { type?: string; text?: string };
      if (b.type === 'text' && b.text) {
        textBlocks.push(b.text);
      }
    }
  }

  return textBlocks.join('\n\n---\n\n');
}

async function main() {
  const version = getSdkVersion();
  console.log(`\n🔍 Extracting Claude Code system prompt from SDK v${version}\n`);

  // Clean up any previous capture
  if (existsSync(CAPTURE_FILE)) {
    unlinkSync(CAPTURE_FILE);
  }
  if (existsSync(LOG_FILE)) {
    unlinkSync(LOG_FILE);
  }

  // Ensure output directory exists
  const outputDir = join(process.cwd(), 'prompts/claude-code');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Set API key if not already set
  if (!process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-placeholder-for-extraction';
  }

  console.log('→ Starting SDK query with claude_code preset...');
  console.log('  (The capture interceptor will capture the system prompt)\n');

  // Dynamic import to ensure preloads are active
  const { query } = await import('@anthropic-ai/claude-agent-sdk');

  try {
    const q = query({
      prompt: 'Say "test" and stop.',
      options: {
        model: 'claude-opus-4-5-20251101',
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
        },
        tools: { type: 'preset', preset: 'claude_code' },
        cwd: process.cwd(),
      }
    });

    // Iterate to trigger the API call
    let messageCount = 0;
    for await (const message of q) {
      messageCount++;
      const type = (message as any).type;
      console.log(`  Message ${messageCount}: type=${type}`);

      // Check if capture file exists (prompt has been captured)
      if (existsSync(CAPTURE_FILE)) {
        console.log('  ✓ System prompt captured!');
        break;
      }

      // Stop after enough messages to avoid long waits
      if (messageCount >= 15) {
        break;
      }
    }

    console.log(`  Query complete (${messageCount} messages)\n`);

  } catch (e: any) {
    console.log(`  Query ended: ${e.message}`);
  }

  // Check for captured prompt
  if (!existsSync(CAPTURE_FILE)) {
    console.error('\n✗ Failed to capture system prompt.');
    console.error('  The capture interceptor may not be running in the SDK subprocess.');

    // Show debug log if available
    if (existsSync(LOG_FILE)) {
      console.error('\n  Debug log:');
      console.error(readFileSync(LOG_FILE, 'utf-8'));
    }

    process.exit(1);
  }

  // Read captured prompt
  const capture = JSON.parse(readFileSync(CAPTURE_FILE, 'utf-8'));
  const capturedSystemPrompt = capture.systemBlocks;
  const capturedModel = capture.model;

  // Format and save
  const markdown = formatSystemPrompt(capturedSystemPrompt);
  const outputFile = join(outputDir, `v${version}.md`);

  // Add header
  const header = `# Claude Code System Prompt

Extracted from \`@anthropic-ai/claude-agent-sdk\` v${version}
Date: ${new Date().toISOString().split('T')[0]}
Model: ${capturedModel || 'unknown'}

---

`;

  writeFileSync(outputFile, header + markdown);

  const lines = markdown.split('\n').length;
  const chars = markdown.length;

  console.log(`✓ Saved to: ${outputFile}`);
  console.log(`  Blocks: ${capturedSystemPrompt.length}`);
  console.log(`  Lines: ${lines.toLocaleString()}`);
  console.log(`  Characters: ${chars.toLocaleString()}`);

  // Clean up capture file
  unlinkSync(CAPTURE_FILE);

  // Show first 800 characters as preview
  console.log('\n--- Preview (first 800 chars) ---\n');
  console.log(markdown.substring(0, 800) + '...\n');
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
