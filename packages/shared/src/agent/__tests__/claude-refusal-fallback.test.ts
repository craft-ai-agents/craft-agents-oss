/**
 * What Craft shows when the model's safeguards stop a reply (stop_reason "refusal").
 *
 * The sequences are the ones Claude Code 2.1.316 sends (recorded against a local Messages API
 * stand-in): the first stopped reply stays and the CLI retries once on the same model with an
 * `informational` notice; a second one is taken back (`model_refusal_fallback` naming its frames
 * before its message_delta, `supersedes` on the answer's first frame) and a fallback model answers;
 * without a fallback the turn ends on an assistant error frame with stop_reason "refusal".
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { ClaudeEventAdapter } from '../backend/claude/event-adapter.ts';
import type { AgentEvent } from '@craft-agent/core/types';

const session_id = 'sdk-session';
const start = (id: string) => ({ type: 'stream_event', event: { type: 'message_start', message: { id } }, parent_tool_use_id: null, session_id });
const delta = (text: string) => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } }, parent_tool_use_id: null, session_id });
const stop = (stop_reason: string) => ({ type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason } }, parent_tool_use_id: null, session_id });
const text = (uuid: string, id: string, value: string, extra: object = {}) => ({
  type: 'assistant', uuid, message: { id, content: [{ type: 'text', text: value }] }, parent_tool_use_id: null, session_id, ...extra,
});
const toolCall = (uuid: string, id: string, toolUseId: string) => ({
  type: 'assistant', uuid, message: { id, content: [{ type: 'tool_use', id: toolUseId, name: 'Read', input: { file_path: '/repo/notes.txt' } }] }, parent_tool_use_id: null, session_id,
});
const toolResult = (uuid: string, toolUseId: string, content: string) => ({
  type: 'user', uuid, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: true }] }, tool_use_result: content, parent_tool_use_id: null, session_id,
});
const RETRY_NOTICE = "Opus 5.5's safeguards stopped the response above · continuing once with that noted";
const informational = (content = RETRY_NOTICE) => ({ type: 'system', subtype: 'informational', content, level: 'notice', uuid: 'informational', session_id });
// The model-directed message the CLI adds before retrying (not shown)
const retryNote = { type: 'user', uuid: 'note', isSynthetic: true, message: { role: 'user', content: [{ type: 'text', text: 'Your response above was stopped by a safety classifier.' }] }, parent_tool_use_id: null, session_id };
const FALLBACK_NOTICE = "Opus 5.5's safeguards flagged this session. Opus 4.8 is answering instead, or you can edit and retry with Opus 5.5.";
const fallback = (retracted: string[], extra: object = {}) => ({
  type: 'system', subtype: 'model_refusal_fallback', trigger: 'refusal', direction: 'retry', scope: 'session',
  original_model: 'claude-opus-5-5', fallback_model: 'claude-opus-4-8', request_id: 'req_2', api_refusal_category: 'cyber',
  retracted_message_uuids: retracted, refused_user_message_uuid: 'prompt', content: FALLBACK_NOTICE, uuid: 'fallback', session_id, ...extra,
});
const REFUSAL_TEXT = "API Error: Opus 5.5's safeguards flagged this session (https://www.anthropic.com/legal/aup). Claude Code can't respond to your last message with Opus 5.5.\n\nTry rephrasing the request in a new session or change your model.\n\nLearn more: https://support.claude.com/en/articles/8106465\n\nDetails: `[cyber]`\n\nRequest ID: req_2";
const refusalErrorFrame = {
  type: 'assistant', uuid: 'error-frame', error: 'invalid_request', is_api_error_message: true, refused_message_id: 'msg_2',
  message: { id: 'synthetic-id', model: '<synthetic>', stop_reason: 'refusal', content: [{ type: 'text', text: REFUSAL_TEXT }] }, parent_tool_use_id: null, session_id,
};

/** The events that change the transcript (no deltas, usage or duplicate tool starts). */
const SHOWN = new Set(['text_complete', 'text_discard', 'messages_retracted', 'model_refusal', 'typed_error', 'tool_result']);

describe('ClaudeEventAdapter: refusals', () => {
  let adapter: ClaudeEventAdapter;
  let mappedErrors: string[];

  beforeEach(() => {
    mappedErrors = [];
    adapter = new ClaudeEventAdapter({
      mapSDKError: async (code) => {
        mappedErrors.push(code);
        return { type: 'typed_error', error: { code: 'invalid_request', title: 'Invalid Request', message: 'The API rejected this request.', actions: [], canRetry: true } };
      },
    });
    adapter.startTurn();
  });

  async function feed(messages: object[]): Promise<AgentEvent[]> {
    const events: AgentEvent[] = [];
    for (const message of messages) events.push(...await adapter.adapt(message as never));
    return events.filter(event => SHOWN.has(event.type));
  }

  /** The first reply is stopped, the CLI retries once on the same model, and that reply is stopped too. */
  const stoppedTwice = [
    start('msg_1'), delta('Sure, here is how to'), text('uuid-1', 'msg_1', 'Sure, here is how to'), stop('refusal'),
    informational(), retryNote,
    start('msg_2'), delta('Sure, here is how to'), text('uuid-2', 'msg_2', 'Sure, here is how to'),
  ];

  it('takes back a reply stopped again and moves the session to the model that answers it', async () => {
    expect(await feed([
      ...stoppedTwice,
      fallback(['uuid-2']), stop('refusal'),
      start('msg_3'), delta('Fallback answer'), text('uuid-3', 'msg_3', 'Fallback answer', { supersedes: ['uuid-2'] }), stop('end_turn'),
    ])).toEqual([
      // The first stopped reply stays (the model keeps it too), with the CLI's notice under it
      { type: 'text_complete', text: 'Sure, here is how to', isIntermediate: false, turnId: 'msg_1', parentToolUseId: undefined },
      { type: 'model_refusal', message: RETRY_NOTICE },
      { type: 'text_discard', turnId: 'msg_2' },
      { type: 'messages_retracted', turnIds: ['msg_2'], toolUseIds: [] },
      { type: 'model_refusal', message: FALLBACK_NOTICE, fallbackModel: 'claude-opus-4-8' },
      // `supersedes` names the frame the notice already took back: nothing more to remove
      { type: 'text_complete', text: 'Fallback answer', isIntermediate: false, turnId: 'msg_3', parentToolUseId: undefined },
    ]);
  });

  it('takes the stopped reply back from `supersedes` when no notice came first', async () => {
    expect(await feed([
      ...stoppedTwice, stop('refusal'),
      start('msg_3'), text('uuid-3', 'msg_3', 'Fallback answer', { supersedes: ['uuid-2'] }), stop('end_turn'),
    ])).toEqual([
      { type: 'text_complete', text: 'Sure, here is how to', isIntermediate: false, turnId: 'msg_1', parentToolUseId: undefined },
      { type: 'model_refusal', message: RETRY_NOTICE },
      // msg_2's message_delta completed it before the answer named it
      { type: 'text_complete', text: 'Sure, here is how to', isIntermediate: false, turnId: 'msg_2', parentToolUseId: undefined },
      { type: 'messages_retracted', turnIds: ['msg_2'], toolUseIds: [] },
      { type: 'text_complete', text: 'Fallback answer', isIntermediate: false, turnId: 'msg_3', parentToolUseId: undefined },
    ]);
  });

  it('takes back the tool calls of the stopped reply, and drops a result that still comes for one', async () => {
    const events = await feed([
      start('msg_1'), delta('Running it'), text('uuid-1a', 'msg_1', 'Running it'), toolCall('uuid-1b', 'msg_1', 'toolu_1'), stop('refusal'),
      toolResult('tombstone-1', 'toolu_1', 'Interrupted: the response that made this tool call was stopped by a safety classifier.'),
      informational(), retryNote,
      start('msg_2'), delta('Running it'), text('uuid-2a', 'msg_2', 'Running it'), toolCall('uuid-2b', 'msg_2', 'toolu_2'),
      fallback(['uuid-2a', 'uuid-2b']), stop('refusal'),
      toolResult('tombstone-2', 'toolu_2', 'Interrupted: the response that made this tool call was stopped by a safety classifier.'),
      start('msg_3'), text('uuid-3', 'msg_3', 'Fallback answer', { supersedes: ['uuid-2a', 'uuid-2b'] }), stop('end_turn'),
    ]);
    expect(events.map(event => event.type)).toEqual([
      'text_complete', 'tool_result', 'model_refusal', // the first stopped reply and its interrupted call stay
      'text_discard', 'messages_retracted', 'model_refusal', 'text_complete',
    ]);
    expect(events[4]).toEqual({ type: 'messages_retracted', turnIds: ['msg_2'], toolUseIds: ['toolu_2'] });
  });

  it("keeps the session's model when only a subagent's answer came from the fallback model", async () => {
    const events = await feed([...stoppedTwice, fallback(['uuid-2'], { scope: 'local' })]);
    expect(events.at(-1)).toEqual({ type: 'model_refusal', message: FALLBACK_NOTICE });
  });

  it("shows the CLI's informational notices only after a stopped reply", async () => {
    expect(await feed([informational('Git Bash was not found'), start('msg_1'), text('uuid-1', 'msg_1', 'Done'), stop('end_turn'), informational('Started in the background')]))
      .toEqual([{ type: 'text_complete', text: 'Done', isIntermediate: false, turnId: 'msg_1', parentToolUseId: undefined }]);
  });

  it('ends the turn with the explanation when no model answers instead, after the stopped text', async () => {
    const events = await feed([
      ...stoppedTwice,
      { type: 'system', subtype: 'model_refusal_no_fallback', original_model: 'claude-opus-5-5', request_id: 'req_2', content: '', uuid: 'no-fallback', session_id },
      refusalErrorFrame, stop('refusal'),
    ]);
    expect(mappedErrors).toEqual([]);
    expect(events.slice(2)).toEqual([
      { type: 'text_complete', text: 'Sure, here is how to', isIntermediate: false, turnId: 'msg_2' },
      {
        type: 'typed_error',
        error: {
          code: 'model_refusal',
          title: 'Reply Stopped by Safeguards',
          message: "Opus 5.5's safeguards flagged this session (https://www.anthropic.com/legal/aup). Claude Code can't respond to your last message with Opus 5.5. Try rephrasing the request in a new session or change your model.",
          details: ['Learn more: https://support.claude.com/en/articles/8106465', 'Details: `[cyber]`', 'Request ID: req_2'],
          actions: [],
          canRetry: false,
        },
      },
    ]);
  });

  it('still maps an error frame that is not a refusal', async () => {
    await feed([{ type: 'assistant', uuid: 'e', error: 'invalid_request', message: { id: 'x', stop_reason: 'stop_sequence', content: [] }, parent_tool_use_id: null, session_id }]);
    expect(mappedErrors).toEqual(['invalid_request']);
  });
});
