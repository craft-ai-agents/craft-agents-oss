import { describe, it, expect, afterEach } from 'bun:test';
import { isDevRuntime, isDeveloperFeedbackEnabled, isArchstudioCliEnabled, isEmbeddedServerEnabled } from '../feature-flags.ts';

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  ARCHSTUDIO_DEBUG: process.env.ARCHSTUDIO_DEBUG,
  ARCHSTUDIO_FEATURE_DEVELOPER_FEEDBACK: process.env.ARCHSTUDIO_FEATURE_DEVELOPER_FEEDBACK,
  ARCHSTUDIO_FEATURE_ARCHSTUDIO_AGENTS_CLI: process.env.ARCHSTUDIO_FEATURE_ARCHSTUDIO_AGENTS_CLI,
  ARCHSTUDIO_FEATURE_EMBEDDED_SERVER: process.env.ARCHSTUDIO_FEATURE_EMBEDDED_SERVER,
};

afterEach(() => {
  if (ORIGINAL_ENV.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;

  if (ORIGINAL_ENV.ARCHSTUDIO_DEBUG === undefined) delete process.env.ARCHSTUDIO_DEBUG;
  else process.env.ARCHSTUDIO_DEBUG = ORIGINAL_ENV.ARCHSTUDIO_DEBUG;

  if (ORIGINAL_ENV.ARCHSTUDIO_FEATURE_DEVELOPER_FEEDBACK === undefined) delete process.env.ARCHSTUDIO_FEATURE_DEVELOPER_FEEDBACK;
  else process.env.ARCHSTUDIO_FEATURE_DEVELOPER_FEEDBACK = ORIGINAL_ENV.ARCHSTUDIO_FEATURE_DEVELOPER_FEEDBACK;

  if (ORIGINAL_ENV.ARCHSTUDIO_FEATURE_ARCHSTUDIO_AGENTS_CLI === undefined) delete process.env.ARCHSTUDIO_FEATURE_ARCHSTUDIO_AGENTS_CLI;
  else process.env.ARCHSTUDIO_FEATURE_ARCHSTUDIO_AGENTS_CLI = ORIGINAL_ENV.ARCHSTUDIO_FEATURE_ARCHSTUDIO_AGENTS_CLI;

  if (ORIGINAL_ENV.ARCHSTUDIO_FEATURE_EMBEDDED_SERVER === undefined) delete process.env.ARCHSTUDIO_FEATURE_EMBEDDED_SERVER;
  else process.env.ARCHSTUDIO_FEATURE_EMBEDDED_SERVER = ORIGINAL_ENV.ARCHSTUDIO_FEATURE_EMBEDDED_SERVER;
});

describe('feature-flags runtime helpers', () => {
  it('isDevRuntime returns true for explicit dev NODE_ENV', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ARCHSTUDIO_DEBUG;

    expect(isDevRuntime()).toBe(true);
  });

  it('isDevRuntime returns true for ARCHSTUDIO_DEBUG override', () => {
    process.env.NODE_ENV = 'production';
    process.env.ARCHSTUDIO_DEBUG = '1';

    expect(isDevRuntime()).toBe(true);
  });

  it('isDeveloperFeedbackEnabled honors explicit override false', () => {
    process.env.NODE_ENV = 'development';
    process.env.ARCHSTUDIO_FEATURE_DEVELOPER_FEEDBACK = '0';

    expect(isDeveloperFeedbackEnabled()).toBe(false);
  });

  it('isDeveloperFeedbackEnabled honors explicit override true', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ARCHSTUDIO_DEBUG;
    process.env.ARCHSTUDIO_FEATURE_DEVELOPER_FEEDBACK = '1';

    expect(isDeveloperFeedbackEnabled()).toBe(true);
  });

  it('isDeveloperFeedbackEnabled falls back to dev runtime when no override', () => {
    process.env.NODE_ENV = 'production';
    process.env.ARCHSTUDIO_DEBUG = '1';
    delete process.env.ARCHSTUDIO_FEATURE_DEVELOPER_FEEDBACK;

    expect(isDeveloperFeedbackEnabled()).toBe(true);
  });

  it('isArchstudioCliEnabled defaults to false when no override is set', () => {
    delete process.env.ARCHSTUDIO_FEATURE_ARCHSTUDIO_AGENTS_CLI;

    expect(isArchstudioCliEnabled()).toBe(false);
  });

  it('isArchstudioCliEnabled honors explicit override true', () => {
    process.env.ARCHSTUDIO_FEATURE_ARCHSTUDIO_AGENTS_CLI = '1';

    expect(isArchstudioCliEnabled()).toBe(true);
  });

  it('isArchstudioCliEnabled honors explicit override false', () => {
    process.env.ARCHSTUDIO_FEATURE_ARCHSTUDIO_AGENTS_CLI = '0';

    expect(isArchstudioCliEnabled()).toBe(false);
  });

  it('isEmbeddedServerEnabled defaults to false when no override is set', () => {
    delete process.env.ARCHSTUDIO_FEATURE_EMBEDDED_SERVER;

    expect(isEmbeddedServerEnabled()).toBe(false);
  });

  it('isEmbeddedServerEnabled honors explicit override true', () => {
    process.env.ARCHSTUDIO_FEATURE_EMBEDDED_SERVER = '1';

    expect(isEmbeddedServerEnabled()).toBe(true);
  });

  it('isEmbeddedServerEnabled honors explicit override false', () => {
    process.env.ARCHSTUDIO_FEATURE_EMBEDDED_SERVER = '0';

    expect(isEmbeddedServerEnabled()).toBe(false);
  });
});
