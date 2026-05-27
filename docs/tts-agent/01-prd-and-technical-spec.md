# TTS Agent PRD + Technical Spec

## Goal

Add a global Voice/TTS Agent and RunnerOS voice source layer that can generate speech artifacts through:

- ElevenLabs for premium voices and voice clones.
- Inworld for character/agent voices and voice clones.
- Kokoro for optional local/offline preset voices.

Generated audio should become normal RunnerOS outputs that can open/play in Canvas.

## Product Shape

### User Flow

1. User asks the TTS Agent for narration, ad read, character line, podcast intro, explainer voiceover, or batch voice variants.
2. Agent chooses provider:
   - `Auto`: best available.
   - `ElevenLabs`: premium/cloud.
   - `Inworld`: character/cloud.
   - `Local Kokoro`: offline/free after install.
3. Agent writes `.wav` or `.mp3` output.
4. Output appears in session artifacts and Canvas audio preview.

### Settings

Add a Voice/TTS settings surface:

- Provider cards:
  - ElevenLabs: API key, voices list, clone voices link/action.
  - Inworld: API key, voices list, clone/design voices link/action.
  - Kokoro Local: installed/not installed, install/remove, model version, size, checksum status.
- Default provider: `Auto`, `ElevenLabs`, `Inworld`, `Kokoro`.
- Default voice preset.
- Output format: `wav` first, `mp3` later if encoder is available.

## Voice Cloning Boundary

Kokoro is not the voice-cloning path. It provides preset/style voices from model assets.

Voice clones should be created through cloud providers:

- **ElevenLabs**
  - Dashboard route: user creates Instant Voice Clone or Professional Voice Clone in ElevenLabs, then RunnerOS stores/selects the returned `voice_id`.
  - API route: RunnerOS can later offer "Create voice clone" by uploading user-approved audio files to ElevenLabs' voice clone endpoint.
  - Required UX: explicit confirmation that user owns/has rights to the sampled voice.

- **Inworld**
  - Dashboard/playground route: user creates cloned voice in Inworld and copies/selects voice ID.
  - API route: use Inworld SDK/API if/when we add first-class clone creation.
  - Required UX: explicit consent/rights confirmation.

MVP should not attempt local voice cloning. It is heavier, legally riskier, and less shippable than provider-backed cloning.

## Kokoro Local Integration

### Model Choice

Use `onnx-community/Kokoro-82M-v1.0-ONNX` or current recommended ONNX Community Kokoro 82M model.

Preferred JS integration:

```ts
import { KokoroTTS } from "kokoro-js";

const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
  dtype: "q8",
});

const audio = await tts.generate(text, { voice: "af_bella" });
await audio.save(outputPath);
```

### Install Model Flow

Do not bundle Kokoro in the app binary by default.

Install to:

```text
~/Library/Application Support/RunnerOS/models/tts/kokoro/
```

Install steps:

1. Download model files and voices from Hugging Face.
2. Write `manifest.json` with:
   - provider: `kokoro`
   - model id
   - version/tag
   - file list
   - SHA256 checksums
   - license URL
   - installedAt
3. Verify checksums.
4. Mark status as `ready`.

### Runtime

Create a local wrapper:

```text
tools/tts-local/
  package.json
  README.md
  bin/tts-local.mjs
```

Commands:

```bash
node bin/tts-local.mjs doctor --json
node bin/tts-local.mjs kokoro install --json
node bin/tts-local.mjs kokoro voices --json
node bin/tts-local.mjs synthesize --provider kokoro --voice af_bella --text "Hello" --out output.wav --json
```

### Kokoro Constraints

- Split long text into chunks under model context limits.
- Normalize text before synthesis.
- Default to q8 for app-friendly size/performance.
- Cache loaded model per session where possible.
- Use WAV first; MP3 can be a post-processing step.

## Cloud Provider Adapters

### ElevenLabs

Source:

```text
sources/elevenlabs-tts/
```

Credential:

- `ELEVENLABS_API_KEY`

Capabilities:

- List voices.
- Synthesize speech.
- Use existing cloned voices by `voice_id`.
- Later: create instant voice clone from uploaded user-owned samples.

### Inworld

Source:

```text
sources/inworld-tts/
```

Credential:

- `INWORLD_API_KEY`

Capabilities:

- List/use voices.
- Synthesize speech.
- Use cloned/designed voice IDs.
- Later: clone/design voice from provider flow.

## Agent

Add standalone global agent:

```text
/Users/michaelb.williams/.codex/agents/creative/tts-agent.md
```

Name: `tts-agent`

Responsibilities:

- Turn scripts/text into voice-ready audio.
- Choose provider based on quality, cost, offline needs, and available credentials.
- Use voice clones only when user has rights/consent.
- Produce audio artifacts with useful filenames and metadata.
- If local model missing, ask to install Kokoro instead of failing.

## Skill

Add skill:

```text
/Users/michaelb.williams/.codex/skills/tts/SKILL.md
```

Trigger when user asks for TTS, voiceover, narration, ad read, speech audio, voice clone usage, Kokoro, ElevenLabs, or Inworld voice generation.

## Output Manifest

Every generated audio output should include:

```json
{
  "kind": "audio",
  "provider": "elevenlabs|inworld|kokoro",
  "voiceId": "string",
  "voiceName": "string",
  "textSource": "inline|file",
  "format": "wav|mp3",
  "sampleRate": 24000,
  "durationMs": 0,
  "createdAt": "iso"
}
```

## Phased Build

### Phase 1: Agent + Spec + Source Skeleton

- Create TTS Agent.
- Create TTS skill.
- Add source specs for ElevenLabs, Inworld, Kokoro Local.
- No synthesis yet.

### Phase 2: ElevenLabs Adapter

- Credential UI.
- Voice list.
- Synthesize text to audio output.
- Use existing cloned voice IDs.

### Phase 3: Kokoro Installer + Local Adapter

- Optional model install.
- Checksum/provenance.
- Local synthesize to WAV.
- Canvas audio artifact.

### Phase 4: Inworld Adapter

- Credential UI.
- Voice list.
- Synthesize text to audio output.
- Use existing clone/design voice IDs.

### Phase 5: Voice Clone Creation UX

- Provider-specific clone creation.
- Upload consent flow.
- Sample quality checks.
- Store cloned voice IDs, not raw samples unless user opts in.

## Security + Consent

- Never clone a voice without explicit user confirmation of rights.
- Prefer storing provider voice IDs over storing raw voice samples.
- Raw uploaded voice samples should be temporary by default.
- Redact API keys from logs.
- Make provider costs visible before batch generation.

## Open Decisions

- Whether to use `kokoro-js` directly from Electron/server-core or through a local CLI wrapper.
- Whether model install happens from settings only, or agent can trigger install.
- MP3 encoding path: ffmpeg bundle, WebAudio export, or WAV-only MVP.
