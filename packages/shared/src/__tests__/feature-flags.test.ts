import { describe, it, expect, afterEach } from 'bun:test';
import {
  isDevRuntime,
  isDeveloperFeedbackEnabled,
  isCraftAgentsCliEnabled,
  isEmbeddedServerEnabled,
  isPluginHostEnabled,
  isPluginRoutingUiEnabled,
  isExternalPluginsEnabled,
  isPluginVoiceEnabled,
  isPluginMcpAppsEnabled,
} from '../feature-flags.ts';

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  CRAFT_DEBUG: process.env.CRAFT_DEBUG,
  CRAFT_FEATURE_DEVELOPER_FEEDBACK: process.env.CRAFT_FEATURE_DEVELOPER_FEEDBACK,
  CRAFT_FEATURE_CRAFT_AGENTS_CLI: process.env.CRAFT_FEATURE_CRAFT_AGENTS_CLI,
  CRAFT_FEATURE_EMBEDDED_SERVER: process.env.CRAFT_FEATURE_EMBEDDED_SERVER,
  CRAFT_FEATURE_PLUGIN_HOST: process.env.CRAFT_FEATURE_PLUGIN_HOST,
  CRAFT_FEATURE_PLUGIN_ROUTING_UI: process.env.CRAFT_FEATURE_PLUGIN_ROUTING_UI,
  CRAFT_FEATURE_EXTERNAL_PLUGINS: process.env.CRAFT_FEATURE_EXTERNAL_PLUGINS,
  CRAFT_FEATURE_PLUGIN_VOICE: process.env.CRAFT_FEATURE_PLUGIN_VOICE,
  CRAFT_FEATURE_PLUGIN_MCP_APPS: process.env.CRAFT_FEATURE_PLUGIN_MCP_APPS,
};

afterEach(() => {
  if (ORIGINAL_ENV.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;

  if (ORIGINAL_ENV.CRAFT_DEBUG === undefined) delete process.env.CRAFT_DEBUG;
  else process.env.CRAFT_DEBUG = ORIGINAL_ENV.CRAFT_DEBUG;

  if (ORIGINAL_ENV.CRAFT_FEATURE_DEVELOPER_FEEDBACK === undefined) delete process.env.CRAFT_FEATURE_DEVELOPER_FEEDBACK;
  else process.env.CRAFT_FEATURE_DEVELOPER_FEEDBACK = ORIGINAL_ENV.CRAFT_FEATURE_DEVELOPER_FEEDBACK;

  if (ORIGINAL_ENV.CRAFT_FEATURE_CRAFT_AGENTS_CLI === undefined) delete process.env.CRAFT_FEATURE_CRAFT_AGENTS_CLI;
  else process.env.CRAFT_FEATURE_CRAFT_AGENTS_CLI = ORIGINAL_ENV.CRAFT_FEATURE_CRAFT_AGENTS_CLI;

  if (ORIGINAL_ENV.CRAFT_FEATURE_EMBEDDED_SERVER === undefined) delete process.env.CRAFT_FEATURE_EMBEDDED_SERVER;
  else process.env.CRAFT_FEATURE_EMBEDDED_SERVER = ORIGINAL_ENV.CRAFT_FEATURE_EMBEDDED_SERVER;

  if (ORIGINAL_ENV.CRAFT_FEATURE_PLUGIN_HOST === undefined) delete process.env.CRAFT_FEATURE_PLUGIN_HOST;
  else process.env.CRAFT_FEATURE_PLUGIN_HOST = ORIGINAL_ENV.CRAFT_FEATURE_PLUGIN_HOST;

  if (ORIGINAL_ENV.CRAFT_FEATURE_PLUGIN_ROUTING_UI === undefined) delete process.env.CRAFT_FEATURE_PLUGIN_ROUTING_UI;
  else process.env.CRAFT_FEATURE_PLUGIN_ROUTING_UI = ORIGINAL_ENV.CRAFT_FEATURE_PLUGIN_ROUTING_UI;

  if (ORIGINAL_ENV.CRAFT_FEATURE_EXTERNAL_PLUGINS === undefined) delete process.env.CRAFT_FEATURE_EXTERNAL_PLUGINS;
  else process.env.CRAFT_FEATURE_EXTERNAL_PLUGINS = ORIGINAL_ENV.CRAFT_FEATURE_EXTERNAL_PLUGINS;

  if (ORIGINAL_ENV.CRAFT_FEATURE_PLUGIN_VOICE === undefined) delete process.env.CRAFT_FEATURE_PLUGIN_VOICE;
  else process.env.CRAFT_FEATURE_PLUGIN_VOICE = ORIGINAL_ENV.CRAFT_FEATURE_PLUGIN_VOICE;

  if (ORIGINAL_ENV.CRAFT_FEATURE_PLUGIN_MCP_APPS === undefined) delete process.env.CRAFT_FEATURE_PLUGIN_MCP_APPS;
  else process.env.CRAFT_FEATURE_PLUGIN_MCP_APPS = ORIGINAL_ENV.CRAFT_FEATURE_PLUGIN_MCP_APPS;
});

describe('feature-flags runtime helpers', () => {
  it('isDevRuntime returns true for explicit dev NODE_ENV', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.CRAFT_DEBUG;

    expect(isDevRuntime()).toBe(true);
  });

  it('isDevRuntime returns true for CRAFT_DEBUG override', () => {
    process.env.NODE_ENV = 'production';
    process.env.CRAFT_DEBUG = '1';

    expect(isDevRuntime()).toBe(true);
  });

  it('isDeveloperFeedbackEnabled honors explicit override false', () => {
    process.env.NODE_ENV = 'development';
    process.env.CRAFT_FEATURE_DEVELOPER_FEEDBACK = '0';

    expect(isDeveloperFeedbackEnabled()).toBe(false);
  });

  it('isDeveloperFeedbackEnabled honors explicit override true', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CRAFT_DEBUG;
    process.env.CRAFT_FEATURE_DEVELOPER_FEEDBACK = '1';

    expect(isDeveloperFeedbackEnabled()).toBe(true);
  });

  it('isDeveloperFeedbackEnabled falls back to dev runtime when no override', () => {
    process.env.NODE_ENV = 'production';
    process.env.CRAFT_DEBUG = '1';
    delete process.env.CRAFT_FEATURE_DEVELOPER_FEEDBACK;

    expect(isDeveloperFeedbackEnabled()).toBe(true);
  });

  it('isCraftAgentsCliEnabled defaults to false when no override is set', () => {
    delete process.env.CRAFT_FEATURE_CRAFT_AGENTS_CLI;

    expect(isCraftAgentsCliEnabled()).toBe(false);
  });

  it('isCraftAgentsCliEnabled honors explicit override true', () => {
    process.env.CRAFT_FEATURE_CRAFT_AGENTS_CLI = '1';

    expect(isCraftAgentsCliEnabled()).toBe(true);
  });

  it('isCraftAgentsCliEnabled honors explicit override false', () => {
    process.env.CRAFT_FEATURE_CRAFT_AGENTS_CLI = '0';

    expect(isCraftAgentsCliEnabled()).toBe(false);
  });

  it('isEmbeddedServerEnabled defaults to false when no override is set', () => {
    delete process.env.CRAFT_FEATURE_EMBEDDED_SERVER;

    expect(isEmbeddedServerEnabled()).toBe(false);
  });

  it('isEmbeddedServerEnabled honors explicit override true', () => {
    process.env.CRAFT_FEATURE_EMBEDDED_SERVER = '1';

    expect(isEmbeddedServerEnabled()).toBe(true);
  });

  it('isEmbeddedServerEnabled honors explicit override false', () => {
    process.env.CRAFT_FEATURE_EMBEDDED_SERVER = '0';

    expect(isEmbeddedServerEnabled()).toBe(false);
  });

  it('plugin feature helpers default to false when unset', () => {
    delete process.env.CRAFT_FEATURE_PLUGIN_HOST;
    delete process.env.CRAFT_FEATURE_PLUGIN_ROUTING_UI;
    delete process.env.CRAFT_FEATURE_EXTERNAL_PLUGINS;
    delete process.env.CRAFT_FEATURE_PLUGIN_VOICE;
    delete process.env.CRAFT_FEATURE_PLUGIN_MCP_APPS;

    expect(isPluginHostEnabled()).toBe(false);
    expect(isPluginRoutingUiEnabled()).toBe(false);
    expect(isExternalPluginsEnabled()).toBe(false);
    expect(isPluginVoiceEnabled()).toBe(false);
    expect(isPluginMcpAppsEnabled()).toBe(false);
  });

  it('plugin feature helpers honor explicit override true', () => {
    process.env.CRAFT_FEATURE_PLUGIN_HOST = '1';
    process.env.CRAFT_FEATURE_PLUGIN_ROUTING_UI = '1';
    process.env.CRAFT_FEATURE_EXTERNAL_PLUGINS = '1';
    process.env.CRAFT_FEATURE_PLUGIN_VOICE = '1';
    process.env.CRAFT_FEATURE_PLUGIN_MCP_APPS = '1';

    expect(isPluginHostEnabled()).toBe(true);
    expect(isPluginRoutingUiEnabled()).toBe(true);
    expect(isExternalPluginsEnabled()).toBe(true);
    expect(isPluginVoiceEnabled()).toBe(true);
    expect(isPluginMcpAppsEnabled()).toBe(true);
  });
});
