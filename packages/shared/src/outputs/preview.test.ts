import { describe, expect, test } from 'bun:test';
import { inferPreviewMode, previewModeForMimeType } from './preview.ts';

describe('output preview mode inference', () => {
  test('detects glTF model assets by mime type and extension', () => {
    expect(previewModeForMimeType('model/gltf-binary')).toBe('model');
    expect(previewModeForMimeType('model/gltf+json')).toBe('model');
    expect(inferPreviewMode(undefined, 'scene.glb')).toBe('model');
    expect(inferPreviewMode(undefined, 'scene.gltf')).toBe('model');
  });
});
