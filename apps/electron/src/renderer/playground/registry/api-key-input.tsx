import type { ComponentEntry } from './types'
import { ApiKeyInput, type ApiKeySubmitData } from '@/components/apisetup/ApiKeyInput'

const logSubmit = (data: ApiKeySubmitData) => console.log('[Playground] Submit:', JSON.stringify(data, null, 2))

export const apiKeyInputComponents: ComponentEntry[] = [
  {
    id: 'api-key-custom-endpoint',
    name: 'Custom Endpoint',
    category: 'Agent Setup',
    description: 'ApiKeyInput with Custom preset — protocol toggle, base URL, and comma-separated models',
    component: ApiKeyInput,
    props: [
      {
        name: 'status',
        description: 'Validation status',
        control: {
          type: 'select',
          options: [
            { label: 'Idle', value: 'idle' },
            { label: 'Validating', value: 'validating' },
            { label: 'Success', value: 'success' },
            { label: 'Error', value: 'error' },
          ],
        },
        defaultValue: 'idle',
      },
      {
        name: 'errorMessage',
        description: 'Error message when status is error',
        control: { type: 'string', placeholder: 'Error message' },
        defaultValue: '',
      },
    ],
    variants: [
      {
        name: 'Empty (OpenAI compat)',
        description: 'Custom preset, OpenAI protocol selected, no values filled',
        props: {
          providerType: 'pi_api_key',
          initialValues: {
            activePreset: 'custom',
            baseUrl: 'https://your-endpoint.com/v1',
            customApi: 'openai-completions',
          },
        },
      },
      {
        name: 'Empty (Anthropic compat)',
        description: 'Custom preset, Anthropic protocol selected',
        props: {
          providerType: 'pi_api_key',
          initialValues: {
            activePreset: 'custom',
            baseUrl: 'https://your-proxy.com',
            customApi: 'anthropic-messages',
          },
        },
      },
      {
        name: 'Alibaba DashScope (OpenAI)',
        description: 'Alibaba/Qwen endpoint — OpenAI compatible with 3 models',
        props: {
          providerType: 'pi_api_key',
          initialValues: {
            activePreset: 'custom',
            baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            connectionDefaultModel: 'qwen3-coder-plus, qwen3-coder-flash, qwen-max',
            customApi: 'openai-completions',
          },
        },
      },
      {
        name: 'Ollama Local (OpenAI)',
        description: 'Local Ollama endpoint — OpenAI compatible',
        props: {
          providerType: 'pi_api_key',
          initialValues: {
            activePreset: 'custom',
            baseUrl: 'http://localhost:11434/v1',
            connectionDefaultModel: 'qwen3-coder',
            customApi: 'openai-completions',
          },
        },
      },
      {
        name: 'Anthropic Proxy',
        description: 'Custom Anthropic-compatible proxy endpoint',
        props: {
          providerType: 'pi_api_key',
          initialValues: {
            activePreset: 'custom',
            baseUrl: 'https://my-anthropic-proxy.internal/v1',
            connectionDefaultModel: 'claude-sonnet-4-6',
            customApi: 'anthropic-messages',
          },
        },
      },
      {
        name: 'Via Anthropic API Key flow',
        description: 'Custom endpoint accessed through Anthropic provider type',
        props: {
          providerType: 'anthropic',
          initialValues: {
            activePreset: 'custom',
            baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            connectionDefaultModel: 'qwen3-coder-plus, qwen3-coder-flash',
            customApi: 'openai-completions',
          },
        },
      },
      {
        name: 'No Base URL (toggle hidden)',
        description: 'Custom preset but no base URL — protocol toggle should not appear',
        props: {
          providerType: 'pi_api_key',
          initialValues: {
            activePreset: 'custom',
          },
        },
      },
      {
        name: 'Validation Error',
        description: 'Custom endpoint with connection error',
        props: {
          status: 'error',
          errorMessage: 'Connection failed: ECONNREFUSED 127.0.0.1:11434',
          providerType: 'pi_api_key',
          initialValues: {
            activePreset: 'custom',
            baseUrl: 'http://localhost:11434/v1',
            connectionDefaultModel: 'qwen3-coder',
            customApi: 'openai-completions',
          },
        },
      },
    ],
    mockData: () => ({
      onSubmit: logSubmit,
      providerType: 'pi_api_key',
      initialValues: {
        activePreset: 'custom',
        baseUrl: 'https://your-endpoint.com/v1',
        customApi: 'openai-completions',
      },
    }),
  },
]
