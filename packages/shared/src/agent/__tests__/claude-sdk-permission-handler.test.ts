import { describe, expect, it } from 'bun:test';
import { createSdkPermissionHandler, type SdkPermissionRequest } from '../claude-agent.ts';

describe('Claude SDK permission handler', () => {
  it('forwards SDK prompts to the host and returns the approval result', async () => {
    const requests: unknown[] = [];
    const handler = createSdkPermissionHandler(async request => {
      requests.push(request);
      return true;
    });

    await expect(handler('Write', { file_path: '/tmp/out.txt' }, {
      signal: new AbortController().signal,
      blockedPath: '/tmp/out.txt',
      title: 'Claude wants to write a file',
      toolUseID: 'tool-1',
      requestId: 'request-1',
    })).resolves.toEqual({
      behavior: 'allow',
      updatedInput: { file_path: '/tmp/out.txt' },
    });

    expect(requests).toEqual([{
      requestId: 'request-1',
      toolName: 'Write',
      description: 'Claude wants to write a file',
      blockedPath: '/tmp/out.txt',
    }]);
  });

  it('denies aborted requests without calling the host', async () => {
    let called = false;
    const handler = createSdkPermissionHandler(async () => {
      called = true;
      return true;
    });
    const controller = new AbortController();
    controller.abort();

    await expect(handler('Bash', { command: 'python3 script.py' }, {
      signal: controller.signal,
      toolUseID: 'tool-2',
      requestId: 'request-2',
    })).resolves.toEqual({
      behavior: 'deny',
      message: 'Permission request was aborted',
      interrupt: true,
    });
    expect(called).toBe(false);
  });

  it('lets the local PreToolUse hook handle its own permission prompts', async () => {
    let called = false;
    const handler = createSdkPermissionHandler(async () => {
      called = true;
      return true;
    }, toolName => toolName === 'Bash');

    await expect(handler('Bash', { command: 'python3 script.py' }, {
      signal: new AbortController().signal,
      toolUseID: 'tool-3',
      requestId: 'request-3',
    })).resolves.toEqual({
      behavior: 'allow',
      updatedInput: { command: 'python3 script.py' },
    });
    expect(called).toBe(false);
  });

  it('returns an SDK denial when the host rejects the request', async () => {
    const handler = createSdkPermissionHandler(async () => false);

    await expect(handler('Read', { file_path: '/outside/workspace.txt' }, {
      signal: new AbortController().signal,
      toolUseID: 'tool-4',
      requestId: 'request-4',
    })).resolves.toEqual({
      behavior: 'deny',
      message: 'User denied permission',
    });
  });

  it('marks managed ask-rule prompts as not permanently allow-able', async () => {
    const requests: SdkPermissionRequest[] = [];
    const handler = createSdkPermissionHandler(async request => {
      requests.push(request);
      return true;
    });

    await handler('Bash', { command: 'python3 script.py' }, {
      signal: new AbortController().signal,
      toolUseID: 'tool-5',
      requestId: 'request-5',
      matchedAskRule: { source: 'managed', toolName: 'Bash', ruleContent: 'Bash(python3 *)' },
    });

    expect(requests).toEqual([{
      command: 'python3 script.py',
      description: 'Execute Bash: python3 script.py',
      requestId: 'request-5',
      toolName: 'Bash',
      canAlwaysAllow: false,
    }]);
  });
});
