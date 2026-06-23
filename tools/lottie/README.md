# RunnerOS Lottie Tool

Local wrapper for creating and validating Lottie animations with the official
`diffusionstudio/lottie` Skia player harness.

```bash
node bin/lottie.mjs doctor
node bin/lottie.mjs init ../../work/lottie-loader
node bin/lottie.mjs validate ../../work/lottie-loader
node bin/lottie.mjs dev ../../work/lottie-loader -- --host 127.0.0.1 --port 5173
```

No Lottie or Diffusion Studio API key is required.
