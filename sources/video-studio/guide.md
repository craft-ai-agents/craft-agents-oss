# Video Studio

Use this source for RunnerOS-native video project files and agent-editable timeline operations.

Preferred agent path:

- `video_project_create`
- `video_media_import`
- `video_clip_add`
- `video_export`

Direct CLI path:

```bash
node bin/video-studio.mjs doctor --json
node bin/video-studio.mjs create <project-dir> --title "Launch Cut" --json
node bin/video-studio.mjs probe <media-path> --json
node bin/video-studio.mjs validate <project-path> --json
node bin/video-studio.mjs export <project-path> --out <output-path> --json
```

Export behavior: `.mp4` output paths use the simple FFmpeg renderer for video, image, audio, and text clips. SVG/Lottie/HTML clips fail loudly until the fuller renderer lands. Non-video paths write placeholder receipts.
