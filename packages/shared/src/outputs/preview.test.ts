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

  test('detects presentation assets by mime type and extension', () => {
    expect(previewModeForMimeType('application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe('presentation');
    expect(previewModeForMimeType('application/vnd.ms-powerpoint')).toBe('presentation');
    expect(inferPreviewMode(undefined, 'deck.pptx')).toBe('presentation');
    expect(inferPreviewMode(undefined, 'deck.odp')).toBe('presentation');
  });

  test('detects chart assets by mime type and extension', () => {
    expect(previewModeForMimeType('application/vnd.runneros.chart+json')).toBe('chart');
    expect(inferPreviewMode(undefined, 'sales.chart.json')).toBe('chart');
    expect(inferPreviewMode('application/json', 'sales.vegalite.json')).toBe('chart');
  });
});
