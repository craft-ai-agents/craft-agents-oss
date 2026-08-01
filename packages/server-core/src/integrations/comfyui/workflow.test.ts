import { describe, expect, it } from 'bun:test'
import { applyWorkflowParameters, ComfyWorkflowError, parseComfyWorkflow } from './workflow'

const agnesVideo = {
  disable_random_seed: true,
  prompt: {
    '1': { class_type: 'LoadImage', inputs: { image: 'source.png' } },
    '2': {
      class_type: 'AgnesVideo',
      inputs: {
        api_key: '',
        mode: 'Image To Video',
        prompt: 'A cinematic camera move',
        quality: '720p',
        duration: 5,
        frame_rate: 24,
        seed: 333,
        image: ['1', 0],
      },
    },
    '3': { class_type: 'SaveVideo', inputs: { filename_prefix: 'agnes/output', video: ['2', 0] } },
  },
}

describe('ComfyUI workflow parser', () => {
  it('unwraps saved API payloads and extracts safe Agnes video controls', () => {
    const result = parseComfyWorkflow(agnesVideo, { path: 'D:/Comfyui/workflows/agnes.json' })

    expect(result.kind).toBe('video')
    expect(result.nodeClasses).toEqual(['LoadImage', 'AgnesVideo', 'SaveVideo'])
    expect(result.parameters.map((parameter) => parameter.id)).toEqual([
      '1.image',
      '2.mode',
      '2.prompt',
      '2.quality',
      '2.duration',
      '2.frame_rate',
      '2.seed',
    ])
    expect(result.parameters.some((parameter) => parameter.input === 'api_key')).toBe(false)
  })

  it('classifies local diffusion workflows as image generation', () => {
    const result = parseComfyWorkflow({
      '3': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'flux.safetensors' } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'Portrait', clip: ['3', 1] } },
      '5': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 768, batch_size: 1 } },
      '10': { class_type: 'KSampler', inputs: { seed: 42, steps: 20, cfg: 3.5, model: ['3', 0] } },
      '8': { class_type: 'SaveImage', inputs: { filename_prefix: 'test', images: ['9', 0] } },
    }, { path: 'D:/Comfyui/workflows/flux.json' })

    expect(result.kind).toBe('image')
    expect(result.parameters.map((parameter) => [parameter.id, parameter.kind])).toEqual([
      ['3.ckpt_name', 'model'],
      ['5.width', 'number'],
      ['5.height', 'number'],
      ['5.batch_size', 'number'],
      ['6.text', 'text'],
      ['10.seed', 'seed'],
      ['10.steps', 'number'],
      ['10.cfg', 'number'],
    ])
  })

  it('applies only declared parameters without mutating the definition', () => {
    const definition = parseComfyWorkflow(agnesVideo, { path: 'agnes.json' })
    const next = applyWorkflowParameters(definition, {
      '2.prompt': 'Updated motion prompt',
      '2.duration': 10,
      '2.seed': 999,
    })

    expect(next['2']?.inputs.prompt).toBe('Updated motion prompt')
    expect(next['2']?.inputs.duration).toBe(10)
    expect(next['2']?.inputs.seed).toBe(999)
    expect(definition.workflow['2']?.inputs.prompt).toBe('A cinematic camera move')
    expect(definition.workflow['2']?.inputs.duration).toBe(5)
  })

  it('rejects unknown parameter injection', () => {
    const definition = parseComfyWorkflow(agnesVideo, { path: 'agnes.json' })
    expect(() => applyWorkflowParameters(definition, { '2.api_key': 'secret' })).toThrow(ComfyWorkflowError)
  })

  it('rejects editor-format JSON with conversion guidance', () => {
    expect(() => parseComfyWorkflow({ nodes: [], links: [] }, { path: 'editor.json' }))
      .toThrow('Editor-format workflow detected; export it in API format before using it in Media Lab')
  })

  it('rejects unrelated JSON documents', () => {
    expect(() => parseComfyWorkflow({ name: 'not a workflow' }, { path: 'metadata.json' }))
      .toThrow('Workflow is not valid ComfyUI API-format JSON')
  })
})
