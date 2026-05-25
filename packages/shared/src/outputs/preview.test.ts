import { describe, expect, test } from 'bun:test';
import { inferPreviewMode, previewModeForMimeType } from './preview.ts';

describe('output preview mode inference', () => {
  test('detects glTF model assets by mime type and extension', () => {
    expect(previewModeForMimeType('model/gltf-binary')).toBe('model');
    expect(previewModeForMimeType('model/gltf+json')).toBe('model');
    expect(inferPreviewMode(undefined, 'scene.glb')).toBe('model');
    expect(inferPreviewMode(undefined, 'scene.gltf')).toBe('model');
  });

  test('detects PDF and SVG assets by mime type and extension', () => {
    expect(previewModeForMimeType('application/pdf')).toBe('pdf');
    expect(inferPreviewMode(undefined, 'report.pdf')).toBe('pdf');
    expect(inferPreviewMode('image/svg+xml', 'diagram.svg')).toBe('image');
    expect(inferPreviewMode(undefined, 'diagram.svg')).toBe('image');
  });

  test('detects Excalidraw assets by mime type and extension', () => {
    expect(previewModeForMimeType('application/vnd.excalidraw+json')).toBe('excalidraw');
    expect(inferPreviewMode(undefined, 'diagram.excalidraw')).toBe('excalidraw');
  });
});
