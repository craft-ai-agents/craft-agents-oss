# Image Preview Guide

This guide covers how to display image files inline using `image-preview` code blocks.

## Overview

The `image-preview` block renders local image files inline in chat messages — showing the image in a fixed-height container with an expand button for fullscreen viewing.

| Format | Best For | Rendering |
|--------|----------|-----------|
| **`image-preview` block** | Screenshots, captures, visual diffs | Inline fit-to-container + fullscreen viewer |
| **`pdf-preview` block** | PDF reports and documents | First page inline + full navigation |
| **`html-preview` block** | Rich HTML content | Sandboxed iframe rendering |

**Key principle:** Images are already files on disk. Reference them directly with either an absolute path in `src` or, inside a session transcript, a current-session relative path under `data/` or `plans/`.

## When to Use

Use `image-preview` when:
- You have a local screenshot/capture file and want inline visual context
- You want before/after visual comparisons in one response
- A tool result generated or downloaded image files
- The user asks to view an image directly in chat

Do NOT use `image-preview` when:
- The content is a PDF (`pdf-preview`)
- The content is rich HTML (`html-preview`)
- The content is structured table data (`datatable`/`spreadsheet`)
- The file format is unsupported in Chromium (often HEIC/HEIF/TIFF)

## Basic Usage

### Single Item

````
```image-preview
{
  "src": "data/screenshot.png",
  "title": "Settings screen"
}
```
````

### Multiple Items (Tabs)

Use `items` to show related images with tab navigation.

````
```image-preview
{
  "title": "Before / After",
  "items": [
    { "src": "data/before.png", "label": "Before" },
    { "src": "data/after.png", "label": "After" }
  ]
}
```
````

Content loads lazily on tab switch and is cached once loaded.

### Config Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `src` | Yes* | string | Absolute path to image file, or session-relative `data/...` / `plans/...` path (single item mode) |
| `title` | No | string | Header title (defaults to "Image Preview") |
| `items` | Yes* | array | Array of image items with `src` and optional `label` |
| `items[].src` | Yes | string | Absolute path to image file, or session-relative `data/...` / `plans/...` path |
| `items[].label` | No | string | Tab label |

*Either `src` (single) or `items` (multiple) is required. If both are present, `items` takes precedence.

## Supported Formats

In-app preview supports Chromium-decodable formats:
- PNG, JPG, JPEG, GIF, WebP, SVG, BMP, ICO, AVIF

Formats like HEIC/HEIF/TIFF may not render in-app. For those files, use external open.

## Rendering Behavior

### Inline Preview
- Fixed 400px preview area
- Image is rendered with `object-contain` (no cropping)
- Expand button opens fullscreen overlay
- Multi-item blocks show item navigator in the header

### Fullscreen Overlay
- Larger fit-to-container image view
- Item navigation (arrows/dropdown) for multi-item sets
- Copy path action in header
- File path badge supports external open/reveal actions

## Troubleshooting

### "Loading..." shown indefinitely
- Verify `src` is an **absolute path** or a session-relative `data/...` / `plans/...` path rendered inside a session
- Confirm the file exists and is readable
- Check that file extension is one of the supported formats

### "Load Failed" error
- File path may be invalid or access may be denied
- Image may be corrupted
- Format may not be decodable by Chromium

### HEIC/TIFF doesn’t render
- Expected for many environments
- Open externally using the file path badge actions
