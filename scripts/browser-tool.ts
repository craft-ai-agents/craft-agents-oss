#!/usr/bin/env bun
/**
 * browser-tool (secondary path)
 *
 * CLI helper for browser automation workflows in Craft Agents.
 *
 * This helper is intentionally thin and deterministic:
 * - It provides command discovery via --help
 * - It emits structured browser_* tool call templates as JSON
 * - Execution still happens through native browser_* tools in sessions
 */

type CommandSpec = {
  name: string;
  args?: string;
  description: string;
  example: string;
};

const COMMANDS: CommandSpec[] = [
  { name: 'help', description: 'Show usage', example: 'browser-tool --help' },
  { name: 'list', description: 'List supported browser_* operations', example: 'browser-tool list' },
  { name: 'template', args: '<operation>', description: 'Print JSON template for one browser_* operation', example: 'browser-tool template browser_navigate' },
  { name: 'all-templates', description: 'Print JSON templates for all browser_* operations', example: 'browser-tool all-templates' },
];

const TOOL_TEMPLATES: Record<string, Record<string, unknown>> = {
  browser_open: {},
  browser_navigate: { url: 'https://example.com' },
  browser_snapshot: {},
  browser_click: { ref: '@e1', waitFor: 'network-idle', timeoutMs: 8000 },
  browser_fill: { ref: '@e5', value: 'hello world' },
  browser_select: { ref: '@e3', value: 'option_value' },
  browser_screenshot: {},
  browser_screenshot_region: { ref: '@e12', padding: 8 },
  browser_console: { level: 'warn', limit: 50 },
  browser_window_resize: { width: 1280, height: 720 },
  browser_network: { limit: 50, status: 'failed' },
  browser_wait: { kind: 'network-idle', timeoutMs: 8000 },
  browser_key: { key: 'Enter' },
  browser_downloads: { action: 'list', limit: 20 },
  browser_scroll: { direction: 'down', amount: 500 },
  browser_back: {},
  browser_forward: {},
  browser_evaluate: { expression: 'document.title' },
};

function printHelp(): void {
  console.log('browser-tool - Browser automation helper for Craft Agents');
  console.log('');
  console.log('Usage:');
  console.log('  bun run browser-tool <command> [args]');
  console.log('  bun run browser-tool --help');
  console.log('');
  console.log('Commands:');
  for (const cmd of COMMANDS) {
    const sig = cmd.args ? `${cmd.name} ${cmd.args}` : cmd.name;
    console.log(`  ${sig.padEnd(28)} ${cmd.description}`);
  }
  console.log('');
  console.log('Notes:');
  console.log('  - Primary execution path is native browser_* tools in sessions.');
  console.log('  - This CLI is a secondary helper for discovery and templating.');
  console.log('');
  console.log('Examples:');
  for (const cmd of COMMANDS) {
    console.log(`  ${cmd.example}`);
  }
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function main(argv: string[]): number {
  const args = argv.slice(2);
  const [command = 'help', op] = args;

  if (command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    return 0;
  }

  if (command === 'list') {
    printJson({ operations: Object.keys(TOOL_TEMPLATES) });
    return 0;
  }

  if (command === 'template') {
    if (!op) {
      console.error('Error: template requires <operation>');
      return 1;
    }
    const input = TOOL_TEMPLATES[op];
    if (!input) {
      console.error(`Error: unknown operation "${op}"`);
      return 1;
    }
    printJson({ tool: op, input });
    return 0;
  }

  if (command === 'all-templates') {
    const out = Object.entries(TOOL_TEMPLATES).map(([tool, input]) => ({ tool, input }));
    printJson({ templates: out });
    return 0;
  }

  console.error(`Error: unknown command "${command}"\n`);
  printHelp();
  return 1;
}

process.exit(main(process.argv));
