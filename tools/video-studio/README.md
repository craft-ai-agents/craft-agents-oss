# RunnerOS Video Studio Tool

Local CLI wrapper for RunnerOS Video Studio project files.

```bash
node bin/video-studio.mjs doctor --json
node bin/video-studio.mjs create ./my-video --title "Launch Cut" --json
node bin/video-studio.mjs probe ./media/clip.mp4 --json
node bin/video-studio.mjs validate ./my-video/video.runner-video.json --json
node bin/video-studio.mjs export ./my-video/video.runner-video.json --out ./my-video/renders/preview.placeholder.txt --json
node bin/video-studio.mjs export ./my-video/video.runner-video.json --out ./my-video/renders/final.mp4 --json
```

The first render path supports simple FFmpeg MP4 exports for video, image, audio, and text clips. SVG/Lottie/HTML clips fail loudly until the fuller renderer lands. Non-video output paths still write placeholder receipts.
