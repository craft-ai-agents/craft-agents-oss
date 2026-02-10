/**
 * Tests for validation.ts
 */

import { describe, it, expect } from 'vitest';
import { validateHooksConfig, validateHooksContent } from './validation.ts';

describe('validation', () => {
  describe('validateHooksConfig', () => {
    it('should accept a valid config', () => {
      const config = {
        hooks: {
          TodoStateChange: [{
            matcher: 'done',
            hooks: [{ type: 'command', command: 'echo done' }],
          }],
        },
      };
      const result = validateHooksConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.config).not.toBeNull();
    });

    it('should accept an empty hooks object', () => {
      const result = validateHooksConfig({ hooks: {} });
      expect(result.valid).toBe(true);
    });

    it('should reject non-object input', () => {
      const result = validateHooksConfig('not an object');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should accept config without hooks key (defaults to empty)', () => {
      // The schema provides a default empty hooks object
      const result = validateHooksConfig({});
      expect(result.valid).toBe(true);
      expect(result.config?.hooks).toEqual({});
    });

    it('should accept config with prompt hooks', () => {
      const config = {
        hooks: {
          SchedulerTick: [{
            cron: '0 9 * * *',
            hooks: [{ type: 'prompt', prompt: 'Good morning!' }],
          }],
        },
      };
      const result = validateHooksConfig(config);
      expect(result.valid).toBe(true);
    });

    it('should accept config with disabled matchers', () => {
      const config = {
        hooks: {
          LabelAdd: [{
            enabled: false,
            matcher: 'bug',
            hooks: [{ type: 'command', command: 'echo disabled' }],
          }],
        },
      };
      const result = validateHooksConfig(config);
      expect(result.valid).toBe(true);
    });
  });

  describe('validateHooksContent', () => {
    it('should accept valid JSON config', () => {
      const json = JSON.stringify({
        hooks: {
          LabelAdd: [{
            matcher: 'bug',
            hooks: [{ type: 'command', command: 'echo bug' }],
          }],
        },
      });
      const result = validateHooksContent(json);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid JSON', () => {
      const result = validateHooksContent('not json{');
      expect(result.valid).toBe(false);
      expect(result.errors[0]?.message).toContain('Invalid JSON');
    });

    it('should reject ReDoS patterns (nested quantifiers)', () => {
      const json = JSON.stringify({
        hooks: {
          LabelAdd: [{
            matcher: '(a+)+',
            hooks: [{ type: 'command', command: 'echo test' }],
          }],
        },
      });
      const result = validateHooksContent(json);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('ReDoS'))).toBe(true);
    });

    it('should reject ReDoS patterns (repeated alternation)', () => {
      const json = JSON.stringify({
        hooks: {
          LabelAdd: [{
            matcher: '(a|b)+',
            hooks: [{ type: 'command', command: 'echo test' }],
          }],
        },
      });
      const result = validateHooksContent(json);
      expect(result.valid).toBe(false);
    });

    it('should reject ReDoS patterns (repeated greedy quantifiers)', () => {
      const json = JSON.stringify({
        hooks: {
          LabelAdd: [{
            matcher: '.*.*',
            hooks: [{ type: 'command', command: 'echo test' }],
          }],
        },
      });
      const result = validateHooksContent(json);
      expect(result.valid).toBe(false);
    });

    it('should reject invalid regex syntax', () => {
      const json = JSON.stringify({
        hooks: {
          LabelAdd: [{
            matcher: '[invalid',
            hooks: [{ type: 'command', command: 'echo test' }],
          }],
        },
      });
      const result = validateHooksContent(json);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('Invalid regex'))).toBe(true);
    });

    it('should reject regex patterns that are too long', () => {
      const json = JSON.stringify({
        hooks: {
          LabelAdd: [{
            matcher: 'a'.repeat(501),
            hooks: [{ type: 'command', command: 'echo test' }],
          }],
        },
      });
      const result = validateHooksContent(json);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('too long'))).toBe(true);
    });

    it('should reject invalid cron expressions', () => {
      const json = JSON.stringify({
        hooks: {
          SchedulerTick: [{
            cron: 'not a cron',
            hooks: [{ type: 'command', command: 'echo tick' }],
          }],
        },
      });
      const result = validateHooksContent(json);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('Invalid cron'))).toBe(true);
    });

    it('should reject invalid timezone', () => {
      const json = JSON.stringify({
        hooks: {
          SchedulerTick: [{
            cron: '0 9 * * *',
            timezone: 'Not/A/Timezone',
            hooks: [{ type: 'command', command: 'echo tick' }],
          }],
        },
      });
      const result = validateHooksContent(json);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('Invalid timezone'))).toBe(true);
    });

    it('should warn about allow-all permission mode', () => {
      const json = JSON.stringify({
        hooks: {
          LabelAdd: [{
            permissionMode: 'allow-all',
            hooks: [{ type: 'command', command: 'echo danger' }],
          }],
        },
      });
      const result = validateHooksContent(json);
      expect(result.valid).toBe(true); // Warning, not error
      expect(result.warnings.some(w => w.message.includes('allow-all'))).toBe(true);
    });

    it('should warn about empty hooks config', () => {
      const json = JSON.stringify({ hooks: {} });
      const result = validateHooksContent(json);
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.message.includes('No hooks configured'))).toBe(true);
    });

    it('should warn when cron is used on non-SchedulerTick event', () => {
      const json = JSON.stringify({
        hooks: {
          LabelAdd: [{
            cron: '0 9 * * *',
            hooks: [{ type: 'command', command: 'echo test' }],
          }],
        },
      });
      const result = validateHooksContent(json);
      expect(result.warnings.some(w => w.message.includes('SchedulerTick'))).toBe(true);
    });

    it('should accept valid simple regex patterns', () => {
      const json = JSON.stringify({
        hooks: {
          LabelAdd: [{
            matcher: 'bug|feature|fix',
            hooks: [{ type: 'command', command: 'echo matched' }],
          }],
        },
      });
      const result = validateHooksContent(json);
      expect(result.valid).toBe(true);
    });

    it('should accept valid cron with timezone', () => {
      const json = JSON.stringify({
        hooks: {
          SchedulerTick: [{
            cron: '15 16 * * *',
            timezone: 'Europe/Budapest',
            hooks: [{ type: 'prompt', prompt: 'Schedule check' }],
          }],
        },
      });
      const result = validateHooksContent(json);
      expect(result.valid).toBe(true);
    });
  });
});
