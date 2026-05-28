import { describe, expect, it } from 'bun:test';
import { extractReasoningContent } from './extractor.ts';

describe('extractReasoningContent', () => {
  it('extracts reasoning from an Anthropic-style thinking content block', () => {
    expect(extractReasoningContent({
      content: [
        { type: 'thinking', thinking: 'Check the constraints first.' },
        { type: 'text', text: 'Use the shared package.' },
      ],
    })).toEqual({
      reasoningText: 'Check the constraints first.',
      cleanContent: 'Use the shared package.',
    });
  });

  it('extracts reasoning from a top-level reasoning_content field', () => {
    expect(extractReasoningContent({
      reasoning_content: 'Compare the supported formats.',
      content: 'Return the answer.',
    })).toEqual({
      reasoningText: 'Compare the supported formats.',
      cleanContent: 'Return the answer.',
    });
  });

  it('extracts and strips nested and multiple think tags from string content', () => {
    expect(extractReasoningContent({
      content: 'Before <think>first <think>nested</think> done</think>Answer<think>second</think>.',
    })).toEqual({
      reasoningText: 'first nested done\nsecond',
      cleanContent: 'Before Answer.',
    });
  });

  it('returns the original content when no reasoning format is present', () => {
    expect(extractReasoningContent({ content: 'Final answer.' })).toEqual({
      reasoningText: null,
      cleanContent: 'Final answer.',
    });
  });
});
